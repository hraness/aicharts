//! Seeded wire round trips for the usage packet and the admission envelope.
//! Generated values stay inside each codec's published bounds so a failed
//! round trip is a codec defect, not an invalid fixture; separate cases inject
//! exactly one violation and expect its fixed code.
use crate::{config_from_env, receipt_line, Context, Rng};
use aicharts_protocol::admission as wire;
use aicharts_protocol::{
    decode, encode, AuthMode, Batch, Error, Evidence, Id, Interval, IntervalKind, Origin, Policy,
    Prompt, Provider, Registry, Tokens, Usage, DAY_MS, HEADER_BYTES, INTERVAL_BYTES,
    MAX_CLOCK_UNCERTAINTY_MS, MAX_RECORDS, MAX_TOKEN_COUNTER, PROMPT_BYTES, USAGE_BYTES,
};
use std::collections::BTreeMap;

const PROVIDERS: [Provider; 3] = [Provider::Codex, Provider::ClaudeCode, Provider::Devin];
const AUTH_MODES: [AuthMode; 3] = [AuthMode::Unknown, AuthMode::Subscription, AuthMode::Api];
const ORIGINS: [Origin; 3] = [Origin::Unknown, Origin::Human, Origin::Automation];
const EVIDENCE: [Evidence; 2] = [Evidence::Imported, Evidence::Live];
const KINDS: [IntervalKind; 2] = [IntervalKind::AgentWork, IntervalKind::ApiRequest];

fn id(rng: &mut Rng, allow_zero: bool) -> Id {
    if allow_zero && rng.chance(1, 8) {
        return [0; 16];
    }
    let mut value = [0; 16];
    if rng.chance(1, 4) {
        value = rng.bytes();
    } else {
        value[8..].copy_from_slice(&rng.range(1, 1 << 20).to_be_bytes());
    }
    if value == [0; 16] {
        value[15] = 1;
    }
    value
}

fn registry(rng: &mut Rng) -> Registry {
    let models = (0..rng.below(4))
        .map(|_| (*rng.pick(&PROVIDERS), rng.range(1, 1 << 16) as u32))
        .collect();
    Registry {
        revision: rng.range(1, u64::from(u32::MAX)) as u32,
        models,
    }
}

fn tokens(rng: &mut Rng, provider: Provider) -> Tokens {
    let counter = |rng: &mut Rng| match rng.below(4) {
        0 => 0,
        1 => MAX_TOKEN_COUNTER,
        _ => rng.below(1 << 24),
    };
    let output = counter(rng);
    let cache_writes = !matches!(provider, Provider::Codex | Provider::Devin);
    let mut value = Tokens {
        input_uncached: counter(rng),
        cache_read: counter(rng),
        cache_write_5m: if cache_writes { counter(rng) } else { 0 },
        cache_write_1h: if cache_writes { counter(rng) } else { 0 },
        output,
        reasoning_output: if output == 0 {
            0
        } else {
            rng.below(output + 1)
        },
    };
    if value.total().unwrap() == 0 {
        value.input_uncached = 1;
    }
    value
}

fn usage(rng: &mut Rng, registry: &Registry) -> Usage {
    let provider = *rng.pick(&PROVIDERS);
    let known: Vec<u32> = registry
        .models
        .iter()
        .filter(|(p, _)| *p == provider)
        .map(|(_, model)| *model)
        .collect();
    Usage {
        id: id(rng, false),
        execution_id: id(rng, true),
        account_id: id(rng, true),
        offset_ms: rng.below(u64::from(DAY_MS)) as u32,
        provider,
        auth_mode: *rng.pick(&AUTH_MODES),
        evidence: *rng.pick(&EVIDENCE),
        model_id: if known.is_empty() || rng.chance(1, 2) {
            0
        } else {
            *rng.pick(&known)
        },
        context_tier: 0,
        tokens: tokens(rng, provider),
    }
}

fn prompt(rng: &mut Rng) -> Prompt {
    Prompt {
        id: id(rng, false),
        execution_id: id(rng, true),
        account_id: id(rng, true),
        offset_ms: rng.below(u64::from(DAY_MS)) as u32,
        provider: *rng.pick(&PROVIDERS),
        origin: *rng.pick(&ORIGINS),
        evidence: *rng.pick(&EVIDENCE),
    }
}

fn interval(rng: &mut Rng) -> Interval {
    let start = rng.below(u64::from(DAY_MS)) as u32;
    Interval {
        execution_id: id(rng, false),
        account_id: id(rng, true),
        start_ms: start,
        end_ms: rng.range(u64::from(start) + 1, u64::from(DAY_MS)) as u32,
        provider: *rng.pick(&PROVIDERS),
        kind: *rng.pick(&KINDS),
        evidence: *rng.pick(&EVIDENCE),
        clock_uncertainty_ms: rng.below(u64::from(MAX_CLOCK_UNCERTAINTY_MS) + 1) as u32,
    }
}

fn count(rng: &mut Rng) -> u64 {
    match rng.below(8) {
        0 => 0,
        1 => 1,
        2 => rng.below(40),
        _ => rng.below(6),
    }
}

struct Case {
    registry: Registry,
    first_day: u32,
    last_day: u32,
    batch: Batch,
}
impl Case {
    fn policy(&self) -> Policy<'_> {
        Policy {
            first_day: self.first_day,
            last_day: self.last_day,
            registry: &self.registry,
        }
    }
}

/// A canonical valid batch: unique sorted usage and prompt IDs, sorted
/// interval keys, at least one record, and a day inside the policy window.
fn valid_case(rng: &mut Rng) -> Case {
    let registry = registry(rng);
    let first_day = rng.below(30_000) as u32;
    let last_day = first_day + rng.below(2_000) as u32;
    let mut usage_records: BTreeMap<Id, Usage> = BTreeMap::new();
    for _ in 0..count(rng) {
        let record = usage(rng, &registry);
        usage_records.insert(record.id, record);
    }
    let mut prompts: BTreeMap<Id, Prompt> = BTreeMap::new();
    for _ in 0..count(rng) {
        let record = prompt(rng);
        prompts.insert(record.id, record);
    }
    let mut intervals: BTreeMap<(Id, u8, u32, u32, Id, u8), Interval> = BTreeMap::new();
    for _ in 0..count(rng) {
        let record = interval(rng);
        intervals.insert(
            (
                record.execution_id,
                record.kind as u8,
                record.start_ms,
                record.end_ms,
                record.account_id,
                record.provider as u8,
            ),
            record,
        );
    }
    if usage_records.is_empty() && prompts.is_empty() && intervals.is_empty() {
        let record = usage(rng, &registry);
        usage_records.insert(record.id, record);
    }
    let batch = Batch {
        utc_day: rng.range(u64::from(first_day), u64::from(last_day)) as u32,
        registry_revision: registry.revision,
        usage: usage_records.into_values().collect(),
        prompts: prompts.into_values().collect(),
        intervals: intervals.into_values().collect(),
    };
    Case {
        registry,
        first_day,
        last_day,
        batch,
    }
}

#[test]
fn usage_packets_round_trip_and_reject_every_single_byte_corruption_or_accept_it_canonically() {
    const SUITE: &str = "protocol-usage-wire";
    let config = config_from_env();
    for seed in &config.seeds {
        let mut rng = Rng::new(seed.value);
        let (mut records, mut rejected_flips, mut canonical_flips) = (0u64, 0u64, 0u64);
        for iteration in 0..config.iterations {
            let context = Context {
                suite: SUITE,
                seed,
                iteration,
            };
            let case = valid_case(&mut rng);
            let policy = case.policy();
            let bytes = encode(&case.batch, &policy).unwrap();
            let expected_len = HEADER_BYTES
                + case.batch.usage.len() * USAGE_BYTES
                + case.batch.prompts.len() * PROMPT_BYTES
                + case.batch.intervals.len() * INTERVAL_BYTES;
            check!(
                context,
                bytes.len() == expected_len,
                "packet size is the declared layout"
            );
            records += (case.batch.usage.len()
                + case.batch.prompts.len()
                + case.batch.intervals.len()) as u64;
            check!(
                context,
                decode(&bytes, &policy) == Ok(case.batch.clone()),
                "decode inverts encode"
            );
            check!(
                context,
                decode(&bytes[..bytes.len() - 1], &policy) == Err(Error::InvalidLength),
                "truncation is refused"
            );
            let mut longer = bytes.clone();
            longer.push(0);
            check!(
                context,
                decode(&longer, &policy) == Err(Error::InvalidLength),
                "trailing bytes are refused"
            );
            let other = Registry {
                revision: case.registry.revision.wrapping_add(1),
                models: case.registry.models.clone(),
            };
            let other_policy = Policy {
                first_day: case.first_day,
                last_day: case.last_day,
                registry: &other,
            };
            check!(
                context,
                decode(&bytes, &other_policy) == Err(Error::RegistryMismatch),
                "another registry revision is refused"
            );
            let mut reserved = bytes.clone();
            reserved[6] ^= 1;
            check!(
                context,
                decode(&reserved, &policy) == Err(Error::ReservedField),
                "reserved header bits are refused"
            );
            let mut magic = bytes.clone();
            magic[0] ^= 1;
            check!(
                context,
                decode(&magic, &policy) == Err(Error::InvalidMagic),
                "magic is checked first"
            );
            let mut version = bytes.clone();
            version[4] ^= 2;
            check!(
                context,
                decode(&version, &policy) == Err(Error::UnsupportedVersion),
                "unknown versions are refused"
            );
            let mut flipped = bytes.clone();
            let position = rng.below(bytes.len() as u64) as usize;
            let bit = 1u8 << rng.below(8);
            flipped[position] ^= bit;
            match decode(&flipped, &policy) {
                Err(_) => rejected_flips += 1,
                Ok(decoded) => {
                    canonical_flips += 1;
                    check!(
                        context,
                        decoded != case.batch,
                        "a changed byte never decodes to the original batch"
                    );
                    check!(
                        context,
                        encode(&decoded, &policy).as_deref() == Ok(flipped.as_slice()),
                        "an accepted mutation re-encodes byte for byte"
                    );
                }
            }
        }
        println!(
            "{}",
            receipt_line(
                SUITE,
                seed,
                config.iterations,
                &[
                    ("records", records),
                    ("rejected_flips", rejected_flips),
                    ("canonical_flips", canonical_flips)
                ]
            )
        );
    }
}

#[test]
fn usage_packets_with_one_injected_violation_fail_with_the_fixed_code() {
    const SUITE: &str = "protocol-usage-violations";
    const VIOLATIONS: usize = 14;
    let config = config_from_env();
    let mut oversized = valid_case(&mut Rng::new(1));
    oversized.batch.usage = (1..=MAX_RECORDS as u64 + 1)
        .map(|n| {
            let mut record = usage(&mut Rng::new(n), &oversized.registry);
            record.id = [0; 16];
            record.id[8..].copy_from_slice(&n.to_be_bytes());
            record.model_id = 0;
            record
        })
        .collect();
    assert_eq!(
        encode(&oversized.batch, &oversized.policy()),
        Err(Error::RecordLimit)
    );
    for seed in &config.seeds {
        let mut rng = Rng::new(seed.value);
        let mut applied = [0u64; VIOLATIONS];
        for iteration in 0..config.iterations {
            let context = Context {
                suite: SUITE,
                seed,
                iteration,
            };
            let mut case = valid_case(&mut rng);
            let violation = rng.below(VIOLATIONS as u64) as usize;
            let usage_index = if case.batch.usage.is_empty() {
                None
            } else {
                Some(rng.below(case.batch.usage.len() as u64) as usize)
            };
            let expected = match violation {
                0 => {
                    case.batch.usage.clear();
                    case.batch.prompts.clear();
                    case.batch.intervals.clear();
                    Error::EmptyBatch
                }
                1 => {
                    case.batch.registry_revision = case.batch.registry_revision.wrapping_add(1);
                    Error::RegistryMismatch
                }
                2 => {
                    if case.last_day == u32::MAX {
                        continue;
                    }
                    case.batch.utc_day = case.last_day + 1;
                    Error::DayOutOfRange
                }
                3 => {
                    let Some(index) = usage_index else { continue };
                    case.batch.usage[index].id = [0; 16];
                    Error::InvalidId
                }
                4 => {
                    let Some(index) = usage_index else { continue };
                    case.batch.usage[index].offset_ms = DAY_MS;
                    Error::InvalidOffset
                }
                5 => {
                    let Some(index) = usage_index else { continue };
                    case.batch.usage[index].context_tier = 1;
                    Error::UnsupportedValue
                }
                6 => {
                    let Some(index) = usage_index else { continue };
                    let record = &mut case.batch.usage[index];
                    record.model_id = u32::MAX;
                    if case.registry.models.contains(&(record.provider, u32::MAX)) {
                        continue;
                    }
                    Error::UnknownModel
                }
                7 => {
                    let Some(index) = usage_index else { continue };
                    case.batch.usage[index].tokens = Tokens::default();
                    Error::InvalidTokens
                }
                8 => {
                    let Some(index) = usage_index else { continue };
                    let record = &mut case.batch.usage[index];
                    record.tokens.reasoning_output = record.tokens.output + 1;
                    Error::InvalidTokens
                }
                9 => {
                    let Some(index) = usage_index else { continue };
                    let record = &mut case.batch.usage[index];
                    record.provider = Provider::Codex;
                    record.model_id = 0;
                    record.tokens.cache_write_5m = 1;
                    Error::InvalidTokens
                }
                10 => {
                    if case.batch.usage.len() < 2 {
                        continue;
                    }
                    let index = rng.below(case.batch.usage.len() as u64 - 1) as usize;
                    case.batch.usage.swap(index, index + 1);
                    Error::NonCanonicalOrder
                }
                11 => {
                    if case.batch.prompts.is_empty() {
                        continue;
                    }
                    case.batch.prompts[0].id = [0; 16];
                    Error::InvalidId
                }
                12 => {
                    if case.batch.intervals.is_empty() {
                        continue;
                    }
                    let record = &mut case.batch.intervals[0];
                    record.start_ms = record.end_ms;
                    Error::InvalidInterval
                }
                _ => {
                    if case.batch.intervals.is_empty() {
                        continue;
                    }
                    case.batch.intervals[0].clock_uncertainty_ms = MAX_CLOCK_UNCERTAINTY_MS + 1;
                    Error::InvalidClockUncertainty
                }
            };
            applied[violation] += 1;
            check!(
                context,
                encode(&case.batch, &case.policy()) == Err(expected),
                "violation {violation} yields {}",
                expected.code()
            );
        }
        let total = applied.iter().sum();
        let unapplied = applied.iter().filter(|value| **value == 0).count() as u64;
        println!(
            "{}",
            receipt_line(
                SUITE,
                seed,
                config.iterations,
                &[
                    ("violation_cases", total),
                    ("violation_kinds", VIOLATIONS as u64),
                    ("kinds_without_cases", unapplied)
                ]
            )
        );
    }
}

const OUTCOME_KINDS: usize = 5;

fn binding(rng: &mut Rng) -> wire::Binding {
    let nonzero = |rng: &mut Rng, bytes: &mut [u8]| {
        if bytes.iter().all(|byte| *byte == 0) {
            bytes[0] = rng.range(1, 255) as u8;
        }
    };
    let mut account_id: Id = rng.bytes();
    let mut device_id: [u8; 32] = rng.bytes();
    let mut recovery_generation: [u8; 32] = rng.bytes();
    nonzero(rng, &mut account_id);
    nonzero(rng, &mut device_id);
    nonzero(rng, &mut recovery_generation);
    wire::Binding {
        account_id,
        namespace_version: 1,
        device_id,
        recovery_generation,
    }
}

fn frame(rng: &mut Rng, occurrence_id: Id, policy: &Policy<'_>) -> [u8; wire::FRAME_BYTES] {
    let mut record = usage(rng, policy.registry);
    record.id = occurrence_id;
    let batch = Batch {
        utc_day: rng.range(u64::from(policy.first_day), u64::from(policy.last_day)) as u32,
        registry_revision: policy.registry.revision,
        usage: vec![record],
        prompts: vec![],
        intervals: vec![],
    };
    encode(&batch, policy).unwrap().try_into().unwrap()
}

#[test]
fn admission_operations_batches_receipts_and_journals_round_trip_with_matching_digests() {
    const SUITE: &str = "protocol-admission-wire";
    let config = config_from_env();
    for seed in &config.seeds {
        let mut rng = Rng::new(seed.value);
        let (mut operations, mut tombstones, mut journals, mut rejected_flips, mut canonical_flips) =
            (0u64, 0u64, 0u64, 0u64, 0u64);
        let mut outcome_kinds = [0u64; OUTCOME_KINDS];
        for iteration in 0..config.iterations {
            let context = Context {
                suite: SUITE,
                seed,
                iteration,
            };
            let registry = registry(&mut rng);
            let first_day = rng.below(30_000) as u32;
            let policy = Policy {
                first_day,
                last_day: first_day + rng.below(2_000) as u32,
                registry: &registry,
            };
            let binding = binding(&mut rng);
            let count = match rng.below(6) {
                0 => wire::MAX_OPERATIONS,
                1 => 1,
                _ => rng.range(1, 8) as usize,
            };
            let first = if rng.chance(1, 4) {
                wire::MAX_SAFE_INTEGER - count as u64 + 1
            } else {
                rng.range(1, 1 << 40)
            };
            let mut ids: BTreeMap<Id, ()> = BTreeMap::new();
            while ids.len() < count {
                ids.insert(id(&mut rng, false), ());
            }
            let mut ops = Vec::with_capacity(count);
            for (index, (occurrence_id, ())) in ids.into_iter().enumerate() {
                let expected_head: [u8; 32] = if rng.chance(1, 2) {
                    [0; 32]
                } else {
                    rng.bytes()
                };
                let kind = if expected_head != [0; 32] && rng.chance(1, 5) {
                    tombstones += 1;
                    wire::OperationKind::Tombstone
                } else {
                    wire::OperationKind::Put {
                        frame: frame(&mut rng, occurrence_id, &policy),
                    }
                };
                ops.push(wire::Operation {
                    binding,
                    sequence: first + index as u64,
                    occurrence_id,
                    expected_head,
                    kind,
                });
            }
            operations += count as u64;
            for operation in &ops {
                let bytes = wire::encode_operation(operation, &policy).unwrap();
                check!(
                    context,
                    wire::decode_operation(&bytes, &policy) == Ok(*operation),
                    "operation decode inverts encode"
                );
                check!(
                    context,
                    wire::operation_digest(operation, &policy).unwrap() != [0; 32],
                    "operation digest is nonzero"
                );
                if let wire::OperationKind::Put { frame } = operation.kind {
                    let mut other = *operation;
                    let mut changed = frame;
                    changed[HEADER_BYTES + 48] ^= 1;
                    other.kind = wire::OperationKind::Put { frame: changed };
                    check!(
                        context,
                        wire::encode_operation(&other, &policy).is_err()
                            || wire::operation_digest(&other, &policy)
                                != wire::operation_digest(operation, &policy),
                        "a different frame never shares an operation digest"
                    );
                }
            }
            let batch = wire::Batch {
                binding,
                operations: ops.clone(),
            };
            let batch_bytes = wire::encode_batch(&batch, &policy).unwrap();
            check!(
                context,
                wire::decode_batch(&batch_bytes, &policy) == Ok(batch.clone()),
                "batch decode inverts encode"
            );
            let batch_hash = wire::batch_digest(&batch, &policy).unwrap();
            check!(
                context,
                wire::batch_digest(&batch, &policy) == Ok(batch_hash),
                "batch digest is deterministic"
            );
            let mut flipped = batch_bytes.clone();
            let position = rng.below(batch_bytes.len() as u64) as usize;
            flipped[position] ^= 1u8 << rng.below(8);
            match wire::decode_batch(&flipped, &policy) {
                Err(_) => rejected_flips += 1,
                Ok(decoded) => {
                    canonical_flips += 1;
                    check!(
                        context,
                        decoded != batch,
                        "a changed byte never decodes to the original batch"
                    );
                    check!(
                        context,
                        wire::encode_batch(&decoded, &policy).as_deref() == Ok(flipped.as_slice()),
                        "an accepted mutation re-encodes byte for byte"
                    );
                }
            }
            let kind = rng.below(OUTCOME_KINDS as u64) as usize;
            outcome_kinds[kind] += 1;
            let account_journal_revision = rng.range(1, wire::MAX_SAFE_INTEGER);
            let committed_at_ms = rng.below(wire::MAX_TIMESTAMP_MS + 1);
            let receipts: Vec<wire::Receipt> = ops
                .iter()
                .enumerate()
                .map(|(index, operation)| {
                    let operation_hash = wire::operation_digest(operation, &policy).unwrap();
                    let tombstone = matches!(operation.kind, wire::OperationKind::Tombstone);
                    let (outcome, head_operation_hash) = match kind {
                        0 => {
                            if tombstone {
                                (wire::Outcome::Tombstoned, operation_hash)
                            } else if operation.expected_head == [0; 32] {
                                (wire::Outcome::Inserted, operation_hash)
                            } else {
                                (wire::Outcome::Replaced, operation_hash)
                            }
                        }
                        1 => {
                            if tombstone {
                                (wire::Outcome::Tombstoned, operation_hash)
                            } else {
                                (
                                    wire::Outcome::Duplicate,
                                    if operation.expected_head.iter().any(|b| *b != 0) {
                                        operation.expected_head
                                    } else {
                                        [7; 32]
                                    },
                                )
                            }
                        }
                        2 => (wire::Outcome::DeviceRevoked, [0; 32]),
                        3 => {
                            if index == 0 {
                                (wire::Outcome::PredecessorConflict, [9; 32])
                            } else {
                                (wire::Outcome::BatchAborted, operation.expected_head)
                            }
                        }
                        _ => {
                            if index == 0 {
                                (wire::Outcome::SubjectDeleted, [5; 32])
                            } else if index % 2 == 0 {
                                (wire::Outcome::PredecessorConflict, [0; 32])
                            } else {
                                (wire::Outcome::BatchAborted, [0; 32])
                            }
                        }
                    };
                    wire::Receipt {
                        descriptor: operation.descriptor(),
                        operation_hash,
                        head_operation_hash,
                        account_journal_revision,
                        committed_at_ms,
                        outcome,
                    }
                })
                .collect();
            for receipt in &receipts {
                let bytes = wire::encode_receipt(receipt).unwrap();
                check!(
                    context,
                    bytes.len() == wire::RECEIPT_BYTES,
                    "receipt size is fixed"
                );
                check!(
                    context,
                    wire::decode_receipt(&bytes) == Ok(*receipt),
                    "receipt decode inverts encode"
                );
            }
            let journal = wire::Journal {
                binding,
                first_sequence: first,
                batch_hash,
                account_journal_revision,
                committed_at_ms,
                status: if kind < 2 {
                    wire::JournalStatus::Accepted
                } else {
                    wire::JournalStatus::Rejected
                },
                receipts,
            };
            let journal_bytes = wire::encode_journal(&journal).unwrap();
            journals += 1;
            check!(
                context,
                wire::decode_journal(&journal_bytes) == Ok(journal.clone()),
                "journal decode inverts encode"
            );
            check!(
                context,
                wire::validate_journal_for_batch(&journal, &batch, &policy) == Ok(()),
                "the journal matches its batch"
            );
            let mut foreign = journal.clone();
            foreign.batch_hash[0] ^= 1;
            check!(
                context,
                wire::validate_journal_for_batch(&foreign, &batch, &policy)
                    == Err(wire::Error::MemberMismatch),
                "another batch hash is a member mismatch"
            );
            let mut wrong_status = journal.clone();
            wrong_status.status = if kind < 2 {
                wire::JournalStatus::Rejected
            } else {
                wire::JournalStatus::Accepted
            };
            check!(
                context,
                wire::encode_journal(&wrong_status) == Err(wire::Error::InvalidJournal),
                "outcomes and status must agree"
            );
        }
        println!(
            "{}",
            receipt_line(
                SUITE,
                seed,
                config.iterations,
                &[
                    ("operations", operations),
                    ("tombstones", tombstones),
                    ("journals", journals),
                    ("accepted_journals", outcome_kinds[0] + outcome_kinds[1]),
                    ("revoked_journals", outcome_kinds[2]),
                    ("conflict_journals", outcome_kinds[3] + outcome_kinds[4]),
                    ("rejected_flips", rejected_flips),
                    ("canonical_flips", canonical_flips),
                ]
            )
        );
    }
}
