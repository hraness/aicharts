use super::*;
use crate::{AuthMode, Evidence, Provider, Registry, Tokens, Usage};

fn registry() -> Registry {
    Registry {
        revision: 1,
        models: vec![],
    }
}
fn policy(registry: &Registry) -> Policy<'_> {
    Policy {
        first_day: 0,
        last_day: u32::MAX,
        registry,
    }
}
fn fixture(name: &str) -> Vec<u8> {
    let text = include_str!("../../tests/fixtures/admission-v1.hex")
        .lines()
        .filter_map(|line| line.split_once('='))
        .find(|(key, _)| *key == name)
        .unwrap()
        .1;
    assert_eq!(text.len() % 2, 0);
    assert!(text
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));
    (0..text.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&text[index..index + 2], 16).unwrap())
        .collect()
}
fn sample_binding() -> Binding {
    Binding {
        account_id: [0x11; 16],
        namespace_version: 1,
        device_id: [0x22; 32],
        recovery_generation: [0x33; 32],
    }
}
fn sample_frame() -> [u8; FRAME_BYTES] {
    crate::encode(
        &crate::Batch {
            utc_day: 20_706,
            registry_revision: 1,
            usage: vec![Usage {
                id: [0x44; 16],
                execution_id: [0x55; 16],
                account_id: [0; 16],
                offset_ms: 42,
                provider: Provider::ClaudeCode,
                auth_mode: AuthMode::Unknown,
                evidence: Evidence::Imported,
                model_id: 0,
                context_tier: 0,
                tokens: Tokens {
                    input_uncached: 11,
                    cache_read: 12,
                    cache_write_5m: 13,
                    cache_write_1h: 14,
                    output: 15,
                    reasoning_output: 6,
                },
            }],
            prompts: vec![],
            intervals: vec![],
        },
        &policy(&registry()),
    )
    .unwrap()
    .try_into()
    .unwrap()
}
fn put() -> Operation {
    Operation {
        binding: sample_binding(),
        sequence: 41,
        occurrence_id: [0x44; 16],
        expected_head: [0; 32],
        kind: OperationKind::Put {
            frame: sample_frame(),
        },
    }
}
fn tombstone() -> Operation {
    Operation {
        binding: sample_binding(),
        sequence: 42,
        occurrence_id: [0x66; 16],
        expected_head: [0x77; 32],
        kind: OperationKind::Tombstone,
    }
}
fn batch() -> Batch {
    Batch {
        binding: sample_binding(),
        operations: vec![put(), tombstone()],
    }
}
fn receipt(operation: &Operation, outcome: Outcome) -> Receipt {
    let hash = operation_digest(operation, &policy(&registry())).unwrap();
    Receipt {
        descriptor: operation.descriptor(),
        operation_hash: hash,
        head_operation_hash: hash,
        account_journal_revision: 7,
        committed_at_ms: 1_800_000_000_000,
        outcome,
    }
}
fn journal() -> Journal {
    Journal {
        binding: sample_binding(),
        first_sequence: 41,
        batch_hash: batch_digest(&batch(), &policy(&registry())).unwrap(),
        account_journal_revision: 7,
        committed_at_ms: 1_800_000_000_000,
        status: JournalStatus::Accepted,
        receipts: vec![
            receipt(&put(), Outcome::Inserted),
            receipt(&tombstone(), Outcome::Tombstoned),
        ],
    }
}

#[test]
fn independent_hex_golden_layout_hashes_and_roundtrips() {
    let registry = registry();
    let policy = policy(&registry);
    assert_eq!(sample_frame().as_slice(), fixture("frame"));
    for (operation, name, hash_name) in [
        (put(), "operation_put", "operation_hash_put"),
        (
            tombstone(),
            "operation_tombstone",
            "operation_hash_tombstone",
        ),
    ] {
        let bytes = fixture(name);
        assert_eq!(encode_operation(&operation, &policy).unwrap(), bytes);
        assert_eq!(decode_operation(&bytes, &policy).unwrap(), operation);
        assert_eq!(
            operation_digest(&operation, &policy).unwrap().as_slice(),
            fixture(hash_name)
        );
        assert_ne!(
            operation_digest(&operation, &policy).unwrap().as_slice(),
            Sha256::digest(&bytes).as_slice()
        );
    }
    assert_eq!(encode_batch(&batch(), &policy).unwrap(), fixture("batch"));
    assert_eq!(decode_batch(&fixture("batch"), &policy).unwrap(), batch());
    assert_eq!(
        batch_digest(&batch(), &policy).unwrap().as_slice(),
        fixture("batch_hash")
    );
    for (receipt, name) in [
        (journal().receipts[0], "receipt_inserted"),
        (journal().receipts[1], "receipt_tombstoned"),
    ] {
        assert_eq!(encode_receipt(&receipt).unwrap(), fixture(name));
        assert_eq!(decode_receipt(&fixture(name)).unwrap(), receipt);
    }
    assert_eq!(
        encode_journal(&journal()).unwrap(),
        fixture("journal_accepted")
    );
    for name in [
        "journal_accepted",
        "journal_conflict",
        "journal_revoked",
        "journal_deleted",
    ] {
        let bytes = fixture(name);
        let decoded = decode_journal(&bytes).unwrap();
        assert_eq!(encode_journal(&decoded).unwrap(), bytes);
        validate_journal_for_batch(&decoded, &batch(), &policy).unwrap();
    }
}

#[test]
fn every_prefix_and_trailing_byte_is_rejected() {
    let registry = registry();
    let policy = policy(&registry);
    for name in [
        "operation_put",
        "operation_tombstone",
        "batch",
        "receipt_inserted",
        "journal_accepted",
    ] {
        let bytes = fixture(name);
        let accepts = |bytes: &[u8]| match name {
            "operation_put" | "operation_tombstone" => decode_operation(bytes, &policy).is_ok(),
            "batch" => decode_batch(bytes, &policy).is_ok(),
            "receipt_inserted" => decode_receipt(bytes).is_ok(),
            _ => decode_journal(bytes).is_ok(),
        };
        for length in 0..bytes.len() {
            assert!(!accepts(&bytes[..length]), "{name} length {length}");
        }
        let mut trailing = bytes.clone();
        trailing.push(0);
        assert!(!accepts(&trailing));
    }
}

#[test]
fn fixed_envelopes_reject_magic_version_reserved_and_empty_binding() {
    let registry = registry();
    let policy = policy(&registry);
    for name in [
        "operation_put",
        "operation_tombstone",
        "batch",
        "receipt_inserted",
        "journal_accepted",
    ] {
        let original = fixture(name);
        let accepts = |bytes: &[u8]| match name {
            "operation_put" | "operation_tombstone" => decode_operation(bytes, &policy).is_ok(),
            "batch" => decode_batch(bytes, &policy).is_ok(),
            "receipt_inserted" => decode_receipt(bytes).is_ok(),
            _ => decode_journal(bytes).is_ok(),
        };
        for offset in [0, 4, 5, 6, 7, 8, 9] {
            let mut bytes = original.clone();
            bytes[offset] ^= 3;
            assert!(!accepts(&bytes), "{name} offset {offset}");
        }
        for range in [16..32, 32..64, 64..96] {
            let mut bytes = original.clone();
            bytes[range].fill(0);
            assert!(!accepts(&bytes));
        }
        for sequence in [0, MAX_SAFE_INTEGER + 1, u64::MAX] {
            let mut bytes = original.clone();
            bytes[96..104].copy_from_slice(&sequence.to_le_bytes());
            assert!(!accepts(&bytes));
        }
    }
    let mut bytes = fixture("operation_put");
    bytes[11] = 1;
    assert_eq!(decode_operation(&bytes, &policy), Err(Error::ReservedField));
    for offset in 153..160 {
        let mut bytes = fixture("journal_accepted");
        bytes[offset] = 1;
        assert_eq!(decode_journal(&bytes), Err(Error::ReservedField));
    }
}

#[test]
fn descriptor_width_action_hash_and_occurrence_laws_are_closed() {
    let registry = registry();
    let policy = policy(&registry);
    for name in ["operation_put", "operation_tombstone"] {
        for action in [0, 3, 255] {
            let mut bytes = fixture(name);
            bytes[10] = action;
            assert_eq!(
                decode_operation(&bytes, &policy),
                Err(Error::InvalidDescriptor)
            );
        }
        for length in [1, 135, 137, u32::MAX] {
            let mut bytes = fixture(name);
            bytes[12..16].copy_from_slice(&length.to_le_bytes());
            assert_eq!(
                decode_operation(&bytes, &policy),
                Err(Error::InvalidDescriptor)
            );
        }
        let mut bytes = fixture(name);
        bytes[104..120].fill(0);
        assert_eq!(
            decode_operation(&bytes, &policy),
            Err(Error::InvalidDescriptor)
        );
    }
    let mut bytes = fixture("operation_put");
    bytes[152..184].fill(0);
    assert_eq!(
        decode_operation(&bytes, &policy),
        Err(Error::InvalidDescriptor)
    );
    let mut bytes = fixture("operation_put");
    bytes[152] ^= 1;
    assert_eq!(decode_operation(&bytes, &policy), Err(Error::InvalidDigest));
    let mut bytes = fixture("operation_tombstone");
    bytes[152] = 1;
    assert_eq!(
        decode_operation(&bytes, &policy),
        Err(Error::InvalidDescriptor)
    );
    let mut bytes = fixture("operation_put");
    bytes[104] ^= 1;
    assert_eq!(decode_operation(&bytes, &policy), Err(Error::InvalidFrame));
}

#[test]
fn nested_frame_is_exact_canonical_single_usage_under_explicit_policy() {
    let registry = registry();
    let policy = policy(&registry);
    for offset in [0, 4, 6, 12, 14, 16, 18, 20, 76, 77, 78, 82, 84, 86] {
        let mut frame = sample_frame();
        frame[offset] = 255;
        let operation = Operation {
            kind: OperationKind::Put { frame },
            ..put()
        };
        assert_eq!(
            encode_operation(&operation, &policy),
            Err(Error::InvalidFrame),
            "offset {offset}"
        );
    }
    let mut frame = sample_frame();
    frame[88..136].fill(0);
    assert_eq!(
        encode_operation(
            &Operation {
                kind: OperationKind::Put { frame },
                ..put()
            },
            &policy
        ),
        Err(Error::InvalidFrame)
    );
    let mut frame = sample_frame();
    frame[128..136].copy_from_slice(&16_u64.to_le_bytes());
    assert_eq!(
        encode_operation(
            &Operation {
                kind: OperationKind::Put { frame },
                ..put()
            },
            &policy
        ),
        Err(Error::InvalidFrame)
    );
    let narrow = Policy {
        first_day: 20_707,
        last_day: 20_707,
        registry: &registry,
    };
    assert_eq!(encode_operation(&put(), &narrow), Err(Error::InvalidFrame));
    let malformed = Policy {
        first_day: 2,
        last_day: 1,
        registry: &registry,
    };
    assert_eq!(
        encode_operation(&put(), &malformed),
        Err(Error::InvalidFrame)
    );

    // The framing layer does not invent historical admission policy: a caller's
    // model registry can permit live/subscription measurements. The ledger and
    // initial server admission layer separately restrict their historical input.
    let richer_registry = Registry {
        revision: 2,
        models: vec![(Provider::ClaudeCode, 7)],
    };
    let richer_policy = super::tests::policy(&richer_registry);
    let mut decoded = crate::decode(&sample_frame(), &policy).unwrap();
    decoded.registry_revision = 2;
    decoded.usage[0].provider = Provider::ClaudeCode;
    decoded.usage[0].account_id = [0xaa; 16];
    decoded.usage[0].model_id = 7;
    decoded.usage[0].auth_mode = AuthMode::Subscription;
    decoded.usage[0].evidence = Evidence::Live;
    let frame = crate::encode(&decoded, &richer_policy)
        .unwrap()
        .try_into()
        .unwrap();
    let operation = Operation {
        kind: OperationKind::Put { frame },
        ..put()
    };
    let bytes = encode_operation(&operation, &richer_policy).unwrap();
    assert_eq!(decode_operation(&bytes, &richer_policy).unwrap(), operation);
    assert_eq!(decode_operation(&bytes, &policy), Err(Error::InvalidFrame));
}

#[test]
fn batches_enforce_binding_sequence_uniqueness_counts_and_exact_bytes() {
    let registry = registry();
    let policy = policy(&registry);
    let original = fixture("batch");
    for count in [0_u16, 257, u16::MAX] {
        let mut bytes = original.clone();
        bytes[10..12].copy_from_slice(&count.to_le_bytes());
        assert_eq!(decode_batch(&bytes, &policy), Err(Error::RecordLimit));
    }
    for length in [0, 183, 185, 503, 505, u32::MAX] {
        let mut bytes = original.clone();
        bytes[12..16].copy_from_slice(&length.to_le_bytes());
        assert_eq!(decode_batch(&bytes, &policy), Err(Error::InvalidLength));
    }
    for offset in [
        16,
        32,
        64,
        96,
        BATCH_HEADER_BYTES + 16,
        BATCH_HEADER_BYTES + 32,
        BATCH_HEADER_BYTES + 64,
        BATCH_HEADER_BYTES + 96,
    ] {
        let mut bytes = original.clone();
        bytes[offset] ^= 1;
        assert_eq!(decode_batch(&bytes, &policy), Err(Error::MemberMismatch));
    }
    let mut value = batch();
    value.operations[1].sequence += 1;
    assert_eq!(encode_batch(&value, &policy), Err(Error::MemberMismatch));
    let mut value = batch();
    value.operations[1].occurrence_id = value.operations[0].occurrence_id;
    assert_eq!(
        encode_batch(&value, &policy),
        Err(Error::DuplicateOccurrence)
    );
    let mut bytes = original;
    bytes[424 + 104..424 + 120].fill(0x44);
    assert_eq!(
        decode_batch(&bytes, &policy),
        Err(Error::DuplicateOccurrence)
    );
    let mut value = batch();
    value.operations.clear();
    assert_eq!(encode_batch(&value, &policy), Err(Error::RecordLimit));
    let mut value = batch();
    value.operations[0].sequence = MAX_SAFE_INTEGER;
    assert_eq!(encode_batch(&value, &policy), Err(Error::InvalidSequence));
}

#[test]
fn receipt_outcomes_require_possible_action_predecessor_and_resulting_head() {
    for outcome in [
        Outcome::Inserted,
        Outcome::Replaced,
        Outcome::Tombstoned,
        Outcome::Duplicate,
        Outcome::PredecessorConflict,
        Outcome::BatchAborted,
        Outcome::DeviceRevoked,
        Outcome::SubjectDeleted,
    ] {
        for action in [Action::Put, Action::Tombstone] {
            for predecessor in [false, true] {
                for head_mode in 0..3 {
                    let operation = Operation {
                        expected_head: if predecessor { [9; 32] } else { [0; 32] },
                        ..if action == Action::Put {
                            put()
                        } else {
                            tombstone()
                        }
                    };
                    let mut value = receipt(&operation, outcome);
                    value.head_operation_hash = match head_mode {
                        0 => [0; 32],
                        1 => value.operation_hash,
                        _ => [8; 32],
                    };
                    let allowed = match outcome {
                        Outcome::Inserted => {
                            action == Action::Put && !predecessor && head_mode == 1
                        }
                        Outcome::Replaced => action == Action::Put && predecessor && head_mode == 1,
                        Outcome::Tombstoned => {
                            action == Action::Tombstone && predecessor && head_mode == 1
                        }
                        Outcome::Duplicate => action == Action::Put && head_mode != 0,
                        Outcome::PredecessorConflict | Outcome::BatchAborted => true,
                        Outcome::DeviceRevoked => head_mode == 0,
                        Outcome::SubjectDeleted => head_mode != 0,
                    };
                    let encoded = encode_receipt(&value);
                    assert_eq!(
                        encoded.is_ok(),
                        allowed,
                        "{outcome:?} {action:?} {predecessor} {head_mode}"
                    );
                    if let Ok(bytes) = encoded {
                        assert_eq!(decode_receipt(&bytes).unwrap(), value);
                    }
                }
            }
        }
    }
    for outcome in [0, 9, 255] {
        let mut bytes = fixture("receipt_inserted");
        bytes[11] = outcome;
        assert_eq!(decode_receipt(&bytes), Err(Error::InvalidOutcome));
    }
    let mut bytes = fixture("receipt_inserted");
    bytes[184..216].fill(0);
    assert_eq!(decode_receipt(&bytes), Err(Error::InvalidDigest));
}

#[test]
fn safe_integer_and_timestamp_edges_are_exact_on_both_codecs() {
    let registry = registry();
    let policy = policy(&registry);
    for sequence in [1, MAX_SAFE_INTEGER] {
        let value = Operation { sequence, ..put() };
        assert_eq!(
            decode_operation(&encode_operation(&value, &policy).unwrap(), &policy).unwrap(),
            value
        );
    }
    for revision in [1, MAX_SAFE_INTEGER] {
        for timestamp in [0, MAX_TIMESTAMP_MS] {
            let mut value = journal();
            value.account_journal_revision = revision;
            value.committed_at_ms = timestamp;
            for receipt in &mut value.receipts {
                receipt.account_journal_revision = revision;
                receipt.committed_at_ms = timestamp;
            }
            assert_eq!(
                decode_journal(&encode_journal(&value).unwrap()).unwrap(),
                value
            );
        }
    }
    for revision in [0, MAX_SAFE_INTEGER + 1, u64::MAX] {
        let mut bytes = fixture("receipt_inserted");
        bytes[248..256].copy_from_slice(&revision.to_le_bytes());
        assert_eq!(decode_receipt(&bytes), Err(Error::InvalidJournal));
        let mut bytes = fixture("journal_accepted");
        bytes[136..144].copy_from_slice(&revision.to_le_bytes());
        assert_eq!(decode_journal(&bytes), Err(Error::InvalidJournal));
    }
    for timestamp in [MAX_TIMESTAMP_MS + 1, MAX_SAFE_INTEGER, u64::MAX] {
        let mut bytes = fixture("receipt_inserted");
        bytes[256..264].copy_from_slice(&timestamp.to_le_bytes());
        assert_eq!(decode_receipt(&bytes), Err(Error::InvalidJournal));
        let mut bytes = fixture("journal_accepted");
        bytes[144..152].copy_from_slice(&timestamp.to_le_bytes());
        assert_eq!(decode_journal(&bytes), Err(Error::InvalidJournal));
    }
}

#[test]
fn journal_is_all_or_nothing_and_echoes_every_ordered_member() {
    let registry = registry();
    let policy = policy(&registry);
    for name in ["journal_conflict", "journal_deleted"] {
        let mut value = decode_journal(&fixture(name)).unwrap();
        value.status = JournalStatus::Accepted;
        assert_eq!(encode_journal(&value), Err(Error::InvalidJournal));
    }
    let mut value = journal();
    value.status = JournalStatus::Rejected;
    assert_eq!(encode_journal(&value), Err(Error::InvalidJournal));
    let mut value = decode_journal(&fixture("journal_conflict")).unwrap();
    value.receipts[0].outcome = Outcome::BatchAborted;
    assert_eq!(encode_journal(&value), Err(Error::InvalidJournal));
    let mut value = decode_journal(&fixture("journal_revoked")).unwrap();
    value.receipts[0].outcome = Outcome::PredecessorConflict;
    assert_eq!(encode_journal(&value), Err(Error::InvalidJournal));
    let mut value = journal();
    value.receipts.swap(0, 1);
    assert_eq!(encode_journal(&value), Err(Error::MemberMismatch));
    let mut value = journal();
    value.receipts[1].committed_at_ms += 1;
    assert_eq!(encode_journal(&value), Err(Error::MemberMismatch));
    let mut value = journal();
    value.receipts[1].account_journal_revision += 1;
    assert_eq!(encode_journal(&value), Err(Error::MemberMismatch));
    let mut value = journal();
    value.receipts[1].descriptor.binding.device_id = [3; 32];
    assert_eq!(encode_journal(&value), Err(Error::MemberMismatch));
    let mut value = journal();
    value.receipts[1].descriptor.occurrence_id = [0x44; 16];
    assert_eq!(encode_journal(&value), Err(Error::DuplicateOccurrence));
    let mut value = journal();
    value.batch_hash[0] ^= 1;
    assert!(encode_journal(&value).is_ok());
    assert_eq!(
        validate_journal_for_batch(&value, &batch(), &policy),
        Err(Error::MemberMismatch)
    );
    let mut value = journal();
    value.receipts.pop();
    assert_eq!(
        validate_journal_for_batch(&value, &batch(), &policy),
        Err(Error::MemberMismatch)
    );
    let mut value = journal();
    value.receipts[0].descriptor.payload_hash[0] ^= 1;
    assert_eq!(
        validate_journal_for_batch(&value, &batch(), &policy),
        Err(Error::MemberMismatch)
    );
    let mut value = journal();
    value.receipts[0].operation_hash = [9; 32];
    value.receipts[0].head_operation_hash = [9; 32];
    // Standalone framing cannot authenticate an operation hash without its put
    // payload. Exact alignment is mandatory at the sender/storage boundary.
    assert!(decode_journal(&encode_journal(&value).unwrap()).is_ok());
    assert_eq!(
        validate_journal_for_batch(&value, &batch(), &policy),
        Err(Error::MemberMismatch)
    );
    let mut malformed_batch = batch();
    malformed_batch.operations[0].sequence = 0;
    assert!(validate_journal_for_batch(&journal(), &malformed_batch, &policy).is_err());
}

#[test]
fn journal_count_length_status_and_hash_are_closed_before_member_allocation() {
    for count in [0_u16, 257, u16::MAX] {
        let mut bytes = fixture("journal_accepted");
        bytes[10..12].copy_from_slice(&count.to_le_bytes());
        assert_eq!(decode_journal(&bytes), Err(Error::RecordLimit));
    }
    for length in [0_u32, 527, 529, u32::MAX] {
        let mut bytes = fixture("journal_accepted");
        bytes[12..16].copy_from_slice(&length.to_le_bytes());
        assert_eq!(decode_journal(&bytes), Err(Error::InvalidLength));
    }
    for status in [0, 3, 255] {
        let mut bytes = fixture("journal_accepted");
        bytes[152] = status;
        assert_eq!(decode_journal(&bytes), Err(Error::InvalidJournal));
    }
    let mut bytes = fixture("journal_accepted");
    bytes[104..136].fill(0);
    assert_eq!(decode_journal(&bytes), Err(Error::InvalidDigest));
}

#[test]
fn maximum_batch_and_journal_fit_exact_ceilings_and_reject_next_member() {
    let registry = registry();
    let policy = policy(&registry);
    let mut value = batch();
    value.operations.clear();
    for index in 0..MAX_OPERATIONS {
        let mut operation = put();
        operation.sequence = MAX_SAFE_INTEGER - (MAX_OPERATIONS - 1 - index) as u64;
        operation.occurrence_id[8..].copy_from_slice(&(index as u64 + 1).to_le_bytes());
        let OperationKind::Put { ref mut frame } = operation.kind else {
            unreachable!()
        };
        frame[24..40].copy_from_slice(&operation.occurrence_id);
        value.operations.push(operation);
    }
    let encoded = encode_batch(&value, &policy).unwrap();
    assert_eq!(MAX_BATCH_BYTES, 82_024);
    assert_eq!(encoded.len(), MAX_BATCH_BYTES);
    assert_eq!(decode_batch(&encoded, &policy).unwrap(), value);
    let mut terminal = journal();
    terminal.first_sequence = value.operations[0].sequence;
    terminal.batch_hash = batch_digest(&value, &policy).unwrap();
    terminal.receipts = value
        .operations
        .iter()
        .map(|op| receipt(op, Outcome::Inserted))
        .collect();
    let bytes = encode_journal(&terminal).unwrap();
    assert_eq!(MAX_JOURNAL_BYTES, 67_744);
    assert_eq!(bytes.len(), MAX_JOURNAL_BYTES);
    assert_eq!(decode_journal(&bytes).unwrap(), terminal);
    validate_journal_for_batch(&terminal, &value, &policy).unwrap();
    value.operations.push(put());
    assert_eq!(encode_batch(&value, &policy), Err(Error::RecordLimit));
    terminal.receipts.push(journal().receipts[0]);
    assert_eq!(encode_journal(&terminal), Err(Error::RecordLimit));
    let mut oversized = encoded;
    oversized.push(0);
    assert_eq!(decode_batch(&oversized, &policy), Err(Error::InvalidLength));
    let mut oversized = bytes;
    oversized.push(0);
    assert_eq!(decode_journal(&oversized), Err(Error::InvalidLength));
}

#[test]
fn arbitrary_and_mutated_bytes_never_panic_and_accepted_bytes_are_canonical() {
    let registry = registry();
    let policy = policy(&registry);
    let mut state = 0x38ad_9672_ae17_5501_u64;
    let mut random = || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    for name in [
        "operation_put",
        "operation_tombstone",
        "receipt_inserted",
        "batch",
        "journal_accepted",
        "journal_conflict",
        "journal_revoked",
    ] {
        let original = fixture(name);
        for iteration in 0..1_000 {
            let mut bytes = if iteration % 3 == 0 {
                vec![0; random() as usize % 800]
            } else {
                original.clone()
            };
            for _ in 0..5 {
                if bytes.is_empty() {
                    break;
                }
                let position = random() as usize % bytes.len();
                bytes[position] = random() as u8;
            }
            if let Ok(value) = decode_operation(&bytes, &policy) {
                assert_eq!(encode_operation(&value, &policy).unwrap(), bytes);
            }
            if let Ok(value) = decode_receipt(&bytes) {
                assert_eq!(encode_receipt(&value).unwrap(), bytes);
            }
            if let Ok(value) = decode_batch(&bytes, &policy) {
                assert_eq!(encode_batch(&value, &policy).unwrap(), bytes);
            }
            if let Ok(value) = decode_journal(&bytes) {
                assert_eq!(encode_journal(&value).unwrap(), bytes);
            }
        }
    }
}
