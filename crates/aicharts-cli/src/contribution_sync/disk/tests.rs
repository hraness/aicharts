use super::*;
use crate::contribution_sync::{
    self as outbox,
    tests::{batch, committed_reply, empty, frozen, h, progress, reply},
    Action, Outbox,
};
use std::{
    fs as files,
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

const KEY: [u8; 32] = [0xa4; 32];
static SERIAL: AtomicU64 = AtomicU64::new(0);
struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = files::remove_dir_all(&self.0);
    }
}
fn scratch() -> Scratch {
    let path = files::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "aicharts-contribution-sync-{}-{}",
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        ));
    files::create_dir(&path).unwrap();
    files::set_permissions(&path, files::Permissions::from_mode(0o700)).unwrap();
    Scratch(path)
}
fn initialize(path: &Path) -> Outbox {
    Outbox::initialize(path, &KEY, &empty().binding, &progress(&batch(1, 12, 4))).unwrap()
}
fn inventory(path: &Path) -> Vec<(String, Vec<u8>, u64, i64, i64)> {
    let mut items: Vec<_> = files::read_dir(path)
        .unwrap()
        .map(|value| {
            let path = value.unwrap().path();
            let metadata = files::symlink_metadata(&path).unwrap();
            (
                path.file_name().unwrap().to_string_lossy().into_owned(),
                files::read(&path).unwrap(),
                metadata.ino(),
                metadata.mtime_nsec(),
                metadata.ctime_nsec(),
            )
        })
        .collect();
    items.sort_by(|a, b| a.0.cmp(&b.0));
    items
}
fn stage(path: &Path, previous: Option<String>, checkpoint: &Checkpoint) {
    let mac = hex(&authenticator(&KEY, previous.as_deref(), checkpoint)
        .unwrap()
        .finalize()
        .into_bytes());
    let envelope = Envelope {
        schema_version: 1,
        previous,
        payload: checkpoint.clone(),
        mac,
    };
    files::write(path.join(NEXT), serde_json::to_vec(&envelope).unwrap()).unwrap();
    files::set_permissions(path.join(NEXT), files::Permissions::from_mode(0o600)).unwrap();
}

#[test]
fn inspection_is_existing_only_read_only_and_shared_while_writer_is_exclusive() {
    let path = scratch();
    let binding = empty().binding;
    assert!(outbox::inspect(&path.0, &KEY, &binding).is_err());
    assert!(inventory(&path.0).is_empty());
    drop(initialize(&path.0));
    let before = inventory(&path.0);
    let first = Disk::reader(&path.0, &KEY).unwrap();
    let second = Disk::reader(&path.0, &KEY).unwrap();
    assert_eq!(first.inspect(&binding).unwrap(), Some(empty()));
    assert_eq!(second.inspect(&binding).unwrap(), Some(empty()));
    assert!(Disk::writer(&path.0, &KEY).is_err());
    assert_eq!(inventory(&path.0), before);
    drop(first);
    drop(second);
    let writer = Disk::writer(&path.0, &KEY).unwrap();
    assert!(Disk::reader(&path.0, &KEY).is_err());
    drop(writer);
    assert_eq!(inventory(&path.0), before);
}

#[test]
fn initialization_never_adopts_missing_history_or_replaces_an_existing_lock() {
    let path = scratch();
    let binding = empty().binding;
    let mut ahead = progress(&batch(1, 12, 4));
    ahead.next_sequence = 2;
    assert!(Outbox::initialize(&path.0, &KEY, &binding, &ahead).is_err());
    assert!(inventory(&path.0).is_empty());
    drop(initialize(&path.0));
    let before = inventory(&path.0);
    assert!(Outbox::initialize(&path.0, &KEY, &binding, &progress(&batch(1, 12, 4))).is_err());
    assert_eq!(inventory(&path.0), before);
}

#[test]
fn frozen_bytes_restart_exactly_and_unknown_or_later_remote_progress_cannot_clear_them() {
    let path = scratch();
    let binding = empty().binding;
    let original = batch(1, 12, 4);
    let mut sender = initialize(&path.0);
    sender
        .freeze(&binding, &original, &progress(&original))
        .unwrap();
    assert_eq!(
        sender
            .flight(&binding, &progress(&original))
            .unwrap()
            .request_bytes(&binding)
            .unwrap(),
        original.bytes()
    );
    let before = inventory(&path.0);
    drop(sender);
    let mut sender = Outbox::recover(&path.0, &KEY, &binding).unwrap();
    let mut ahead = progress(&original);
    ahead.next_sequence = 3;
    assert!(sender.flight(&binding, &ahead).is_err());
    let mut rollback = progress(&original);
    rollback.revision = 11;
    assert!(sender.flight(&binding, &rollback).is_err());
    assert!(sender
        .freeze(&binding, &original, &progress(&original))
        .is_err());
    assert_eq!(
        sender
            .flight(&binding, &progress(&original))
            .unwrap()
            .request_bytes(&binding)
            .unwrap(),
        original.bytes()
    );
    assert_eq!(inventory(&path.0), before);
}

#[test]
fn local_cancellation_intent_is_idempotent_preserves_the_floor_and_grants_no_dispatch() {
    let path = scratch();
    let binding = empty().binding;
    let original = batch(1, 12, 4);
    let mut sender = initialize(&path.0);
    let before = inventory(&path.0);
    assert!(sender.request_cancel(&binding).is_err());
    assert_eq!(inventory(&path.0), before);
    sender
        .freeze(&binding, &original, &progress(&original))
        .unwrap();
    let frozen = sender.checkpoint.clone();
    sender.request_cancel(&binding).unwrap();
    assert_eq!(sender.checkpoint.last_sequence, frozen.last_sequence);
    assert_eq!(sender.checkpoint.last_revision, frozen.last_revision);
    assert_eq!(sender.checkpoint.terminal, frozen.terminal);
    let cancelled = sender.checkpoint.flight.as_ref().unwrap();
    assert_eq!(cancelled.body, frozen.flight.unwrap().body);
    assert_eq!(
        cancelled.action,
        Action::Cancel {
            expected_revision: 12
        }
    );
    let before = inventory(&path.0);
    sender.request_cancel(&binding).unwrap();
    assert_eq!(inventory(&path.0), before);

    let mut observed = progress(&original);
    observed.expires_at = std::time::Instant::now();
    assert!(sender.flight(&binding, &observed).is_err());
    observed = progress(&original);
    observed.revision = 14;
    sender.cancel(&binding, &observed).unwrap();
    let before = inventory(&path.0);
    sender.request_cancel(&binding).unwrap();
    assert_eq!(inventory(&path.0), before);
    assert_eq!(sender.checkpoint.last_revision, 14);
    assert_eq!(
        sender.checkpoint.flight.as_ref().unwrap().action,
        Action::Cancel {
            expected_revision: 14
        }
    );
    assert_eq!(
        sender
            .checkpoint
            .flight
            .as_ref()
            .unwrap()
            .body
            .reopen()
            .unwrap()
            .bytes(),
        original.bytes()
    );
}

#[test]
fn persisted_cancel_survives_restart_and_exact_terminal_is_the_only_retirement_authority() {
    let path = scratch();
    let binding = empty().binding;
    let original = batch(1, 12, 4);
    let mut sender = initialize(&path.0);
    sender
        .freeze(&binding, &original, &progress(&original))
        .unwrap();
    let mut observed = progress(&original);
    observed.revision = 13;
    sender.cancel(&binding, &observed).unwrap();
    drop(sender);
    let mut sender = Outbox::recover(&path.0, &KEY, &binding).unwrap();
    let bytes = sender
        .flight(&binding, &observed)
        .unwrap()
        .request_bytes(&binding)
        .unwrap();
    let decoded: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(decoded["expectedRevision"], 13);
    assert_eq!(
        decoded["batch"],
        serde_json::from_slice::<serde_json::Value>(original.bytes()).unwrap()
    );
    assert!(bytes.ends_with(&[original.bytes(), b"}"].concat()));
    let before = inventory(&path.0);
    assert!(sender
        .settle(&binding, &reply(&batch(2, 13, 4), 14))
        .is_err());
    assert_eq!(inventory(&path.0), before);
    sender.settle(&binding, &reply(&original, 14)).unwrap();
    assert!(sender.flight(&binding, &observed).is_err());
    assert_eq!(sender.checkpoint.last_sequence, 1);
    assert_eq!(sender.checkpoint.last_revision, 14);
    let next = batch(2, 14, 5);
    sender.freeze(&binding, &next, &progress(&next)).unwrap();
    let before = inventory(&path.0);
    assert!(sender.settle(&binding, &reply(&original, 14)).is_err());
    assert_eq!(inventory(&path.0), before);
    assert_eq!(
        sender
            .flight(&binding, &progress(&next))
            .unwrap()
            .request_bytes(&binding)
            .unwrap(),
        next.bytes()
    );
}

#[test]
fn dispatch_requires_the_frozen_population_writer_and_active_device_without_changing_bytes() {
    let path = scratch();
    let binding = empty().binding;
    let original = batch(1, 12, 4);
    let mut sender = initialize(&path.0);
    sender
        .freeze(&binding, &original, &progress(&original))
        .unwrap();
    let before = inventory(&path.0);
    let mut observed = progress(&original);
    observed.scope.population_id = h(5);
    assert!(sender.flight(&binding, &observed).is_err());
    observed.scope.population_id = h(4);
    observed.scope.writer_revision = 2;
    assert!(sender.flight(&binding, &observed).is_err());
    observed.scope.writer_revision = 1;
    observed.active = false;
    assert!(sender.flight(&binding, &observed).is_err());
    assert_eq!(inventory(&path.0), before);
    assert_eq!(
        sender
            .flight(&binding, &progress(&original))
            .unwrap()
            .request_bytes(&binding)
            .unwrap(),
        original.bytes()
    );
    // A separately authenticated, exact terminal can retire the same operation
    // even after writer observations cease to authorize another dispatch.
    sender.settle(&binding, &reply(&original, 13)).unwrap();
    assert_eq!(sender.checkpoint.last_sequence, 1);
}

#[test]
fn every_publication_failure_preserves_exact_state_and_never_returns_a_send_capability() {
    for point in [
        Step::StageCreated,
        Step::StageWritten,
        Step::StageSynced,
        Step::StageRenamed,
        Step::DirectorySynced,
        Step::CurrentReadBack,
    ] {
        let path = scratch();
        let binding = empty().binding;
        let original = batch(1, 12, 4);
        let mut sender = initialize(&path.0);
        sender.disk.fail_at(point);
        assert!(
            sender
                .freeze(&binding, &original, &progress(&original))
                .is_err(),
            "{point:?}"
        );
        assert!(
            sender.flight(&binding, &progress(&original)).is_err(),
            "{point:?}"
        );
        drop(sender);
        let before = inventory(&path.0);
        if point == Step::StageCreated {
            assert!(Outbox::recover(&path.0, &KEY, &binding).is_err());
            assert_eq!(inventory(&path.0), before);
        } else {
            if path.0.join(NEXT).exists() {
                assert!(outbox::inspect(&path.0, &KEY, &binding).is_err());
                assert_eq!(inventory(&path.0), before);
            }
            let mut recovered = Outbox::recover(&path.0, &KEY, &binding).unwrap();
            assert_eq!(
                recovered
                    .flight(&binding, &progress(&original))
                    .unwrap()
                    .request_bytes(&binding)
                    .unwrap(),
                original.bytes()
            );
        }
    }
}

#[test]
fn cancellation_and_retirement_recover_safely_across_each_publication_boundary() {
    for retiring in [false, true] {
        for point in [
            Step::StageCreated,
            Step::StageWritten,
            Step::StageSynced,
            Step::StageRenamed,
            Step::DirectorySynced,
            Step::CurrentReadBack,
        ] {
            let path = scratch();
            let binding = empty().binding;
            let original = batch(1, 12, 4);
            let mut sender = initialize(&path.0);
            sender
                .freeze(&binding, &original, &progress(&original))
                .unwrap();
            let mut observed = progress(&original);
            observed.revision = 13;
            if retiring {
                sender.cancel(&binding, &observed).unwrap();
            }
            sender.disk.fail_at(point);
            let outcome = if retiring {
                sender.settle(&binding, &reply(&original, 14))
            } else {
                sender.cancel(&binding, &observed)
            };
            assert!(outcome.is_err(), "retiring={retiring}, {point:?}");
            assert!(
                sender.flight(&binding, &observed).is_err(),
                "retiring={retiring}, {point:?}"
            );
            drop(sender);
            let before = inventory(&path.0);
            if point == Step::StageCreated {
                assert!(Outbox::recover(&path.0, &KEY, &binding).is_err());
                assert_eq!(inventory(&path.0), before);
                continue;
            }
            let mut recovered = Outbox::recover(&path.0, &KEY, &binding).unwrap();
            if retiring {
                assert_eq!(recovered.checkpoint.last_sequence, 1);
                assert_eq!(recovered.checkpoint.last_revision, 14);
                assert!(recovered.flight(&binding, &observed).is_err());
                let retained = recovered.checkpoint.terminal.as_ref().unwrap();
                assert_eq!(
                    retained.flight.body.reopen().unwrap().bytes(),
                    original.bytes()
                );
                assert_eq!(retained.proof, reply(&original, 14).proof);
            } else {
                let request = recovered
                    .flight(&binding, &observed)
                    .unwrap()
                    .request_bytes(&binding)
                    .unwrap();
                let decoded: serde_json::Value = serde_json::from_slice(&request).unwrap();
                assert_eq!(decoded["expectedRevision"], 13);
                assert!(request.ends_with(&[original.bytes(), b"}"].concat()));
            }
        }
    }
}

#[test]
fn refreshed_cancellation_keeps_its_action_and_advances_the_durable_revision_floor() {
    let path = scratch();
    let binding = empty().binding;
    let original = batch(1, 12, 4);
    let mut sender = initialize(&path.0);
    sender
        .freeze(&binding, &original, &progress(&original))
        .unwrap();
    let mut observed = progress(&original);
    sender.cancel(&binding, &observed).unwrap();
    observed.revision = 14;
    sender.cancel(&binding, &observed).unwrap();
    drop(sender);
    let mut sender = Outbox::recover(&path.0, &KEY, &binding).unwrap();
    let request = sender
        .flight(&binding, &observed)
        .unwrap()
        .request_bytes(&binding)
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&request).unwrap()["expectedRevision"],
        14
    );
    assert!(sender.flight(&binding, &progress(&original)).is_err());
    sender.settle(&binding, &reply(&original, 15)).unwrap();
    assert_eq!(sender.checkpoint.last_sequence, 1);
    assert_eq!(sender.checkpoint.last_revision, 15);
    drop(sender);
    let checkpoint = outbox::inspect(&path.0, &KEY, &binding).unwrap().unwrap();
    assert!(checkpoint.flight.is_none());
    assert_eq!(checkpoint.last_sequence, 1);
}

#[test]
fn a_delayed_committed_receipt_can_retire_a_later_local_cancellation_decision() {
    let path = scratch();
    let binding = empty().binding;
    let original = batch(1, 12, 4);
    let mut sender = initialize(&path.0);
    sender
        .freeze(&binding, &original, &progress(&original))
        .unwrap();
    // The progress observation may precede server commit, while the durable
    // cancellation decision and its response follow that same server commit.
    sender.cancel(&binding, &progress(&original)).unwrap();
    drop(sender);
    let mut sender = Outbox::recover(&path.0, &KEY, &binding).unwrap();
    sender
        .settle(&binding, &committed_reply(&original))
        .unwrap();
    assert_eq!(sender.checkpoint.last_sequence, 1);
    assert_eq!(sender.checkpoint.last_revision, 13);
    drop(sender);
    let checkpoint = outbox::inspect(&path.0, &KEY, &binding).unwrap().unwrap();
    assert!(checkpoint.flight.is_none());
    assert_eq!(checkpoint.last_sequence, 1);
}

#[test]
fn authenticated_stages_still_cannot_replace_a_flight_reverse_cancel_or_change_accounts() {
    let path = scratch();
    let binding = empty().binding;
    let original = batch(1, 12, 4);
    let mut sender = initialize(&path.0);
    sender
        .freeze(&binding, &original, &progress(&original))
        .unwrap();
    let mut observed = progress(&original);
    observed.revision = 13;
    sender.cancel(&binding, &observed).unwrap();
    let previous = sender.disk.current.clone();
    let mut forged = sender.checkpoint.clone();
    forged.flight.as_mut().unwrap().action = Action::Upload;
    drop(sender);
    stage(&path.0, previous, &forged);
    let before = inventory(&path.0);
    assert!(Outbox::recover(&path.0, &KEY, &binding).is_err());
    assert_eq!(inventory(&path.0), before);
    let foreign = outbox::Binding::new(&binding.account_id, &h(999), &binding.device_id).unwrap();
    assert!(Outbox::recover(&path.0, &KEY, &foreign).is_err());
    assert_eq!(inventory(&path.0), before);
}

#[test]
fn wrong_key_corrupt_stage_symlink_hardlink_and_replaced_lock_refuse_without_cleanup() {
    let path = scratch();
    let binding = empty().binding;
    drop(initialize(&path.0));
    let before = inventory(&path.0);
    assert!(Outbox::recover(&path.0, &[0x33; 32], &binding).is_err());
    assert_eq!(inventory(&path.0), before);
    files::write(path.0.join(NEXT), b"{").unwrap();
    files::set_permissions(path.0.join(NEXT), files::Permissions::from_mode(0o600)).unwrap();
    let before = inventory(&path.0);
    assert!(Outbox::recover(&path.0, &KEY, &binding).is_err());
    assert_eq!(inventory(&path.0), before);
    files::remove_file(path.0.join(NEXT)).unwrap();
    files::hard_link(path.0.join(CURRENT), path.0.join("alias")).unwrap();
    assert!(outbox::inspect(&path.0, &KEY, &binding).is_err());
    files::remove_file(path.0.join("alias")).unwrap();
    let mut sender = Outbox::recover(&path.0, &KEY, &binding).unwrap();
    let original = batch(1, 12, 4);
    sender
        .freeze(&binding, &original, &progress(&original))
        .unwrap();
    {
        let cap = sender.flight(&binding, &progress(&original)).unwrap();
        files::rename(path.0.join(LOCK), path.0.join("old.lock")).unwrap();
        files::write(path.0.join(LOCK), []).unwrap();
        files::set_permissions(path.0.join(LOCK), files::Permissions::from_mode(0o600)).unwrap();
        assert!(cap.request_bytes(&binding).is_err());
    }
    drop(sender);
    files::remove_file(path.0.join(CURRENT)).unwrap();
    std::os::unix::fs::symlink("old.lock", path.0.join(CURRENT)).unwrap();
    assert!(Outbox::recover(&path.0, &KEY, &binding).is_err());
}

#[test]
fn a_valid_successor_with_foreign_mac_predecessor_never_replaces_committed_bytes() {
    let path = scratch();
    let binding = empty().binding;
    drop(initialize(&path.0));
    stage(&path.0, Some(h(999)), &frozen());
    let before = inventory(&path.0);
    assert!(Outbox::recover(&path.0, &KEY, &binding).is_err());
    assert_eq!(inventory(&path.0), before);
}

fn legacy_bytes(checkpoint: &Checkpoint, previous: Option<String>) -> Vec<u8> {
    let legacy = LegacyCheckpoint {
        schema_version: 1,
        binding: checkpoint.binding.clone(),
        last_sequence: checkpoint.last_sequence,
        last_revision: checkpoint.last_revision,
        flight: checkpoint.flight.clone(),
        terminal: checkpoint.terminal.as_ref().map(|terminal| {
            let outbox::TerminalProof::Direct(reply) = &terminal.proof else {
                panic!("legacy direct reply");
            };
            outbox::LegacyTerminal {
                flight: terminal.flight.clone(),
                reply: reply.clone(),
            }
        }),
    };
    let mac = hex(&authenticator(&KEY, previous.as_deref(), &legacy)
        .unwrap()
        .finalize()
        .into_bytes());
    serde_json::to_vec(&Envelope {
        schema_version: 1,
        previous,
        payload: legacy,
        mac,
    })
    .unwrap()
}

#[test]
fn legacy_checkpoint_is_read_without_rewrite_and_next_mutation_chains_original_mac() {
    let path = scratch();
    let binding = empty().binding;
    let original = batch(1, 12, 4);
    let mut sender = initialize(&path.0);
    sender
        .freeze(&binding, &original, &progress(&original))
        .unwrap();
    sender
        .settle(&binding, &committed_reply(&original))
        .unwrap();
    let settled = sender.checkpoint.clone();
    let previous = sender.disk.current.clone();
    drop(sender);
    let bytes = legacy_bytes(&settled, previous);
    let legacy_mac = decode(&bytes, &KEY).unwrap().mac;
    files::write(path.0.join(CURRENT), &bytes).unwrap();
    let before = inventory(&path.0);
    assert_eq!(
        outbox::inspect(&path.0, &KEY, &binding).unwrap(),
        Some(settled.clone())
    );
    assert_eq!(inventory(&path.0), before);
    let mut recovered = Outbox::recover(&path.0, &KEY, &binding).unwrap();
    assert_eq!(recovered.checkpoint, settled);
    assert_eq!(inventory(&path.0), before);
    let next = batch(2, 14, 5);
    recovered.freeze(&binding, &next, &progress(&next)).unwrap();
    let rewritten: serde_json::Value =
        serde_json::from_slice(&files::read(path.0.join(CURRENT)).unwrap()).unwrap();
    assert_eq!(rewritten["payload"]["schemaVersion"], 2);
    assert_eq!(rewritten["previous"], legacy_mac);
    assert_eq!(
        rewritten["payload"]["terminal"]["proof"]["source"],
        "direct"
    );
    assert_eq!(
        recovered
            .flight(&binding, &progress(&next))
            .unwrap()
            .request_bytes(&binding)
            .unwrap(),
        next.bytes()
    );
}

#[test]
fn legacy_staged_successor_is_authenticated_before_conversion_and_recovery() {
    let path = scratch();
    let binding = empty().binding;
    let sender = initialize(&path.0);
    let predecessor = sender.disk.current.clone();
    drop(sender);
    let bytes = legacy_bytes(&frozen(), predecessor);
    files::write(path.0.join(NEXT), &bytes).unwrap();
    files::set_permissions(path.0.join(NEXT), files::Permissions::from_mode(0o600)).unwrap();
    let before = inventory(&path.0);
    assert!(outbox::inspect(&path.0, &KEY, &binding).is_err());
    assert_eq!(inventory(&path.0), before);
    let mut recovered = Outbox::recover(&path.0, &KEY, &binding).unwrap();
    assert_eq!(files::read(path.0.join(CURRENT)).unwrap(), bytes);
    let original = batch(1, 12, 4);
    assert_eq!(
        recovered
            .flight(&binding, &progress(&original))
            .unwrap()
            .request_bytes(&binding)
            .unwrap(),
        original.bytes()
    );
    let text = String::from_utf8(bytes).unwrap();
    assert!(decode(
        text.replace("\"lastSequence\":0", "\"lastSequence\":1")
            .as_bytes(),
        &KEY
    )
    .is_err());
    assert!(decode(
        text.replace(
            "\"schemaVersion\":1",
            "\"schemaVersion\":1,\"schemaVersion\":1"
        )
        .as_bytes(),
        &KEY
    )
    .is_err());
    assert!(decode(format!("{text}\n").as_bytes(), &KEY).is_err());
    assert!(decode(text.as_bytes(), &[9; 32]).is_err());
}

#[test]
fn expired_authenticated_progress_cannot_initialize_freeze_cancel_or_authorize_dispatch() {
    let path = scratch();
    let binding = empty().binding;
    let original = batch(1, 12, 4);
    let mut expired = progress(&original);
    expired.expires_at = std::time::Instant::now();
    assert!(Outbox::initialize(&path.0, &KEY, &binding, &expired).is_err());
    assert!(inventory(&path.0).is_empty());
    let mut sender = initialize(&path.0);
    let before = inventory(&path.0);
    assert!(sender.freeze(&binding, &original, &expired).is_err());
    assert_eq!(inventory(&path.0), before);
    sender
        .freeze(&binding, &original, &progress(&original))
        .unwrap();
    let before = inventory(&path.0);
    assert!(sender.cancel(&binding, &expired).is_err());
    assert!(sender.flight(&binding, &expired).is_err());
    let mut flight = sender.flight(&binding, &progress(&original)).unwrap();
    flight.expires_at = std::time::Instant::now();
    assert!(flight.request_bytes(&binding).is_err());
    assert_eq!(inventory(&path.0), before);
}
