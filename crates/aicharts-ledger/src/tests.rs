//! Every filesystem fixture is synthetic and owned by one test.
#![cfg(unix)]

use super::*;
use aicharts_protocol::{Provider, Tokens, Usage};
use std::fs;
use std::io::Cursor;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::Command;

const KEY: [u8; 32] = [0x7b; 32];
const PRIVATE: &str = "PRIVATE_LEDGER_CANARY_d83e09";

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let mut random = [0; 16];
        getrandom::fill(&mut random).unwrap();
        let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let path = fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("aicharts-ledger-test-{suffix}"));
        fs::DirBuilder::new().create(&path).unwrap();
        Self(path)
    }
    fn dir(&self) -> PathBuf {
        self.0.join("state")
    }
    fn database(&self) -> PathBuf {
        self.dir().join("usage.sqlite3")
    }
    fn initialize(&self) -> Ledger {
        Ledger::initialize(&self.dir(), &KEY).unwrap()
    }
    fn open(&self) -> Ledger {
        Ledger::open(&self.dir(), &KEY).unwrap()
    }
    fn raw(&self) -> Connection {
        let connection = Connection::open(self.database()).unwrap();
        // Corruption fixtures deliberately bypass foreign keys; production opens enable them.
        connection.execute_batch("PRAGMA foreign_keys=OFF").unwrap();
        connection
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        // This exact newly created directory contains only this test's synthetic state.
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn stamp(bytes: u64) -> SourceStamp {
    SourceStamp {
        device: 1,
        inode: 2,
        bytes,
        modified_seconds: 100,
        modified_nanos: 0,
        changed_seconds: 100,
        changed_nanos: 0,
    }
}
fn usage(identity: u8, output: u64) -> Usage {
    Usage {
        id: [identity; 16],
        execution_id: [9; 16],
        account_id: [0; 16],
        offset_ms: 1_000,
        provider: Provider::ClaudeCode,
        auth_mode: AuthMode::Unknown,
        evidence: Evidence::Imported,
        model_id: 0,
        context_tier: 0,
        tokens: Tokens {
            input_uncached: 100,
            cache_read: 20,
            output,
            ..Tokens::default()
        },
    }
}
fn collection(records: Vec<Usage>) -> Collection {
    Collection {
        batches: if records.is_empty() {
            vec![]
        } else {
            vec![Batch {
                utc_day: 20_000,
                registry_revision: 1,
                usage: records,
                prompts: vec![],
                intervals: vec![],
            }]
        },
        warnings: vec![
            Warning::UnmeasuredPrompts,
            Warning::UnmeasuredActivity,
            Warning::UnknownModels,
        ],
        lines_read: 1,
    }
}
fn scan(source: u8, bytes: u64, records: Vec<Usage>) -> SourceScan {
    SourceScan {
        source_id: [source; 32],
        stamp: stamp(bytes),
        collection: collection(records),
    }
}
fn summary(ledger: &Ledger) -> (u64, u64, u64, u64, u64, u64) {
    let status = ledger.status().unwrap();
    (
        status.revision,
        status.sources,
        status.usage_occurrences,
        status.pending_records,
        status.tokens,
        status.output_tokens,
    )
}
fn frame(record: Usage) -> Vec<u8> {
    collection_frames(collection(vec![record]))
        .unwrap()
        .into_values()
        .next()
        .unwrap()
}

#[test]
fn initialize_is_private_explicit_and_bound_to_the_namespace() {
    let f = Fixture::new();
    assert!(Ledger::open(&f.dir(), &KEY).is_err());
    assert!(!f.dir().exists());
    let ledger = f.initialize();
    assert_eq!(summary(&ledger), (0, 0, 0, 0, 0, 0));
    assert_eq!(
        fs::metadata(f.dir()).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(f.database()).unwrap().permissions().mode() & 0o077,
        0
    );
    assert_eq!(
        Ledger::initialize(&f.dir(), &KEY).err(),
        Some(Error::PrivateStateRequired)
    );
    assert_eq!(
        Ledger::open(&f.dir(), &[3; 32]).err(),
        Some(Error::WrongNamespace)
    );
    assert_eq!(
        Ledger::open(&f.dir(), &[0; 32]).err(),
        Some(Error::WrongNamespace)
    );
    assert_eq!(summary(&ledger), (0, 0, 0, 0, 0, 0));
}

#[test]
fn symlinked_ancestor_is_resolved_without_adopting_a_final_state_symlink() {
    let f = Fixture::new();
    let parent_alias = f.0.join("parent-alias");
    std::os::unix::fs::symlink(&f.0, &parent_alias).unwrap();
    let state = parent_alias.join("state");
    let mut ledger = Ledger::initialize(&state, &KEY).unwrap();
    ledger
        .commit_scans(0, vec![scan(1, 100, vec![usage(1, 10)])])
        .unwrap();
    drop(ledger);
    assert_eq!(
        summary(&Ledger::open(&state, &KEY).unwrap()),
        (1, 1, 1, 1, 130, 10)
    );
    let final_alias = parent_alias.join("state-alias");
    std::os::unix::fs::symlink(f.dir(), &final_alias).unwrap();
    assert_eq!(
        Ledger::open(&final_alias, &KEY).err(),
        Some(Error::PrivateStateRequired)
    );
    assert_eq!(
        Ledger::initialize(&final_alias, &KEY).err(),
        Some(Error::PrivateStateRequired)
    );
    assert_eq!(summary(&f.open()), (1, 1, 1, 1, 130, 10));
}

#[test]
fn commits_deduplicate_copies_and_noop_scans_preserve_revision() {
    let f = Fixture::new();
    let mut ledger = f.initialize();
    let first = ledger
        .commit_scans(0, vec![scan(1, 100, vec![usage(1, 10)])])
        .unwrap();
    assert_eq!(
        (
            first.revision,
            first.sources_updated,
            first.occurrences_changed
        ),
        (1, 1, 1)
    );
    let noop = ledger
        .commit_scans(1, vec![scan(1, 100, vec![usage(1, 10)])])
        .unwrap();
    assert_eq!(
        (
            noop.revision,
            noop.sources_updated,
            noop.occurrences_changed
        ),
        (1, 0, 0)
    );
    let copy = ledger
        .commit_scans(1, vec![scan(2, 100, vec![usage(1, 10)])])
        .unwrap();
    assert_eq!(
        (
            copy.revision,
            copy.sources_updated,
            copy.occurrences_changed
        ),
        (2, 1, 0)
    );
    assert_eq!(summary(&ledger), (2, 2, 1, 1, 130, 10));
    drop(ledger);
    assert_eq!(summary(&f.open()), (2, 2, 1, 1, 130, 10));
}

#[test]
fn streaming_revisions_replace_pending_values_without_double_counting() {
    let f = Fixture::new();
    let mut ledger = f.initialize();
    ledger
        .commit_scans(0, vec![scan(1, 100, vec![usage(1, 10)])])
        .unwrap();
    let mut later = usage(1, 30);
    later.offset_ms = 2_000;
    ledger
        .commit_scans(1, vec![scan(1, 200, vec![later.clone()])])
        .unwrap();
    assert_eq!(summary(&ledger), (2, 1, 1, 1, 150, 30));
    let page = ledger.pending(None, 10, None).unwrap();
    assert_eq!(page.entries.len(), 1);
    assert_eq!(page.entries[0].revision, 2);
    assert_eq!(page.entries[0].frame, frame(later));
    ledger
        .commit_scans(2, vec![scan(2, 100, vec![usage(1, 10)])])
        .unwrap();
    assert_eq!(summary(&ledger), (3, 2, 1, 1, 150, 30));
    drop(ledger);
    assert_eq!(summary(&f.open()), (3, 2, 1, 1, 150, 30));
}

#[test]
fn same_source_cannot_lose_occurrences_or_regress_usage() {
    for replacement in [vec![usage(2, 20)], vec![usage(1, 9), usage(2, 20)]] {
        let f = Fixture::new();
        let mut ledger = f.initialize();
        ledger
            .commit_scans(0, vec![scan(1, 100, vec![usage(1, 10), usage(2, 20)])])
            .unwrap();
        let before = summary(&ledger);
        assert_eq!(
            ledger
                .commit_scans(1, vec![scan(1, 200, replacement)])
                .err(),
            Some(Error::SourceHistoryChanged)
        );
        assert_eq!(summary(&ledger), before);
        assert_eq!(ledger.snapshot().unwrap().checkpoints[&[1; 32]], stamp(100));
    }
}

#[test]
fn changed_file_identity_and_shrinking_sources_fail_without_reset() {
    for changed in [
        SourceStamp {
            inode: 3,
            ..stamp(200)
        },
        SourceStamp {
            device: 3,
            ..stamp(200)
        },
        stamp(99),
    ] {
        let f = Fixture::new();
        let mut ledger = f.initialize();
        ledger
            .commit_scans(0, vec![scan(1, 100, vec![usage(1, 10)])])
            .unwrap();
        let before = summary(&ledger);
        let mut changed_scan = scan(1, 200, vec![usage(1, 10)]);
        changed_scan.stamp = changed;
        assert_eq!(
            ledger.commit_scans(1, vec![changed_scan]).err(),
            Some(Error::SourceHistoryChanged)
        );
        assert_eq!(summary(&ledger), before);
    }
}

#[test]
fn conflicting_codex_event_and_incomparable_claude_revision_abort_all_sources() {
    for codex in [false, true] {
        let f = Fixture::new();
        let mut ledger = f.initialize();
        let mut initial = usage(1, 10);
        if codex {
            initial.provider = Provider::Codex;
        }
        ledger
            .commit_scans(0, vec![scan(1, 100, vec![initial.clone()])])
            .unwrap();
        let mut changed = initial;
        changed.tokens.output = 20;
        if !codex {
            changed.tokens.input_uncached = 90;
        }
        let before = summary(&ledger);
        assert_eq!(
            ledger
                .commit_scans(
                    1,
                    vec![
                        scan(2, 100, vec![usage(2, 20)]),
                        scan(3, 100, vec![changed])
                    ]
                )
                .err(),
            Some(Error::InvalidMeasurement)
        );
        assert_eq!(summary(&ledger), before);
        assert_eq!(ledger.snapshot().unwrap().checkpoints.len(), 1);
    }
}

#[test]
fn explicit_transaction_failure_rolls_back_checkpoint_measurements_and_pending() {
    let f = Fixture::new();
    let mut ledger = f.initialize();
    ledger
        .commit_scans(0, vec![scan(1, 100, vec![usage(1, 10)])])
        .unwrap();
    assert_eq!(
        ledger
            .commit_with(
                1,
                vec![scan(1, 200, vec![usage(1, 20), usage(2, 30)])],
                || Err(Error::Storage)
            )
            .err(),
        Some(Error::Storage)
    );
    assert_eq!(summary(&ledger), (1, 1, 1, 1, 130, 10));
    assert_eq!(ledger.snapshot().unwrap().checkpoints[&[1; 32]], stamp(100));
    drop(ledger);
    assert_eq!(summary(&f.open()), (1, 1, 1, 1, 130, 10));
}

#[test]
fn stale_collectors_and_busy_writers_cannot_commit() {
    let f = Fixture::new();
    let mut first = f.initialize();
    let mut second = f.open();
    first
        .commit_scans(0, vec![scan(1, 100, vec![usage(1, 10)])])
        .unwrap();
    assert_eq!(
        second
            .commit_scans(0, vec![scan(2, 100, vec![usage(2, 20)])])
            .err(),
        Some(Error::StaleRevision)
    );
    let tx = first
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    assert_eq!(
        second
            .commit_scans(1, vec![scan(2, 100, vec![usage(2, 20)])])
            .err(),
        Some(Error::Busy)
    );
    drop(tx);
    assert_eq!(summary(&second), (1, 1, 1, 1, 130, 10));
    second
        .commit_scans(1, vec![scan(2, 100, vec![usage(2, 20)])])
        .unwrap();
    assert_eq!(summary(&first), (2, 2, 2, 2, 270, 30));
}

#[test]
fn pending_pages_are_bounded_repeatable_and_pinned_to_one_revision() {
    let f = Fixture::new();
    let mut ledger = f.initialize();
    ledger
        .commit_scans(
            0,
            vec![scan(1, 100, vec![usage(1, 10), usage(2, 20), usage(3, 30)])],
        )
        .unwrap();
    assert_eq!(ledger.pending(None, 0, None).err(), Some(Error::Limit));
    assert_eq!(
        ledger.pending(None, MAX_PAGE + 1, None).err(),
        Some(Error::Limit)
    );
    assert_eq!(
        ledger.pending(Some([1; 16]), 1, None).err(),
        Some(Error::Limit)
    );
    let first = ledger.pending(None, 2, None).unwrap();
    assert_eq!(
        first.entries.iter().map(|row| row.id).collect::<Vec<_>>(),
        vec![[1; 16], [2; 16]]
    );
    assert_eq!(first.next_after, Some([2; 16]));
    let second = ledger
        .pending(first.next_after, 2, Some(first.ledger_revision))
        .unwrap();
    assert_eq!(second.entries[0].id, [3; 16]);
    assert_eq!(second.next_after, None);
    assert_eq!(summary(&ledger), (1, 1, 3, 3, 420, 60));
    ledger
        .commit_scans(1, vec![scan(2, 100, vec![usage(4, 40)])])
        .unwrap();
    assert_eq!(
        ledger
            .pending(first.next_after, 2, Some(first.ledger_revision))
            .err(),
        Some(Error::StaleRevision)
    );
}

#[test]
fn malformed_input_and_limits_fail_before_committing() {
    let f = Fixture::new();
    let mut ledger = f.initialize();
    let too_many = (0..=MAX_SOURCES).map(|_| scan(1, 0, vec![])).collect();
    assert_eq!(ledger.commit_scans(0, too_many).err(), Some(Error::Limit));
    assert_eq!(
        ledger
            .commit_scans(0, vec![scan(1, 0, vec![]), scan(1, 0, vec![])])
            .err(),
        Some(Error::InvalidMeasurement)
    );
    let mut invalid = usage(1, 10);
    invalid.evidence = Evidence::Live;
    assert_eq!(
        ledger
            .commit_scans(0, vec![scan(1, 100, vec![invalid])])
            .err(),
        Some(Error::InvalidMeasurement)
    );
    let mut invalid_stamp = scan(1, 100, vec![usage(1, 10)]);
    invalid_stamp.stamp.modified_nanos = 1_000_000_000;
    assert_eq!(
        ledger.commit_scans(0, vec![invalid_stamp]).err(),
        Some(Error::Limit)
    );
    assert_eq!(summary(&ledger), (0, 0, 0, 0, 0, 0));
}

#[test]
fn persisted_source_cap_is_enforced_without_loading_large_measurement_fixtures() {
    let f = Fixture::new();
    drop(f.initialize());
    f.raw().execute(
        "WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<?1) INSERT INTO sources(id,stamp,warnings) SELECT CAST(printf('%032x',n) AS BLOB),?2,0 FROM ids",
        params![(MAX_SOURCES + 1) as i64, stamp(0).encode().unwrap()],
    ).unwrap();
    assert_eq!(Ledger::open(&f.dir(), &KEY).err(), Some(Error::Limit));
}

#[test]
fn all_three_source_permutations_converge_to_one_final_occurrence() {
    for order in [
        [1, 2, 3],
        [1, 3, 2],
        [2, 1, 3],
        [2, 3, 1],
        [3, 1, 2],
        [3, 2, 1],
    ] {
        let f = Fixture::new();
        let mut ledger = f.initialize();
        let scans = order
            .into_iter()
            .map(|source| {
                let mut record = usage(1, u64::from(source) * 10);
                record.offset_ms = u32::from(source) * 1_000;
                scan(source, 100, vec![record])
            })
            .collect();
        ledger.commit_scans(0, scans).unwrap();
        assert_eq!(summary(&ledger), (1, 3, 1, 1, 150, 30));
        let pending = ledger.pending(None, 1, None).unwrap();
        let canonical = checked_frame(&pending.entries[0].frame).unwrap();
        assert_eq!(canonical.usage[0].offset_ms, 3_000);
        assert_eq!(canonical.usage[0].tokens.output, 30);
        drop(ledger);
        assert_eq!(summary(&f.open()), (1, 3, 1, 1, 150, 30));
    }
}

#[test]
fn schema_version_application_and_foreign_tables_are_not_adopted() {
    for sql in [
        "PRAGMA user_version=2",
        "PRAGMA application_id=7",
        "CREATE TABLE alien(value TEXT)",
    ] {
        let f = Fixture::new();
        drop(f.initialize());
        f.raw().execute_batch(sql).unwrap();
        assert_eq!(
            Ledger::open(&f.dir(), &KEY).err(),
            Some(Error::InvalidState)
        );
        assert!(f.database().exists());
    }
}

#[test]
fn invalid_relational_rows_are_rejected_on_open() {
    for sql in [
        "DELETE FROM outbox",
        "UPDATE outbox SET revision=2",
        "UPDATE measurements SET revision=2",
        "DELETE FROM source_usage",
        "DELETE FROM sources",
        "UPDATE source_usage SET id=zeroblob(16)",
        "UPDATE measurements SET frame=zeroblob(136)",
    ] {
        let f = Fixture::new();
        let mut ledger = f.initialize();
        ledger
            .commit_scans(0, vec![scan(1, 100, vec![usage(1, 10)])])
            .unwrap();
        drop(ledger);
        f.raw().execute_batch(sql).unwrap();
        assert!(
            Ledger::open(&f.dir(), &KEY).is_err(),
            "accepted inconsistent state: {sql}"
        );
    }
}

#[test]
fn invalid_checkpoint_timestamp_is_rejected_on_open() {
    let f = Fixture::new();
    let mut ledger = f.initialize();
    ledger
        .commit_scans(0, vec![scan(1, 100, vec![usage(1, 10)])])
        .unwrap();
    drop(ledger);
    let mut corrupt = stamp(100).encode().unwrap();
    corrupt[32..36].copy_from_slice(&u32::MAX.to_le_bytes());
    f.raw()
        .execute("UPDATE sources SET stamp=?1", [corrupt])
        .unwrap();
    assert_eq!(
        Ledger::open(&f.dir(), &KEY).err(),
        Some(Error::InvalidState)
    );
}

#[test]
fn valid_but_changed_frame_is_rejected_when_it_disagrees_with_associations() {
    let f = Fixture::new();
    let mut ledger = f.initialize();
    ledger
        .commit_scans(0, vec![scan(1, 100, vec![usage(1, 10)])])
        .unwrap();
    drop(ledger);
    let different = frame(usage(1, 20));
    let raw = f.raw();
    raw.execute("UPDATE measurements SET frame=?1", [&different])
        .unwrap();
    raw.execute("UPDATE outbox SET frame=?1", [&different])
        .unwrap();
    drop(raw);
    assert_eq!(
        Ledger::open(&f.dir(), &KEY).err(),
        Some(Error::InvalidState)
    );
}

#[test]
fn read_paths_reject_changed_pending_or_measurement_identity() {
    for pending in [false, true] {
        let f = Fixture::new();
        let mut ledger = f.initialize();
        ledger
            .commit_scans(0, vec![scan(1, 100, vec![usage(1, 10)])])
            .unwrap();
        let raw = f.raw();
        raw.execute(
            if pending {
                "UPDATE outbox SET frame=?1"
            } else {
                "UPDATE measurements SET frame=?1"
            },
            [frame(usage(2, 20))],
        )
        .unwrap();
        drop(raw);
        if pending {
            assert!(ledger.pending(None, 10, None).is_err());
        } else {
            assert!(ledger.status().is_err());
        }
    }
}

#[test]
fn insecure_symlink_hardlink_and_corrupt_database_paths_are_rejected() {
    let f = Fixture::new();
    drop(f.initialize());
    fs::set_permissions(f.dir(), fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(
        Ledger::open(&f.dir(), &KEY).err(),
        Some(Error::PrivateStateRequired)
    );
    fs::set_permissions(f.dir(), fs::Permissions::from_mode(0o700)).unwrap();
    let alias = f.0.join("alias");
    std::os::unix::fs::symlink(f.dir(), &alias).unwrap();
    assert_eq!(
        Ledger::open(&alias, &KEY).err(),
        Some(Error::PrivateStateRequired)
    );
    let hard = f.0.join("database-link");
    fs::hard_link(f.database(), &hard).unwrap();
    assert_eq!(
        Ledger::open(&f.dir(), &KEY).err(),
        Some(Error::PrivateStateRequired)
    );
    fs::remove_file(hard).unwrap();
    fs::write(f.database(), b"not a SQLite database").unwrap();
    assert!(Ledger::open(&f.dir(), &KEY).is_err());
    assert_eq!(fs::read(f.database()).unwrap(), b"not a SQLite database");
}

#[test]
fn metadata_only_state_contains_no_source_content_path_or_namespace_key() {
    let f = Fixture::new();
    let mut ledger = f.initialize();
    let source = format!(
        r#"{{"type":"assistant","requestId":"request_a","sessionId":"session_a","timestamp":"2026-09-10T10:00:00Z","cwd":"{PRIVATE}","message":{{"id":"message_a","content":[{{"type":"text","text":"{PRIVATE}"}}],"usage":{{"input_tokens":100,"output_tokens":10,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}}}}
"#
    );
    let collection =
        aicharts_core::parse_reader(Cursor::new(source.as_bytes()), Provider::ClaudeCode, &KEY)
            .unwrap();
    ledger
        .commit_scans(
            0,
            vec![SourceScan {
                source_id: [1; 32],
                stamp: stamp(source.len() as u64),
                collection,
            }],
        )
        .unwrap();
    drop(ledger);
    for entry in fs::read_dir(f.dir()).unwrap() {
        let entry = entry.unwrap();
        let bytes = fs::read(entry.path()).unwrap();
        for forbidden in [
            PRIVATE.as_bytes(),
            KEY.as_slice(),
            b"request_a",
            b"session_a",
            b"message_a",
            f.0.as_os_str().as_encoded_bytes(),
        ] {
            assert!(!bytes
                .windows(forbidden.len())
                .any(|window| window == forbidden));
        }
    }
}

#[test]
fn process_death_child() {
    let Some(directory) = std::env::var_os("AICHARTS_LEDGER_TEST_CRASH_DIR") else {
        return;
    };
    let directory = PathBuf::from(directory);
    let mut ledger = Ledger::open(&directory, &KEY).unwrap();
    ledger
        .connection
        .execute_batch("PRAGMA cache_size=1; PRAGMA cache_spill=ON;")
        .unwrap();
    ledger
        .commit_with(
            1,
            vec![scan(1, 200, vec![usage(1, 20), usage(2, 30)])],
            || {
                std::process::exit(73);
            },
        )
        .unwrap();
    panic!("crash injection unexpectedly returned");
}

#[test]
fn process_death_before_commit_recovers_without_partial_checkpoint_or_pending() {
    let f = Fixture::new();
    let mut ledger = f.initialize();
    ledger
        .commit_scans(0, vec![scan(1, 100, vec![usage(1, 10)])])
        .unwrap();
    drop(ledger);
    let child = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "tests::process_death_child", "--nocapture"])
        .env("AICHARTS_LEDGER_TEST_CRASH_DIR", f.dir())
        .output()
        .unwrap();
    assert_eq!(
        child.status.code(),
        Some(73),
        "{}",
        String::from_utf8_lossy(&child.stderr)
    );
    let journal = fs::read(f.dir().join("usage.sqlite3-journal")).unwrap();
    assert!(journal.len() > 512);
    assert_eq!(
        &journal[..8],
        &[0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7]
    );
    assert!(!journal.windows(KEY.len()).any(|window| window == KEY));
    assert!(!journal
        .windows(PRIVATE.len())
        .any(|window| window == PRIVATE.as_bytes()));
    let mut recovered = f.open();
    assert_eq!(summary(&recovered), (1, 1, 1, 1, 130, 10));
    assert_eq!(
        recovered.snapshot().unwrap().checkpoints[&[1; 32]],
        stamp(100)
    );
    recovered
        .commit_scans(1, vec![scan(1, 200, vec![usage(1, 20), usage(2, 30)])])
        .unwrap();
    assert_eq!(summary(&recovered), (2, 1, 2, 2, 290, 50));
}
