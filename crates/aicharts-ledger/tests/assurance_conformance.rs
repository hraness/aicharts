//! Bounded real SQLite/storage conformance. Every fixture and journal is
//! synthetic; this does not authenticate an external receipt or provider.
#![cfg(unix)]

use aicharts_core::Collection;
use aicharts_ledger::{
    BatchSettlement, CompletePrefix, Error, FrozenBatch, Ledger, LedgerIdentity, PrefixScan,
    ReadOnlyLedger, SenderBinding, SourceStamp,
};
use aicharts_protocol::{
    admission as wire, AuthMode, Batch, Evidence, Policy, Provider, Registry, Tokens, Usage,
};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

const SEEDS: [u32; 3] = [0x104729, 0x20260923, 0x5eedc0de];
const CHECKPOINT_KEY: [u8; 32] = [0x31; 32];
const OCCURRENCE_KEY: [u8; 32] = [0x32; 32];
const BINDING: SenderBinding = SenderBinding {
    account_id: [0x33; 16],
    device_id: [0x34; 32],
    generation: [0x35; 32],
    namespace_version: 1,
};
fn identity() -> LedgerIdentity<'static> {
    LedgerIdentity::SplitKeys {
        checkpoint: &CHECKPOINT_KEY,
        occurrence: &OCCURRENCE_KEY,
        namespace_version: 1,
    }
}
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let mut random = [0; 16];
        getrandom::fill(&mut random).unwrap();
        let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let path = std::fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("aicharts-conformance-{suffix}"));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn ledger(&self) -> PathBuf {
        self.0.join("ledger")
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        // Exactly the fresh synthetic directory owned by this fixture.
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}
fn random(state: &mut u32, bound: u32) -> u32 {
    *state ^= *state << 13;
    *state ^= *state >> 17;
    *state ^= *state << 5;
    *state % bound
}
fn policy(registry: &Registry) -> Policy<'_> {
    Policy {
        first_day: 0,
        last_day: u32::MAX,
        registry,
    }
}
fn collection(index: usize, level: u64, input: u64) -> Collection {
    Collection {
        batches: vec![Batch {
            utc_day: 20_000,
            registry_revision: 1,
            usage: vec![Usage {
                id: [index as u8 + 1; 16],
                execution_id: [7; 16],
                account_id: [0; 16],
                offset_ms: 1000,
                provider: Provider::ClaudeCode,
                auth_mode: AuthMode::Unknown,
                evidence: Evidence::Imported,
                model_id: 0,
                context_tier: 0,
                tokens: Tokens {
                    input_uncached: input,
                    output: level * 10,
                    ..Tokens::default()
                },
            }],
            prompts: vec![],
            intervals: vec![],
        }],
        warnings: vec![],
        lines_read: 1,
    }
}
fn scan(index: usize, old: u64, level: u64, input: u64) -> PrefixScan {
    let witness = |version: u64| CompletePrefix {
        profile: 1,
        bytes: version * 100,
        mac: [version as u8; 32],
    };
    PrefixScan {
        source_id: [index as u8 + 1; 32],
        stamp: SourceStamp {
            device: 1,
            inode: index as u64 + 1,
            bytes: level * 100,
            modified_seconds: level as i64,
            modified_nanos: 0,
            changed_seconds: level as i64,
            changed_nanos: 0,
        },
        previous: (old != 0).then(|| witness(old)),
        complete: witness(level),
        collection: collection(index, level, input),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Model {
    revision: u64,
    facts: [u64; 2],
    acked: [u64; 2],
    frozen: [u64; 2],
    allocated: u64,
    settled: u64,
}
impl Model {
    fn pending(&self) -> Vec<usize> {
        (0..2).filter(|&i| self.facts[i] > self.acked[i]).collect()
    }
    fn json(&self) -> String {
        format!(
            "{{\"revision\":{},\"facts\":{:?},\"acked\":{:?},\"frozen\":{:?},\"allocated\":{},\"settled\":{},\"pending\":{:?}}}",
            self.revision,
            self.facts,
            self.acked,
            self.frozen,
            self.allocated,
            self.settled,
            self.pending()
        )
    }
}
struct Trace {
    seed: u32,
    steps: Vec<String>,
    coverage: BTreeSet<String>,
}
impl Trace {
    fn check(
        &mut self,
        command: &str,
        outcome: &str,
        ledger: &Ledger,
        dir: &Path,
        model: &Model,
        input: [u64; 2],
    ) {
        let registry = Registry {
            revision: 1,
            models: vec![],
        };
        let snapshot = ledger.snapshot().unwrap();
        let prefix = ledger.prefix_snapshot().unwrap();
        let inspected = ReadOnlyLedger::open(dir, &identity()).unwrap();
        let mut facts = [0; 2];
        for row in inspected.inventory() {
            let decoded = aicharts_protocol::decode(&row.frame, &policy(&registry)).unwrap();
            let record = &decoded.usage[0];
            let index = usize::from(record.id[0] - 1);
            facts[index] = record.tokens.output / 10;
            assert_eq!(
                record.tokens.input_uncached, input[index],
                "CONFORMANCE:M2:{command}:input"
            );
        }
        let mut frozen = [0; 2];
        if let Some(batch) = ledger.inflight_batch().unwrap() {
            for operation in wire::decode_batch(&batch.canonical_batch, &policy(&registry))
                .unwrap()
                .operations
            {
                if let wire::OperationKind::Put { frame } = operation.kind {
                    let record = &aicharts_protocol::decode(&frame, &policy(&registry))
                        .unwrap()
                        .usage[0];
                    frozen[usize::from(record.id[0] - 1)] = record.tokens.output / 10;
                } else {
                    panic!("CONFORMANCE:M2:{command}:unexpected-delete");
                }
            }
        }
        let sender = ledger.sender_status().unwrap();
        let actual = Model {
            revision: snapshot.revision,
            facts,
            // The public sender API exposes accepted sequence/count, while
            // persisted exact accepted frames provide the version abstraction.
            acked: {
                let connection = rusqlite::Connection::open_with_flags(
                    dir.join("usage.sqlite3"),
                    rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
                )
                .unwrap();
                let mut query = connection
                    .prepare("SELECT operation FROM sender_accepted ORDER BY id")
                    .unwrap();
                let mut accepted = [0; 2];
                for bytes in query.query_map([], |row| row.get::<_, Vec<u8>>(0)).unwrap() {
                    let operation =
                        wire::decode_operation(&bytes.unwrap(), &policy(&registry)).unwrap();
                    if let wire::OperationKind::Put { frame } = operation.kind {
                        let record = &aicharts_protocol::decode(&frame, &policy(&registry))
                            .unwrap()
                            .usage[0];
                        accepted[usize::from(record.id[0] - 1)] = record.tokens.output / 10;
                    }
                }
                accepted
            },
            frozen,
            allocated: sender.allocated_sequence,
            settled: sender.settled_sequence,
        };
        assert_eq!(
            &actual, model,
            "CONFORMANCE:M2:{command}:state seed={}",
            self.seed
        );
        let pending: Vec<_> = ledger
            .pending(None, 256, None)
            .unwrap()
            .entries
            .into_iter()
            .map(|row| usize::from(row.id[0] - 1))
            .collect();
        assert_eq!(pending, model.pending(), "CONFORMANCE:M2:{command}:pending");
        for (index, expected) in model.facts.iter().enumerate() {
            let source = [index as u8 + 1; 32];
            assert_eq!(
                snapshot
                    .checkpoints
                    .get(&source)
                    .map_or(0, |stamp| stamp.bytes),
                expected * 100,
                "CONFORMANCE:M2:{command}:cursor"
            );
            assert_eq!(
                prefix
                    .checkpoints
                    .get(&source)
                    .and_then(|checkpoint| checkpoint.prefix)
                    .map_or(0, |value| value.bytes),
                expected * 100,
                "CONFORMANCE:M2:{command}:complete-prefix"
            );
        }
        let expected_total: u64 = model
            .facts
            .iter()
            .enumerate()
            .filter(|(_, level)| **level != 0)
            .map(|(index, level)| input[index] + level * 10)
            .sum();
        assert_eq!(
            ledger.status().unwrap().tokens,
            expected_total,
            "CONFORMANCE:M2:{command}:total"
        );
        self.coverage.insert(format!("{command}:{outcome}"));
        self.steps.push(format!("{{\"command\":\"{command}\",\"input\":{{\"tokens\":{input:?}}},\"outcome\":\"{outcome}\",\"expected\":{},\"actual\":{}}}", model.json(), actual.json()));
    }
    fn finish(self) {
        for required in [
            "commit:ok",
            "freeze:ok",
            "exact-retry:ok",
            "oversized-source:limit",
            "invalid-receipt:invalid",
            "settle-old:ok",
            "reopen:ok",
            "settle-current:ok",
            "receipt-retry:ok",
        ] {
            assert!(
                self.coverage.contains(required),
                "CONFORMANCE:M2:missing-coverage:{required}"
            );
        }
        let coverage = self
            .coverage
            .iter()
            .map(|item| format!("\"{item}\""))
            .collect::<Vec<_>>()
            .join(",");
        println!(
            "ASSURANCE_CONFORMANCE {{\"schemaVersion\":1,\"model\":\"M2\",\"seed\":{},\"coverage\":[{}],\"steps\":[{}]}}",
            self.seed,
            coverage,
            self.steps.join(",")
        );
    }
}

fn receipt(frozen: &FrozenBatch, account_revision: u64) -> Vec<u8> {
    let registry = Registry {
        revision: 1,
        models: vec![],
    };
    let batch = wire::decode_batch(&frozen.canonical_batch, &policy(&registry)).unwrap();
    let receipts = batch
        .operations
        .iter()
        .map(|operation| {
            let hash = wire::operation_digest(operation, &policy(&registry)).unwrap();
            wire::Receipt {
                descriptor: operation.descriptor(),
                operation_hash: hash,
                head_operation_hash: hash,
                account_journal_revision: account_revision,
                committed_at_ms: 1_800_000_000_000,
                outcome: if operation.expected_head == [0; 32] {
                    wire::Outcome::Inserted
                } else {
                    wire::Outcome::Replaced
                },
            }
        })
        .collect();
    wire::encode_journal(&wire::Journal {
        binding: batch.binding,
        first_sequence: frozen.first_sequence,
        batch_hash: frozen.batch_hash,
        account_journal_revision: account_revision,
        committed_at_ms: 1_800_000_000_000,
        status: wire::JournalStatus::Accepted,
        receipts,
    })
    .unwrap()
}

#[test]
fn generated_ledger_cursor_frozen_outbox_and_old_ack_schedules() {
    for seed in SEEDS {
        let fixture = Fixture::new();
        drop(Ledger::initialize_with_identity(&fixture.ledger(), &identity()).unwrap());
        drop(Ledger::migrate_sender_v2(&fixture.ledger(), &identity(), 0, &BINDING).unwrap());
        let mut ledger =
            Ledger::migrate_complete_prefix(&fixture.ledger(), &identity(), 0).unwrap();
        let mut state = seed;
        let input = [
            10 + u64::from(random(&mut state, 100)),
            10 + u64::from(random(&mut state, 100)),
        ];
        let order = if random(&mut state, 2) == 0 {
            [0, 1]
        } else {
            [1, 0]
        };
        let mut model = Model {
            revision: 0,
            facts: [0; 2],
            acked: [0; 2],
            frozen: [0; 2],
            allocated: 0,
            settled: 0,
        };
        let mut trace = Trace {
            seed,
            steps: vec![],
            coverage: BTreeSet::new(),
        };
        for index in order {
            ledger
                .commit_prefix_scans(model.revision, vec![scan(index, 0, 1, input[index])])
                .unwrap();
            model.facts[index] = 1;
            model.revision += 1;
            trace.check("commit", "ok", &ledger, &fixture.ledger(), &model, input);
        }
        let selected = model.revision;
        let frozen = ledger
            .freeze_upload_batch(selected, &[[1; 16], [2; 16]])
            .unwrap();
        model.frozen = model.facts;
        model.allocated = 2;
        model.revision += 1;
        trace.check("freeze", "ok", &ledger, &fixture.ledger(), &model, input);
        for _ in 0..1 + random(&mut state, 3) {
            assert_eq!(
                ledger
                    .freeze_upload_batch(selected, &[[2; 16], [1; 16]])
                    .unwrap(),
                frozen
            );
            trace.check(
                "exact-retry",
                "ok",
                &ledger,
                &fixture.ledger(),
                &model,
                input,
            );
        }
        for index in order {
            ledger
                .commit_prefix_scans(model.revision, vec![scan(index, 1, 2, input[index])])
                .unwrap();
            model.facts[index] = 2;
            model.revision += 1;
            trace.check("commit", "ok", &ledger, &fixture.ledger(), &model, input);
        }
        let mut oversized = scan(0, 2, 2, input[0]);
        oversized.stamp.bytes = 1_024 * 1_024 * 1_024 + 1;
        assert_eq!(
            ledger
                .commit_prefix_scans(model.revision, vec![oversized])
                .err(),
            Some(Error::Limit)
        );
        trace.check(
            "oversized-source",
            "limit",
            &ledger,
            &fixture.ledger(),
            &model,
            input,
        );
        assert_eq!(
            ledger.settle_upload_batch(&[0; 424]).err(),
            Some(Error::InvalidReceipt)
        );
        trace.check(
            "invalid-receipt",
            "invalid",
            &ledger,
            &fixture.ledger(),
            &model,
            input,
        );
        let old_receipt = receipt(&frozen, 1);
        assert!(matches!(
            ledger.settle_upload_batch(&old_receipt).unwrap(),
            BatchSettlement::Accepted {
                cleared_records: 0,
                retained_newer: 2,
                ..
            }
        ));
        model.acked = model.frozen;
        model.frozen = [0; 2];
        model.settled = 2;
        model.revision += 1;
        trace.check(
            "settle-old",
            "ok",
            &ledger,
            &fixture.ledger(),
            &model,
            input,
        );
        drop(ledger);
        ledger = Ledger::open_with_identity(&fixture.ledger(), &identity()).unwrap();
        trace.check("reopen", "ok", &ledger, &fixture.ledger(), &model, input);
        let next = ledger
            .freeze_upload_batch(model.revision, &[[1; 16], [2; 16]])
            .unwrap();
        model.frozen = model.facts;
        model.allocated = 4;
        model.revision += 1;
        trace.check("freeze", "ok", &ledger, &fixture.ledger(), &model, input);
        let latest = receipt(&next, 2);
        assert!(matches!(
            ledger.settle_upload_batch(&latest).unwrap(),
            BatchSettlement::Accepted {
                cleared_records: 2,
                retained_newer: 0,
                ..
            }
        ));
        model.acked = model.facts;
        model.frozen = [0; 2];
        model.settled = 4;
        model.revision += 1;
        trace.check(
            "settle-current",
            "ok",
            &ledger,
            &fixture.ledger(),
            &model,
            input,
        );
        assert!(matches!(
            ledger.settle_upload_batch(&latest).unwrap(),
            BatchSettlement::AlreadySettled { .. }
        ));
        trace.check(
            "receipt-retry",
            "ok",
            &ledger,
            &fixture.ledger(),
            &model,
            input,
        );
        trace.finish();
    }
}
