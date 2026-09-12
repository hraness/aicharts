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

#[path = "sender_tests.rs"]
mod sender_tests;

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
    let before_inspection = directory_image(&f.dir());
    assert_eq!(
        ReadOnlyLedger::open(&f.dir(), &LedgerIdentity::Legacy(&KEY)).err(),
        Some(Error::RecoveryRequired)
    );
    assert_eq!(directory_image(&f.dir()), before_inspection);
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

// Exclude access times: reading can update atime without changing application
// state. Assert bytes, inode, mode, mtime/ctime and directory membership instead.
fn directory_image(dir: &Path) -> BTreeMap<String, (Vec<u8>, Vec<u64>)> {
    use std::os::unix::fs::MetadataExt;
    let mut result = BTreeMap::new();
    for path in std::iter::once(dir.to_owned()).chain(
        fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().path()),
    ) {
        let meta = fs::symlink_metadata(&path).unwrap();
        let bytes = if meta.is_file() {
            fs::read(&path).unwrap()
        } else {
            vec![]
        };
        result.insert(
            path.file_name().unwrap().to_string_lossy().into_owned(),
            (
                bytes,
                vec![
                    meta.dev(),
                    meta.ino(),
                    u64::from(meta.mode()),
                    meta.len(),
                    meta.nlink(),
                    meta.mtime() as u64,
                    meta.mtime_nsec() as u64,
                    meta.ctime() as u64,
                    meta.ctime_nsec() as u64,
                ],
            ),
        );
    }
    result
}

#[test]
fn explicit_split_binding_preserves_legacy_and_binds_both_independent_keys() {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let f = Fixture::new();
    drop(f.initialize());
    let before = directory_image(&f.dir());
    let legacy = LedgerIdentity::Legacy(&KEY);
    let mut original = Hmac::<Sha256>::new_from_slice(&KEY).unwrap();
    original.update(b"aicharts-local-ledger-namespace-v1\0");
    assert_eq!(
        crate::storage::namespace(&legacy).unwrap().as_slice(),
        original.finalize().into_bytes().as_slice()
    );
    let occurrence = [0x43; 32];
    let split = LedgerIdentity::SplitKeys {
        checkpoint: &KEY,
        occurrence: &occurrence,
        namespace_version: 1,
    };
    assert_eq!(
        ReadOnlyLedger::open(&f.dir(), &split).err(),
        Some(Error::WrongNamespace)
    );
    assert_eq!(directory_image(&f.dir()), before);
    let target = f.0.join("shadow");
    let mut shadow = Ledger::initialize_with_identity(&target, &split).unwrap();
    shadow
        .commit_scans(0, vec![scan(1, 100, vec![usage(1, 10)])])
        .unwrap();
    drop(shadow);
    let owned = ReadOnlyLedger::open(&target, &split).unwrap();
    assert_eq!(owned.status().tokens, 130);
    assert_eq!(owned.snapshot().checkpoints[&[1; 32]], stamp(100));
    drop(Ledger::open_with_identity(&target, &split).unwrap());
    assert_eq!(
        Ledger::open(&target, &KEY).err(),
        Some(Error::WrongNamespace)
    );
    for identity in [
        LedgerIdentity::SplitKeys {
            checkpoint: &[2; 32],
            occurrence: &occurrence,
            namespace_version: 1,
        },
        LedgerIdentity::SplitKeys {
            checkpoint: &KEY,
            occurrence: &[3; 32],
            namespace_version: 1,
        },
        LedgerIdentity::SplitKeys {
            checkpoint: &KEY,
            occurrence: &occurrence,
            namespace_version: 0,
        },
        LedgerIdentity::SplitKeys {
            checkpoint: &KEY,
            occurrence: &occurrence,
            namespace_version: 2,
        },
        LedgerIdentity::SplitKeys {
            checkpoint: &[0; 32],
            occurrence: &occurrence,
            namespace_version: 1,
        },
        LedgerIdentity::SplitKeys {
            checkpoint: &KEY,
            occurrence: &[0; 32],
            namespace_version: 1,
        },
    ] {
        assert_eq!(
            ReadOnlyLedger::open(&target, &identity).err(),
            Some(Error::WrongNamespace)
        );
        let invalid_target = f.0.join("must-not-create");
        if crate::storage::namespace(&identity).is_err() {
            assert_eq!(
                Ledger::initialize_with_identity(&invalid_target, &identity).err(),
                Some(Error::WrongNamespace)
            );
            assert!(!invalid_target.exists());
        }
    }
    let persisted = fs::read(target.join("usage.sqlite3")).unwrap();
    for key in [&KEY, &occurrence] {
        assert!(!persisted.windows(32).any(|window| window == key));
    }
    assert_eq!(directory_image(&f.dir()), before);
}

#[test]
fn readonly_inventory_is_exact_owned_and_never_acknowledges_or_locks_state() {
    let f = Fixture::new();
    let mut writer = f.initialize();
    writer
        .commit_scans(0, vec![scan(1, 100, vec![usage(2, 20), usage(1, 10)])])
        .unwrap();
    let before = directory_image(&f.dir());
    let view = ReadOnlyLedger::open(&f.dir(), &LedgerIdentity::Legacy(&KEY)).unwrap();
    assert_eq!(view.snapshot().revision, 1);
    assert_eq!(view.status().revision, 1);
    assert_eq!(view.status().pending_records, 2);
    assert_eq!(view.inventory().len(), 2);
    for (index, item) in view.inventory().iter().enumerate() {
        let identity = index as u8 + 1;
        assert_eq!(item.id, [identity; 16]);
        assert_eq!(item.revision, 1);
        assert_eq!(item.frame, frame(usage(identity, u64::from(identity) * 10)));
    }
    view.ensure_unchanged().unwrap();
    assert_eq!(directory_image(&f.dir()), before);
    // An owned view cannot retain SQLite read locks through a caller's parse.
    writer
        .commit_scans(1, vec![scan(1, 200, vec![usage(1, 15), usage(2, 20)])])
        .unwrap();
    assert_eq!(view.ensure_unchanged(), Err(Error::StaleRevision));
    assert_eq!(view.status().output_tokens, 30);
    assert_eq!(view.inventory()[0].frame, frame(usage(1, 10)));
    assert_eq!(writer.status().unwrap().pending_records, 2);
}

#[test]
fn readonly_absent_wrong_key_schema_and_corruption_preserve_every_byte() {
    let missing = Fixture::new();
    assert_eq!(
        ReadOnlyLedger::open(&missing.dir(), &LedgerIdentity::Legacy(&KEY)).err(),
        Some(Error::PrivateStateRequired)
    );
    assert!(!missing.dir().exists());
    for sql in [
        "PRAGMA user_version=2",
        "PRAGMA application_id=123",
        "CREATE TABLE unexpected(data TEXT)",
        "DELETE FROM meta",
        "UPDATE meta SET revision=-1",
        "DELETE FROM outbox",
        "UPDATE measurements SET id=zeroblob(16)",
    ] {
        let f = Fixture::new();
        let mut ledger = f.initialize();
        ledger
            .commit_scans(0, vec![scan(1, 100, vec![usage(1, 10)])])
            .unwrap();
        drop(ledger);
        f.raw()
            .execute_batch(&format!("PRAGMA ignore_check_constraints=ON; {sql}"))
            .unwrap();
        let before = directory_image(&f.dir());
        assert!(
            ReadOnlyLedger::open(&f.dir(), &LedgerIdentity::Legacy(&KEY)).is_err(),
            "accepted {sql}"
        );
        assert_eq!(directory_image(&f.dir()), before, "changed {sql}");
    }
    let f = Fixture::new();
    drop(f.initialize());
    let before = directory_image(&f.dir());
    assert_eq!(
        ReadOnlyLedger::open(&f.dir(), &LedgerIdentity::Legacy(&[9; 32])).err(),
        Some(Error::WrongNamespace)
    );
    assert_eq!(directory_image(&f.dir()), before);
}

#[test]
fn readonly_rejects_all_sidecars_including_empty_foreign_and_linked_files() {
    use std::os::unix::fs::symlink;
    for name in [
        "usage.sqlite3-journal",
        "usage.sqlite3-wal",
        "usage.sqlite3-shm",
    ] {
        for bytes in [vec![], vec![0x5a; 2048]] {
            let f = Fixture::new();
            drop(f.initialize());
            fs::write(f.dir().join(name), bytes).unwrap();
            let before = directory_image(&f.dir());
            assert_eq!(
                ReadOnlyLedger::open(&f.dir(), &LedgerIdentity::Legacy(&KEY)).err(),
                Some(Error::RecoveryRequired)
            );
            assert_eq!(directory_image(&f.dir()), before);
        }
        let f = Fixture::new();
        drop(f.initialize());
        symlink(f.0.join("missing-target"), f.dir().join(name)).unwrap();
        assert_eq!(
            ReadOnlyLedger::open(&f.dir(), &LedgerIdentity::Legacy(&KEY)).err(),
            Some(Error::RecoveryRequired)
        );
        assert!(!f.0.join("missing-target").exists());
        assert!(fs::symlink_metadata(f.dir().join(name))
            .unwrap()
            .is_symlink());
    }
}

#[test]
fn readonly_foreign_wal_header_never_creates_wal_shm_or_recovers() {
    let foreign = Fixture::new();
    drop(foreign.initialize());
    let writer = foreign.raw();
    writer.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE foreign_table(data BLOB); INSERT INTO foreign_table VALUES(zeroblob(100));").unwrap();
    assert!(foreign.dir().join("usage.sqlite3-wal").exists());
    let f = Fixture::new();
    drop(f.initialize());
    // A copied WAL-mode main file without sidecars is deliberately unsupported.
    fs::write(f.database(), fs::read(foreign.database()).unwrap()).unwrap();
    let before = directory_image(&f.dir());
    let result = ReadOnlyLedger::open(&f.dir(), &LedgerIdentity::Legacy(&KEY));
    assert_eq!(directory_image(&f.dir()), before);
    assert!(!f.dir().join("usage.sqlite3-shm").exists());
    assert!(!f.dir().join("usage.sqlite3-wal").exists());
    // Bundled SQLite may refuse the unsupported WAL header at its POSIX lock
    // step before journal-mode validation. Both paths remain fixed failures.
    assert!(matches!(
        result.err(),
        Some(Error::RecoveryRequired | Error::Storage)
    ));
}

#[test]
fn readonly_revision_guard_refuses_replacement_rotation_permissions_and_late_journal() {
    for mutation in 0..4 {
        let f = Fixture::new();
        drop(f.initialize());
        let view = ReadOnlyLedger::open(&f.dir(), &LedgerIdentity::Legacy(&KEY)).unwrap();
        match mutation {
            0 => {
                let replacement = f.0.join("replacement");
                fs::copy(f.database(), &replacement).unwrap();
                fs::rename(replacement, f.database()).unwrap();
            }
            1 => f
                .raw()
                .execute_batch("UPDATE meta SET namespace=zeroblob(32)")
                .unwrap(),
            2 => fs::set_permissions(f.database(), fs::Permissions::from_mode(0o644)).unwrap(),
            _ => fs::write(f.dir().join("usage.sqlite3-journal"), b"owned-race").unwrap(),
        }
        let before = directory_image(&f.dir());
        assert!(view.ensure_unchanged().is_err());
        assert_eq!(directory_image(&f.dir()), before);
    }
}

#[test]
fn readonly_preopen_races_fail_without_opening_or_cleaning_new_state() {
    let f = Fixture::new();
    drop(f.initialize());
    let mut changed = None;
    let result = ReadOnlyLedger::open_with(&f.dir(), &LedgerIdentity::Legacy(&KEY), || {
        fs::write(f.dir().join("usage.sqlite3-wal"), b"foreign").unwrap();
        changed = Some(directory_image(&f.dir()));
        Ok(())
    });
    assert_eq!(result.err(), Some(Error::RecoveryRequired));
    assert_eq!(directory_image(&f.dir()), changed.unwrap());
}

#[test]
fn readonly_preserves_busy_writer_without_recovery() {
    let f = Fixture::new();
    drop(f.initialize());
    let writer = f.raw();
    writer.execute_batch("BEGIN EXCLUSIVE").unwrap();
    let before = directory_image(&f.dir());
    assert_eq!(
        ReadOnlyLedger::open(&f.dir(), &LedgerIdentity::Legacy(&KEY)).err(),
        Some(Error::Busy)
    );
    assert_eq!(directory_image(&f.dir()), before);
    writer.execute_batch("ROLLBACK").unwrap();
    ReadOnlyLedger::open(&f.dir(), &LedgerIdentity::Legacy(&KEY)).unwrap();
}

#[test]
fn readonly_connection_itself_cannot_write_even_without_the_public_guard() {
    let f = Fixture::new();
    drop(f.initialize());
    let before = directory_image(&f.dir());
    let connection =
        crate::inspection::readonly_connection_for_test(&f.dir(), &LedgerIdentity::Legacy(&KEY))
            .unwrap();
    assert!(connection.is_readonly("main").unwrap());
    assert_eq!(
        connection
            .pragma_query_value(None, "query_only", |row| row.get::<_, i32>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        connection
            .pragma_query_value(None, "locking_mode", |row| row.get::<_, String>(0))
            .unwrap(),
        "exclusive"
    );
    // Disabling a connection-local guard cannot turn the OS/SQLite handle into
    // a writer. This internal test access is absent from the public API.
    connection.pragma_update(None, "query_only", false).unwrap();
    let error = connection
        .execute("UPDATE meta SET revision=1", [])
        .unwrap_err();
    assert_eq!(
        error.sqlite_error_code(),
        Some(rusqlite::ErrorCode::ReadOnly)
    );
    drop(connection);
    assert_eq!(directory_image(&f.dir()), before);
}

#[test]
fn readonly_connection_rejects_wal_raced_after_open_before_first_database_read() {
    let f = Fixture::new();
    drop(f.initialize());
    let connection =
        crate::inspection::readonly_connection_for_test(&f.dir(), &LedgerIdentity::Legacy(&KEY))
            .unwrap();
    // Deterministically change the mode after opening the read-only connection
    // but before its first database access; normal path guards would also fail.
    f.raw().execute_batch("PRAGMA journal_mode=WAL").unwrap();
    assert!(!f.dir().join("usage.sqlite3-wal").exists());
    assert!(!f.dir().join("usage.sqlite3-shm").exists());
    let before = directory_image(&f.dir());
    let result = crate::storage::validate_schema(
        &connection,
        &crate::storage::namespace(&LedgerIdentity::Legacy(&KEY)).unwrap(),
        true,
    );
    drop(connection);
    assert_eq!(directory_image(&f.dir()), before);
    assert!(matches!(
        result,
        Err(Error::Storage | Error::RecoveryRequired)
    ));
}

#[test]
fn readonly_handle_never_recovers_a_hot_journal_raced_after_open() {
    let f = Fixture::new();
    let mut ledger = f.initialize();
    ledger
        .commit_scans(0, vec![scan(1, 100, vec![usage(1, 10)])])
        .unwrap();
    drop(ledger);
    let connection =
        crate::inspection::readonly_connection_for_test(&f.dir(), &LedgerIdentity::Legacy(&KEY))
            .unwrap();
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
    let before = directory_image(&f.dir());
    let error = connection
        .pragma_query_value(None, "application_id", |row| row.get::<_, i32>(0))
        .unwrap_err();
    assert_eq!(
        error.sqlite_extended_error_code(),
        Some(rusqlite::ffi::SQLITE_READONLY_ROLLBACK)
    );
    assert_eq!(Error::from(error), Error::RecoveryRequired);
    drop(connection);
    assert_eq!(directory_image(&f.dir()), before);
    // The original writer recovery remains a distinct, explicit path.
    assert_eq!(summary(&f.open()), (1, 1, 1, 1, 130, 10));
}

#[test]
fn readonly_guard_refuses_parent_alias_retargeting_and_unsafe_final_paths() {
    let f = Fixture::new();
    drop(f.initialize());
    let other = Fixture::new();
    drop(other.initialize());
    let alias = f.0.join("parent-alias");
    std::os::unix::fs::symlink(&f.0, &alias).unwrap();
    let requested = alias.join("state");
    let view = ReadOnlyLedger::open(&requested, &LedgerIdentity::Legacy(&KEY)).unwrap();
    fs::remove_file(&alias).unwrap();
    std::os::unix::fs::symlink(&other.0, &alias).unwrap();
    let before = directory_image(&other.dir());
    assert_eq!(view.ensure_unchanged(), Err(Error::StaleRevision));
    assert_eq!(directory_image(&other.dir()), before);
    let final_alias = f.0.join("state-alias");
    std::os::unix::fs::symlink(f.dir(), &final_alias).unwrap();
    assert_eq!(
        ReadOnlyLedger::open(&final_alias, &LedgerIdentity::Legacy(&KEY)).err(),
        Some(Error::PrivateStateRequired)
    );
    fs::hard_link(f.database(), f.0.join("database-hardlink")).unwrap();
    let before = directory_image(&f.dir());
    assert_eq!(
        ReadOnlyLedger::open(&f.dir(), &LedgerIdentity::Legacy(&KEY)).err(),
        Some(Error::PrivateStateRequired)
    );
    assert_eq!(directory_image(&f.dir()), before);
}
