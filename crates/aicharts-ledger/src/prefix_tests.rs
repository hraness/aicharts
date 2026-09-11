//! Complete-prefix tests reuse synthetic source and sender fixtures only.
use super::*;

fn witness(bytes: u64, mac: u8) -> CompletePrefix {
    CompletePrefix {
        profile: 1,
        bytes,
        mac: [mac; 32],
    }
}

fn prefix_scan(
    source: u8,
    bytes: u64,
    previous: Option<CompletePrefix>,
    complete: CompletePrefix,
    records: Vec<Usage>,
) -> PrefixScan {
    PrefixScan {
        source_id: [source; 32],
        stamp: stamp(bytes),
        previous,
        complete,
        collection: collection(records),
    }
}

fn migrated(sender: bool) -> (Fixture, Ledger) {
    let (f, ledger) = setup(3, sender);
    let revision = ledger.snapshot().unwrap().revision;
    drop(ledger);
    let ledger = Ledger::migrate_complete_prefix(&f.dir(), &identity(), revision).unwrap();
    (f, ledger)
}

fn baseline(ledger: &mut Ledger) {
    let revision = ledger.snapshot().unwrap().revision;
    ledger
        .commit_prefix_scans(
            revision,
            vec![prefix_scan(
                1,
                100,
                None,
                witness(80, 1),
                (1..=3).map(|n| record(n, 10)).collect(),
            )],
        )
        .unwrap();
}

fn table_image(connection: &Connection, tables: &[&str]) -> Vec<Vec<Vec<rusqlite::types::Value>>> {
    tables
        .iter()
        .map(|table| {
            let mut statement = connection
                .prepare(&format!("SELECT * FROM {table} ORDER BY 1"))
                .unwrap();
            let columns = statement.column_count();
            statement
                .query_map([], |row| (0..columns).map(|i| row.get(i)).collect())
                .unwrap()
                .map(std::result::Result::unwrap)
                .collect()
        })
        .collect()
}

const BASE: [&str; 5] = ["meta", "sources", "measurements", "source_usage", "outbox"];
const SENDER: [&str; 6] = [
    "sender_binding",
    "sender_batch",
    "sender_batch_members",
    "sender_accepted",
    "sender_settled",
    "sender_reconciliation",
];

#[test]
fn codex_reasoning_coverage_only_replay_preserves_prefix_frames_and_sender_custody() {
    for sender in [false, true] {
        let (_fixture, mut ledger) = migrated(sender);
        baseline(&mut ledger);
        if sender {
            ledger.freeze_upload_batch(2, &[id(1)]).unwrap();
        }
        let prefix = ledger.prefix_snapshot().unwrap();
        let preserved = ["measurements", "source_usage", "outbox", "source_prefixes"];
        let numeric = table_image(&ledger.connection, &preserved);
        let custody = sender.then(|| table_image(&ledger.connection, &SENDER));
        let mut scan = prefix_scan(
            1,
            100,
            Some(witness(80, 1)),
            witness(80, 1),
            (1..=3).map(|n| record(n, 10)).collect(),
        );
        scan.collection.warnings.push(Warning::UnmeasuredReasoning);
        let report = ledger
            .commit_prefix_scans(prefix.revision, vec![scan])
            .unwrap();
        assert_eq!(
            (
                report.revision,
                report.sources_updated,
                report.occurrences_changed
            ),
            (prefix.revision + 1, 1, 0)
        );
        assert!(ledger
            .status()
            .unwrap()
            .warnings
            .contains(&Warning::UnmeasuredReasoning));
        assert_eq!(
            ledger.prefix_snapshot().unwrap().checkpoints,
            prefix.checkpoints
        );
        assert_eq!(table_image(&ledger.connection, &preserved), numeric);
        if let Some(custody) = custody {
            assert_eq!(table_image(&ledger.connection, &SENDER), custody);
        }
    }
}

#[test]
fn legacy_key_migration_preserves_binding_and_explicit_baseline_rows() {
    let f = Fixture::new();
    let mut ledger = f.initialize();
    ledger
        .commit_scans(0, vec![scan(1, 100, vec![usage(1, 10)])])
        .unwrap();
    let base = table_image(&ledger.connection, &BASE);
    drop(ledger);
    let before = directory_image(&f.dir());
    assert_eq!(
        Ledger::migrate_complete_prefix(&f.dir(), &identity(), 1).err(),
        Some(Error::WrongNamespace)
    );
    assert_eq!(
        Ledger::migrate_complete_prefix(&f.dir(), &LedgerIdentity::Legacy(&[4; 32]), 1).err(),
        Some(Error::WrongNamespace)
    );
    assert_eq!(directory_image(&f.dir()), before);
    let mut ledger =
        Ledger::migrate_complete_prefix(&f.dir(), &LedgerIdentity::Legacy(&KEY), 1).unwrap();
    assert_eq!(table_image(&ledger.connection, &BASE), base);
    assert_eq!(ledger.sender_status().err(), Some(Error::SenderNotEnabled));
    let report = ledger
        .commit_prefix_scans(
            1,
            vec![prefix_scan(
                1,
                100,
                None,
                witness(100, 0),
                vec![usage(1, 10)],
            )],
        )
        .unwrap();
    assert_eq!(
        (
            report.revision,
            report.sources_updated,
            report.occurrences_changed
        ),
        (2, 1, 0)
    );
    drop(ledger);
    assert_eq!(
        f.open().prefix_snapshot().unwrap().checkpoints[&[1; 32]].prefix,
        Some(witness(100, 0))
    );
    assert_eq!(
        ReadOnlyLedger::open(&f.dir(), &LedgerIdentity::Legacy(&KEY))
            .unwrap()
            .inventory()
            .len(),
        1
    );
}

#[test]
fn existing_sender_handle_detects_external_prefix_migration_and_cannot_use_old_commit() {
    let (f, mut original) = setup(3, true);
    original.sender_status().unwrap();
    let prior_audit = original.sender_audit.get().unwrap();
    drop(Ledger::migrate_complete_prefix(&f.dir(), &identity(), 1).unwrap());
    assert_eq!(original.sender_status().unwrap().accepted_occurrences, 0);
    assert_ne!(original.sender_audit.get().unwrap(), prior_audit);
    assert_eq!(
        original.commit_scans(1, vec![]).err(),
        Some(Error::CompletePrefixRequired)
    );
    assert!(original.sender_audit.get().is_none());
    baseline(&mut original);
    let frozen = original.freeze_upload_batch(2, &[id(1)]).unwrap();
    original
        .settle_upload_batch(&journal(&frozen, &[wire::Outcome::Inserted]))
        .unwrap();
    assert_eq!(original.status().unwrap().pending_records, 2);
}

#[test]
fn migration_keeps_legacy_layout_data_and_is_explicit_atomic_idempotent() {
    for sender in [false, true] {
        let (f, ledger) = setup(3, sender);
        let base = table_image(&ledger.connection, &BASE);
        let sender_rows = sender.then(|| table_image(&ledger.connection, &SENDER));
        assert!(ledger
            .prefix_snapshot()
            .unwrap()
            .checkpoints
            .values()
            .all(|c| c.prefix.is_none()));
        drop(ledger);
        let before = directory_image(&f.dir());
        let inspection = ReadOnlyLedger::open(&f.dir(), &identity()).unwrap();
        assert!(inspection
            .prefix_snapshot()
            .checkpoints
            .values()
            .all(|c| c.prefix.is_none()));
        drop(reopen(&f));
        assert_eq!(directory_image(&f.dir()), before);
        assert_eq!(
            Ledger::migrate_complete_prefix(&f.dir(), &identity(), 0).err(),
            Some(Error::StaleRevision)
        );
        assert_eq!(
            Ledger::migrate_prefix_with(&f.dir(), &identity(), 1, || Err(Error::Storage)).err(),
            Some(Error::Storage)
        );
        assert_eq!(table_image(&f.raw(), &BASE), base);
        assert_eq!(
            storage::schema_version(&f.raw()).unwrap(),
            if sender { 2 } else { 1 }
        );
        let ledger = Ledger::migrate_complete_prefix(&f.dir(), &identity(), 1).unwrap();
        assert_eq!(
            storage::schema_version(&ledger.connection).unwrap(),
            if sender { 4 } else { 3 }
        );
        assert_eq!(table_image(&ledger.connection, &BASE), base);
        if let Some(rows) = sender_rows {
            assert_eq!(table_image(&ledger.connection, &SENDER), rows);
        }
        assert_eq!(
            ledger.prefix_snapshot().unwrap().checkpoints[&[1; 32]],
            SourceCheckpoint {
                stamp: stamp(100),
                prefix: None
            }
        );
        assert_eq!(
            table_count(&ledger.connection, "source_prefixes").unwrap(),
            1
        );
        assert_eq!(inspection.ensure_unchanged(), Err(Error::StaleRevision));
        drop(ledger);
        let before = directory_image(&f.dir());
        drop(Ledger::migrate_complete_prefix(&f.dir(), &identity(), 0).unwrap());
        assert_eq!(directory_image(&f.dir()), before);
        let view = ReadOnlyLedger::open(&f.dir(), &identity()).unwrap();
        assert_eq!(view.inventory().len(), 3);
        assert_eq!(directory_image(&f.dir()), before);
    }
}

#[test]
fn prefix_migration_preserves_accepted_reconciliation_inflight_and_revocation() {
    for phase in ["accepted", "gated", "inflight", "revoked"] {
        let (f, mut ledger) = setup(3, true);
        let frozen = ledger.freeze_upload_batch(1, &[id(1)]).unwrap();
        let outcome = match phase {
            "gated" => wire::Outcome::PredecessorConflict,
            "revoked" => wire::Outcome::DeviceRevoked,
            _ => wire::Outcome::Inserted,
        };
        ledger
            .settle_upload_batch(&journal(&frozen, &[outcome]))
            .unwrap();
        if phase == "inflight" {
            ledger.freeze_upload_batch(3, &[id(2), id(3)]).unwrap();
        }
        let revision = ledger.snapshot().unwrap().revision;
        let base = table_image(&ledger.connection, &BASE);
        let rows = table_image(&ledger.connection, &SENDER);
        let status = ledger.sender_status().unwrap();
        let inflight = ledger.inflight_batch().unwrap();
        let last = ledger.last_settled_batch().unwrap();
        drop(ledger);
        let mut ledger = Ledger::migrate_complete_prefix(&f.dir(), &identity(), revision).unwrap();
        assert_eq!(table_image(&ledger.connection, &BASE), base);
        assert_eq!(table_image(&ledger.connection, &SENDER), rows);
        assert_eq!(ledger.sender_status().unwrap(), status);
        assert_eq!(ledger.inflight_batch().unwrap(), inflight);
        assert_eq!(ledger.last_settled_batch().unwrap(), last);
        baseline(&mut ledger);
        assert_eq!(ledger.sender_status().unwrap(), status);
        assert_eq!(ledger.inflight_batch().unwrap(), inflight);
        assert_eq!(ledger.last_settled_batch().unwrap(), last);
        drop(ledger);
        let view = ReadOnlyLedger::open(&f.dir(), &identity()).unwrap();
        assert_eq!(view.inventory().len(), 3);
        assert_eq!(
            view.status().pending_records,
            if matches!(phase, "gated" | "revoked") {
                3
            } else {
                2
            }
        );
    }
}

#[test]
fn sender_migration_on_prefix_layout_preserves_witness_and_never_downgrades() {
    let (f, mut ledger) = migrated(false);
    baseline(&mut ledger);
    let base = table_image(&ledger.connection, &BASE);
    let prefixes = table_image(&ledger.connection, &["source_prefixes"]);
    drop(ledger);
    assert_eq!(
        Ledger::migrate_sender_with(&f.dir(), &identity(), 2, &BINDING, || Err(Error::Storage))
            .err(),
        Some(Error::Storage)
    );
    assert_eq!(storage::schema_version(&f.raw()).unwrap(), 3);
    let mut ledger = Ledger::migrate_sender_v2(&f.dir(), &identity(), 2, &BINDING).unwrap();
    assert_eq!(storage::schema_version(&ledger.connection).unwrap(), 4);
    assert_eq!(table_image(&ledger.connection, &BASE), base);
    assert_eq!(
        table_image(&ledger.connection, &["source_prefixes"]),
        prefixes
    );
    let frozen = ledger.freeze_upload_batch(2, &[id(1)]).unwrap();
    ledger
        .settle_upload_batch(&journal(&frozen, &[wire::Outcome::Inserted]))
        .unwrap();
    assert_eq!(ledger.status().unwrap().pending_records, 2);
    drop(ledger);
    let before = directory_image(&f.dir());
    drop(Ledger::migrate_sender_v2(&f.dir(), &identity(), 0, &BINDING).unwrap());
    assert_eq!(directory_image(&f.dir()), before);
    assert_eq!(storage::schema_version(&f.raw()).unwrap(), 4);
}

#[test]
fn old_commit_api_cannot_bypass_prefix_layout_even_for_empty_scan() {
    for sender in [false, true] {
        let (f, mut ledger) = migrated(sender);
        for scans in [
            vec![],
            vec![scan(1, 100, (1..=3).map(|n| record(n, 10)).collect())],
        ] {
            let before = directory_image(&f.dir());
            assert_eq!(
                ledger.commit_scans(1, scans).err(),
                Some(Error::CompletePrefixRequired)
            );
            assert_eq!(directory_image(&f.dir()), before);
        }
        let (f, mut ledger) = setup(3, sender);
        let before = directory_image(&f.dir());
        assert_eq!(
            ledger.commit_prefix_scans(1, vec![]).err(),
            Some(Error::PrefixNotEnabled)
        );
        assert_eq!(directory_image(&f.dir()), before);
    }
}

#[test]
fn first_baseline_advances_only_checkpoint_revision_and_replay_is_idempotent() {
    let (f, mut ledger) = migrated(false);
    let numeric = table_image(
        &ledger.connection,
        &["measurements", "outbox", "source_usage"],
    );
    let view = ReadOnlyLedger::open(&f.dir(), &identity()).unwrap();
    baseline(&mut ledger);
    assert_eq!(ledger.snapshot().unwrap().revision, 2);
    assert_eq!(
        table_image(
            &ledger.connection,
            &["measurements", "outbox", "source_usage"]
        ),
        numeric
    );
    assert_eq!(view.ensure_unchanged(), Err(Error::StaleRevision));
    let result = ledger
        .commit_prefix_scans(
            2,
            vec![prefix_scan(
                1,
                100,
                Some(witness(80, 1)),
                witness(80, 1),
                (1..=3).map(|n| record(n, 10)).collect(),
            )],
        )
        .unwrap();
    assert_eq!(
        (
            result.revision,
            result.sources_updated,
            result.occurrences_changed
        ),
        (2, 0, 0)
    );
    drop(ledger);
    let before = directory_image(&f.dir());
    let view = ReadOnlyLedger::open(&f.dir(), &identity()).unwrap();
    assert_eq!(
        view.prefix_snapshot().checkpoints[&[1; 32]].prefix,
        Some(witness(80, 1))
    );
    assert_eq!(directory_image(&f.dir()), before);
    view.ensure_unchanged().unwrap();
}

#[test]
fn failed_baseline_cannot_erase_history_or_forgive_unobserved_shrink() {
    let (f, mut ledger) = migrated(false);
    for scan in [
        prefix_scan(1, 100, None, witness(80, 1), vec![record(1, 10)]),
        prefix_scan(
            1,
            99,
            None,
            witness(80, 1),
            (1..=3).map(|n| record(n, 10)).collect(),
        ),
        prefix_scan(
            1,
            100,
            None,
            witness(80, 1),
            vec![record(1, 9), record(2, 10), record(3, 10)],
        ),
    ] {
        let before = directory_image(&f.dir());
        assert_eq!(
            ledger.commit_prefix_scans(1, vec![scan]).err(),
            Some(Error::SourceHistoryChanged)
        );
        assert_eq!(directory_image(&f.dir()), before);
        assert!(ledger.prefix_snapshot().unwrap().checkpoints[&[1; 32]]
            .prefix
            .is_none());
    }
}

#[test]
fn witnessed_tail_may_shrink_but_complete_prefix_and_file_identity_cannot() {
    let (f, mut ledger) = migrated(false);
    baseline(&mut ledger);
    let result = ledger
        .commit_prefix_scans(
            2,
            vec![prefix_scan(
                1,
                80,
                Some(witness(80, 1)),
                witness(80, 1),
                (1..=3).map(|n| record(n, 10)).collect(),
            )],
        )
        .unwrap();
    assert_eq!(
        (
            result.revision,
            result.sources_updated,
            result.occurrences_changed
        ),
        (3, 1, 0)
    );
    for mode in 0..5 {
        let mut scan = prefix_scan(
            1,
            100,
            Some(witness(80, 1)),
            witness(90, 2),
            (1..=3).map(|n| record(n, 10)).collect(),
        );
        match mode {
            0 => {
                scan.stamp.bytes = 79;
                scan.complete = witness(79, 2);
            }
            1 => scan.complete = witness(79, 2),
            2 => scan.complete = witness(80, 2),
            3 => scan.stamp.inode += 1,
            _ => scan.stamp.device += 1,
        }
        let before = directory_image(&f.dir());
        assert_eq!(
            ledger.commit_prefix_scans(3, vec![scan]).err(),
            Some(Error::SourceHistoryChanged)
        );
        assert_eq!(directory_image(&f.dir()), before);
    }
    ledger
        .commit_prefix_scans(
            3,
            vec![prefix_scan(
                1,
                100,
                Some(witness(80, 1)),
                witness(100, 2),
                vec![record(1, 20), record(2, 10), record(3, 10), record(4, 10)],
            )],
        )
        .unwrap();
    assert_eq!(ledger.status().unwrap().usage_occurrences, 4);
}

#[test]
fn unchanged_prefix_requires_exact_numeric_result_even_at_new_file_metadata() {
    let (f, mut ledger) = migrated(false);
    baseline(&mut ledger);
    for records in [
        vec![record(1, 10), record(2, 10), record(3, 10), record(4, 10)],
        vec![record(1, 11), record(2, 10), record(3, 10)],
        vec![record(1, 9), record(2, 10), record(3, 10)],
        vec![record(1, 10), record(2, 10)],
    ] {
        let before = directory_image(&f.dir());
        assert_eq!(
            ledger
                .commit_prefix_scans(
                    2,
                    vec![prefix_scan(
                        1,
                        120,
                        Some(witness(80, 1)),
                        witness(80, 1),
                        records
                    )]
                )
                .err(),
            Some(Error::SourceHistoryChanged)
        );
        assert_eq!(directory_image(&f.dir()), before);
    }
}

#[test]
fn prior_witness_and_global_revision_are_independent_compare_and_swap_guards() {
    let (f, mut ledger) = migrated(false);
    baseline(&mut ledger);
    for (revision, previous) in [
        (1, Some(witness(80, 1))),
        (2, None),
        (2, Some(witness(80, 2))),
        (2, Some(witness(79, 1))),
    ] {
        let before = directory_image(&f.dir());
        assert_eq!(
            ledger
                .commit_prefix_scans(
                    revision,
                    vec![prefix_scan(
                        1,
                        120,
                        previous,
                        witness(100, 2),
                        (1..=3).map(|n| record(n, 10)).collect()
                    )]
                )
                .err(),
            Some(Error::StaleRevision)
        );
        assert_eq!(directory_image(&f.dir()), before);
    }
    let mut other = reopen(&f);
    ledger
        .commit_prefix_scans(2, vec![prefix_scan(2, 0, None, witness(0, 0), vec![])])
        .unwrap();
    assert_eq!(
        other.commit_prefix_scans(2, vec![]).err(),
        Some(Error::StaleRevision)
    );
    assert_eq!(
        other.prefix_snapshot().unwrap().checkpoints[&[2; 32]].prefix,
        Some(witness(0, 0))
    );
}

#[test]
fn profile_byte_bounds_and_duplicate_inputs_are_atomic() {
    let (f, mut ledger) = migrated(false);
    for mode in 0..6 {
        let mut scan = prefix_scan(
            1,
            100,
            None,
            witness(80, 1),
            (1..=3).map(|n| record(n, 10)).collect(),
        );
        let expected = match mode {
            0 => {
                scan.complete.profile = 0;
                Error::InvalidMeasurement
            }
            1 => {
                scan.complete.profile = 2;
                Error::InvalidMeasurement
            }
            2 => {
                scan.complete.bytes = 101;
                Error::Limit
            }
            3 => {
                scan.complete.bytes = u64::MAX;
                Error::Limit
            }
            4 => {
                scan.stamp.bytes = 268_435_457;
                Error::Limit
            }
            _ => {
                scan.source_id = [0; 32];
                Error::InvalidMeasurement
            }
        };
        let before = directory_image(&f.dir());
        assert_eq!(
            ledger.commit_prefix_scans(1, vec![scan]).err(),
            Some(expected)
        );
        assert_eq!(directory_image(&f.dir()), before);
    }
    assert_eq!(
        ledger
            .commit_prefix_scans(
                1,
                vec![
                    prefix_scan(2, 0, None, witness(0, 0), vec![]),
                    prefix_scan(2, 0, None, witness(0, 0), vec![])
                ]
            )
            .err(),
        Some(Error::InvalidMeasurement)
    );
    let result = ledger
        .commit_prefix_scans(
            1,
            vec![prefix_scan(
                2,
                268_435_456,
                None,
                witness(268_435_456, 0),
                vec![],
            )],
        )
        .unwrap();
    assert_eq!(result.sources_updated, 1);
    assert_eq!(
        ledger.prefix_snapshot().unwrap().checkpoints[&[2; 32]].prefix,
        Some(witness(268_435_456, 0))
    );
}

#[test]
fn multi_source_failure_and_precommit_failure_roll_back_witness_with_numeric_state() {
    let (f, mut ledger) = migrated(false);
    let before = table_image(&ledger.connection, &BASE);
    let prefix_before = table_image(&ledger.connection, &["source_prefixes"]);
    assert_eq!(
        ledger
            .commit_prefix_scans(
                1,
                vec![
                    prefix_scan(2, 100, None, witness(100, 2), vec![record(4, 10)]),
                    prefix_scan(1, 100, None, witness(100, 1), vec![]),
                ]
            )
            .err(),
        Some(Error::SourceHistoryChanged)
    );
    assert_eq!(
        ledger
            .commit_prefix_with(
                1,
                vec![prefix_scan(
                    1,
                    200,
                    None,
                    witness(180, 1),
                    vec![record(1, 20), record(2, 10), record(3, 10)]
                )],
                || Err(Error::Storage)
            )
            .err(),
        Some(Error::Storage)
    );
    assert_eq!(table_image(&ledger.connection, &BASE), before);
    assert_eq!(
        table_image(&ledger.connection, &["source_prefixes"]),
        prefix_before
    );
    let blocker = f.raw();
    blocker.execute_batch("BEGIN; SELECT * FROM meta").unwrap();
    let reached = std::cell::Cell::new(false);
    assert_eq!(
        ledger
            .commit_prefix_with(
                1,
                vec![prefix_scan(2, 0, None, witness(0, 0), vec![])],
                || {
                    reached.set(true);
                    Ok(())
                }
            )
            .err(),
        Some(Error::Busy)
    );
    assert!(reached.get());
    blocker.execute_batch("ROLLBACK").unwrap();
    assert_eq!(table_image(&ledger.connection, &BASE), before);
    assert_eq!(
        table_image(&ledger.connection, &["source_prefixes"]),
        prefix_before
    );
}

#[test]
fn missing_orphan_partial_and_invalid_witnesses_are_never_treated_as_baseline() {
    for sender in [false, true] {
        for sql in [
            "DELETE FROM source_prefixes",
            "UPDATE source_prefixes SET source_id=zeroblob(32)",
            "PRAGMA ignore_check_constraints=ON; UPDATE source_prefixes SET profile=NULL",
            "PRAGMA ignore_check_constraints=ON; UPDATE source_prefixes SET complete_bytes=NULL",
            "PRAGMA ignore_check_constraints=ON; UPDATE source_prefixes SET prefix_mac=NULL",
            "PRAGMA ignore_check_constraints=ON; UPDATE source_prefixes SET profile=2",
            "PRAGMA ignore_check_constraints=ON; UPDATE source_prefixes SET complete_bytes=-1",
            "UPDATE source_prefixes SET complete_bytes=101",
            "PRAGMA ignore_check_constraints=ON; UPDATE source_prefixes SET prefix_mac=zeroblob(31)",
            "CREATE TABLE alien(value INTEGER)",
        ] {
            let (f,mut ledger)=migrated(sender);
            baseline(&mut ledger);
            if sender { ledger.sender_status().unwrap(); }
            f.raw().execute_batch(sql).unwrap();
            if sender {
                assert!(ledger.sender_status().is_err());
                assert!(ledger.sender_audit.get().is_none());
            }
            assert!(ledger.prefix_snapshot().is_err());
            assert!(ledger.commit_prefix_scans(2,vec![]).is_err());
            drop(ledger);
            let before=directory_image(&f.dir());
            assert!(Ledger::open_with_identity(&f.dir(),&identity()).is_err());
            assert!(ReadOnlyLedger::open(&f.dir(),&identity()).is_err());
            assert!(Ledger::migrate_complete_prefix(&f.dir(),&identity(),2).is_err());
            assert_eq!(directory_image(&f.dir()),before);
        }
    }
}

#[test]
fn exact_schema_rejects_every_wrong_layout_feature_combination() {
    for sender in [false, true] {
        for version in 1..=5 {
            let (f, ledger) = migrated(sender);
            let expected = if sender { 4 } else { 3 };
            if version == expected {
                continue;
            }
            drop(ledger);
            f.raw()
                .pragma_update(None, "user_version", version)
                .unwrap();
            let before = directory_image(&f.dir());
            assert_eq!(
                Ledger::open_with_identity(&f.dir(), &identity()).err(),
                Some(Error::InvalidState)
            );
            assert_eq!(
                ReadOnlyLedger::open(&f.dir(), &identity()).err(),
                Some(Error::InvalidState)
            );
            assert_eq!(directory_image(&f.dir()), before);
        }
    }
}

#[test]
fn prefix_collection_and_same_connection_corruption_invalidate_sender_audit() {
    let (_f, mut ledger) = migrated(true);
    ledger.sender_status().unwrap();
    assert!(ledger.sender_audit.get().is_some());
    baseline(&mut ledger);
    assert!(ledger.sender_audit.get().is_none());
    ledger.sender_status().unwrap();
    assert_eq!(
        ledger
            .commit_prefix_with(
                2,
                vec![prefix_scan(2, 0, None, witness(0, 0), vec![])],
                || Err(Error::Storage)
            )
            .err(),
        Some(Error::Storage)
    );
    assert!(ledger.sender_audit.get().is_none());
    ledger.sender_status().unwrap();
    ledger
        .connection
        .execute("DELETE FROM source_prefixes", [])
        .unwrap();
    assert_eq!(
        ledger.freeze_upload_batch(2, &[id(1)]).err(),
        Some(Error::InvalidState)
    );
    assert!(ledger.sender_audit.get().is_none());
}

#[test]
fn generated_prefix_progress_retains_omitted_sources_and_monotonic_numeric_history() {
    for seed in 0..16u64 {
        let (_f, mut ledger) = migrated(false);
        baseline(&mut ledger);
        let mut previous = witness(80, 1);
        for step in 1..=8u64 {
            let completed = 80 + step * (seed + 1);
            let next = witness(completed, (step + 1) as u8);
            let output = 10 + step;
            let current = ledger.snapshot().unwrap().revision;
            ledger
                .commit_prefix_scans(
                    current,
                    vec![prefix_scan(
                        1,
                        completed + 20,
                        Some(previous),
                        next,
                        vec![record(1, output), record(2, 10), record(3, 10)],
                    )],
                )
                .unwrap();
            let current = ledger.snapshot().unwrap().revision;
            ledger
                .commit_prefix_scans(
                    current,
                    vec![prefix_scan(
                        2,
                        0,
                        if step == 1 { None } else { Some(witness(0, 0)) },
                        witness(0, 0),
                        vec![],
                    )],
                )
                .unwrap();
            assert_eq!(
                ledger.prefix_snapshot().unwrap().checkpoints[&[1; 32]].prefix,
                Some(next)
            );
            assert_eq!(ledger.status().unwrap().usage_occurrences, 3);
            assert_eq!(ledger.status().unwrap().output_tokens, output + 20);
            previous = next;
        }
    }
}

#[test]
fn prefix_process_death_child() {
    let Some(dir) = std::env::var_os("AICHARTS_PREFIX_TEST_CRASH_DIR") else {
        return;
    };
    let dir = PathBuf::from(dir);
    let phase = std::env::var("AICHARTS_PREFIX_TEST_CRASH_PHASE").unwrap();
    if phase == "migrate" {
        Ledger::migrate_prefix_with(&dir, &identity(), 1, || std::process::exit(73)).unwrap();
    } else {
        let mut ledger = Ledger::open_with_identity(&dir, &identity()).unwrap();
        ledger
            .connection
            .execute_batch("PRAGMA cache_size=1; PRAGMA cache_spill=ON;")
            .unwrap();
        ledger
            .commit_prefix_with(
                1,
                vec![prefix_scan(
                    1,
                    200,
                    None,
                    witness(200, 1),
                    vec![record(1, 20), record(2, 10), record(3, 10)],
                )],
                || std::process::exit(73),
            )
            .unwrap();
    }
    panic!("crash injection returned");
}

#[test]
fn process_death_never_partially_migrates_or_admits_prefix_numeric_pair() {
    for sender in [false, true] {
        for phase in ["migrate", "commit"] {
            let (f, ledger) = if phase == "migrate" {
                setup(3, sender)
            } else {
                migrated(sender)
            };
            let base = table_image(&ledger.connection, &BASE);
            let sender_rows = sender.then(|| table_image(&ledger.connection, &SENDER));
            drop(ledger);
            let child = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "tests::sender_tests::prefix_tests::prefix_process_death_child",
                    "--nocapture",
                ])
                .env("AICHARTS_PREFIX_TEST_CRASH_DIR", f.dir())
                .env("AICHARTS_PREFIX_TEST_CRASH_PHASE", phase)
                .output()
                .unwrap();
            assert_eq!(
                child.status.code(),
                Some(73),
                "{}",
                String::from_utf8_lossy(&child.stderr)
            );
            let ledger = reopen(&f);
            assert_eq!(table_image(&ledger.connection, &BASE), base);
            if let Some(rows) = sender_rows {
                assert_eq!(table_image(&ledger.connection, &SENDER), rows);
            }
            assert_eq!(
                storage::schema_version(&ledger.connection).unwrap(),
                match (sender, phase) {
                    (false, "migrate") => 1,
                    (true, "migrate") => 2,
                    (false, _) => 3,
                    _ => 4,
                }
            );
            assert!(ledger.prefix_snapshot().unwrap().checkpoints[&[1; 32]]
                .prefix
                .is_none());
        }
    }
}
