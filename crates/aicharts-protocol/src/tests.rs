use super::*;

fn registry() -> Registry {
    Registry {
        revision: 1,
        models: vec![(Provider::Codex, 7), (Provider::ClaudeCode, 8)],
    }
}

fn policy(registry: &Registry) -> Policy<'_> {
    Policy {
        first_day: 20_000,
        last_day: 21_000,
        registry,
    }
}

fn id(number: u32) -> Id {
    let mut value = [0; 16];
    value[12..].copy_from_slice(&number.to_be_bytes());
    value
}

fn sample() -> Batch {
    Batch {
        utc_day: 20_706,
        registry_revision: 1,
        usage: vec![Usage {
            id: id(1),
            execution_id: id(2),
            account_id: id(3),
            offset_ms: 42,
            provider: Provider::ClaudeCode,
            auth_mode: AuthMode::Subscription,
            evidence: Evidence::Imported,
            model_id: 8,
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
        prompts: vec![Prompt {
            id: id(4),
            execution_id: id(2),
            account_id: id(3),
            offset_ms: 1,
            provider: Provider::ClaudeCode,
            origin: Origin::Unknown,
            evidence: Evidence::Imported,
        }],
        intervals: vec![Interval {
            execution_id: id(2),
            account_id: id(3),
            start_ms: 1,
            end_ms: 43,
            provider: Provider::ClaudeCode,
            kind: IntervalKind::AgentWork,
            evidence: Evidence::Live,
            clock_uncertainty_ms: 2,
        }],
    }
}

fn encoded() -> Vec<u8> {
    encode(&sample(), &policy(&registry())).unwrap()
}

fn rejection(bytes: &[u8], expected: Error) {
    assert_eq!(decode(bytes, &policy(&registry())), Err(expected));
}

#[test]
fn exact_layout_and_roundtrip() {
    let batch = sample();
    let bytes = encoded();
    assert_eq!(bytes.len(), 240);
    assert_eq!(&bytes[..8], b"AICU\x01\0\0\0");
    assert_eq!(&bytes[8..12], &batch.utc_day.to_le_bytes());
    assert_eq!(&bytes[12..20], &[1, 0, 1, 0, 1, 0, 0, 0]);
    assert_eq!(&bytes[20..24], &[1, 0, 0, 0]);
    assert_eq!(&bytes[24..40], &id(1));
    assert_eq!(
        &bytes[72..88],
        &[42, 0, 0, 0, 2, 1, 1, 0, 8, 0, 0, 0, 0, 0, 0, 0]
    );
    for (index, counter) in [11_u64, 12, 13, 14, 15, 6].iter().enumerate() {
        assert_eq!(
            &bytes[88 + index * 8..96 + index * 8],
            &counter.to_le_bytes()
        );
    }
    assert_eq!(&bytes[136..152], &id(4));
    assert_eq!(&bytes[184..192], &[1, 0, 0, 0, 2, 0, 1, 0]);
    assert_eq!(&bytes[192..208], &id(2));
    assert_eq!(
        &bytes[224..240],
        &[1, 0, 0, 0, 43, 0, 0, 0, 2, 1, 2, 0, 2, 0, 0, 0]
    );
    assert_eq!(decode(&bytes, &policy(&registry())).unwrap(), batch);
}

#[test]
fn each_family_can_be_the_only_family() {
    for family in 0..3 {
        let mut batch = sample();
        if family != 0 {
            batch.usage.clear();
        }
        if family != 1 {
            batch.prompts.clear();
        }
        if family != 2 {
            batch.intervals.clear();
        }
        let bytes = encode(&batch, &policy(&registry())).unwrap();
        assert_eq!(decode(&bytes, &policy(&registry())).unwrap(), batch);
    }
}

#[test]
fn all_prefix_truncations_and_trailing_bytes_fail() {
    let bytes = encoded();
    for length in 0..bytes.len() {
        rejection(&bytes[..length], Error::InvalidLength);
    }
    for length in [1, 2, 48, MAX_PACKET_BYTES] {
        let mut extended = bytes.clone();
        extended.resize(bytes.len() + length, 0);
        rejection(&extended, Error::InvalidLength);
    }
}

#[test]
fn header_and_reserved_fields_are_closed() {
    for (offset, value, expected) in [
        (0, 0, Error::InvalidMagic),
        (4, 2, Error::UnsupportedVersion),
        (5, 1, Error::UnsupportedVersion),
        (6, 1, Error::ReservedField),
        (7, 1, Error::ReservedField),
        (18, 1, Error::ReservedField),
        (19, 1, Error::ReservedField),
        (86, 1, Error::ReservedField),
        (87, 1, Error::ReservedField),
    ] {
        let mut bytes = encoded();
        bytes[offset] = value;
        rejection(&bytes, expected);
    }
}

#[test]
fn invalid_counts_reject_before_records_are_read() {
    for offset in [12, 14, 16] {
        let mut bytes = encoded();
        bytes[offset..offset + 2].copy_from_slice(&4097_u16.to_le_bytes());
        rejection(&bytes, Error::RecordLimit);
        bytes[offset..offset + 2].copy_from_slice(&u16::MAX.to_le_bytes());
        rejection(&bytes, Error::RecordLimit);
        bytes[offset..offset + 2].copy_from_slice(&2_u16.to_le_bytes());
        rejection(&bytes, Error::InvalidLength);
    }
    let mut bytes = encoded();
    bytes[12..18].fill(0);
    bytes.truncate(HEADER_BYTES);
    rejection(&bytes, Error::EmptyBatch);
    let mut batch = sample();
    batch.usage.clear();
    batch.prompts.clear();
    batch.intervals.clear();
    assert_eq!(encode(&batch, &policy(&registry())), Err(Error::EmptyBatch));
}

#[test]
fn maximum_counts_and_size_roundtrip_and_next_count_fails() {
    let mut batch = sample();
    let usage = batch.usage[0].clone();
    let prompt = batch.prompts[0].clone();
    let interval = batch.intervals[0].clone();
    batch.usage = (1..=MAX_RECORDS as u32)
        .map(|number| Usage {
            id: id(number),
            ..usage.clone()
        })
        .collect();
    batch.prompts = (1..=MAX_RECORDS as u32)
        .map(|number| Prompt {
            id: id(number),
            ..prompt.clone()
        })
        .collect();
    batch.intervals = (1..=MAX_RECORDS as u32)
        .map(|number| Interval {
            execution_id: id(number),
            ..interval.clone()
        })
        .collect();
    let bytes = encode(&batch, &policy(&registry())).unwrap();
    assert_eq!(bytes.len(), 884_760);
    assert_eq!(bytes.len(), MAX_PACKET_BYTES);
    assert_eq!(decode(&bytes, &policy(&registry())).unwrap(), batch);
    for family in 0..3 {
        let mut excessive = batch.clone();
        match family {
            0 => excessive.usage.push(usage.clone()),
            1 => excessive.prompts.push(prompt.clone()),
            _ => excessive.intervals.push(interval.clone()),
        }
        assert_eq!(
            encode(&excessive, &policy(&registry())),
            Err(Error::RecordLimit)
        );
    }
}

#[test]
fn day_policy_is_inclusive_and_explicit() {
    let registry = registry();
    let policy = policy(&registry);
    for day in [policy.first_day, policy.last_day] {
        let mut batch = sample();
        batch.utc_day = day;
        let bytes = encode(&batch, &policy).unwrap();
        assert_eq!(decode(&bytes, &policy).unwrap(), batch);
    }
    for day in [0, policy.first_day - 1, policy.last_day + 1, u32::MAX] {
        let mut batch = sample();
        batch.utc_day = day;
        assert_eq!(encode(&batch, &policy), Err(Error::DayOutOfRange));
        let mut bytes = encoded();
        bytes[8..12].copy_from_slice(&day.to_le_bytes());
        rejection(&bytes, Error::DayOutOfRange);
    }
    let invalid = Policy {
        first_day: 2,
        last_day: 1,
        registry: &registry,
    };
    assert_eq!(encode(&sample(), &invalid), Err(Error::InvalidPolicy));
    assert_eq!(decode(&encoded(), &invalid), Err(Error::InvalidPolicy));
}

#[test]
fn registry_revision_and_provider_model_pair_must_match() {
    let mut bytes = encoded();
    bytes[20..24].copy_from_slice(&2_u32.to_le_bytes());
    rejection(&bytes, Error::RegistryMismatch);
    let mut batch = sample();
    batch.registry_revision = 2;
    assert_eq!(
        encode(&batch, &policy(&registry())),
        Err(Error::RegistryMismatch)
    );
    for model in [7, 9, u32::MAX] {
        batch = sample();
        batch.usage[0].model_id = model;
        assert_eq!(
            encode(&batch, &policy(&registry())),
            Err(Error::UnknownModel)
        );
        let mut bytes = encoded();
        bytes[80..84].copy_from_slice(&model.to_le_bytes());
        rejection(&bytes, Error::UnknownModel);
    }
    let empty_registry = Registry {
        revision: 1,
        models: vec![],
    };
    for provider in [Provider::Codex, Provider::ClaudeCode] {
        batch = sample();
        batch.usage[0].provider = provider;
        batch.usage[0].model_id = 0;
        batch.usage[0].tokens.cache_write_5m = 0;
        batch.usage[0].tokens.cache_write_1h = 0;
        let bytes = encode(&batch, &policy(&empty_registry)).unwrap();
        assert_eq!(decode(&bytes, &policy(&empty_registry)).unwrap(), batch);
    }
}

#[test]
fn unsupported_enum_values_context_tiers_and_evidence_fail() {
    for (offset, valid) in [
        (76, vec![1, 2]),
        (77, vec![0, 1, 2]),
        (188, vec![1, 2]),
        (189, vec![0, 1, 2]),
        (232, vec![1, 2]),
        (233, vec![1, 2]),
    ] {
        for value in 0..=u8::MAX {
            if !valid.contains(&value) {
                let mut bytes = encoded();
                bytes[offset] = value;
                rejection(&bytes, Error::UnsupportedValue);
            }
        }
    }
    for offset in [78, 190, 234] {
        for flags in [0_u16, 3, 4, 0x101, 0x102, u16::MAX] {
            let mut bytes = encoded();
            bytes[offset..offset + 2].copy_from_slice(&flags.to_le_bytes());
            rejection(&bytes, Error::InvalidEvidence);
        }
    }
    for tier in [1_u16, u16::MAX] {
        let mut bytes = encoded();
        bytes[84..86].copy_from_slice(&tier.to_le_bytes());
        rejection(&bytes, Error::UnsupportedValue);
        let mut batch = sample();
        batch.usage[0].context_tier = tier;
        assert_eq!(
            encode(&batch, &policy(&registry())),
            Err(Error::UnsupportedValue)
        );
    }
}

#[test]
fn all_defined_enums_roundtrip() {
    for provider in [Provider::Codex, Provider::ClaudeCode] {
        for auth_mode in [AuthMode::Unknown, AuthMode::Subscription, AuthMode::Api] {
            for origin in [Origin::Unknown, Origin::Human, Origin::Automation] {
                for evidence in [Evidence::Imported, Evidence::Live] {
                    for kind in [IntervalKind::AgentWork, IntervalKind::ApiRequest] {
                        let mut batch = sample();
                        batch.usage[0].provider = provider;
                        batch.usage[0].model_id = 0;
                        batch.usage[0].tokens.cache_write_5m = 0;
                        batch.usage[0].tokens.cache_write_1h = 0;
                        batch.usage[0].auth_mode = auth_mode;
                        batch.usage[0].evidence = evidence;
                        batch.prompts[0].provider = provider;
                        batch.prompts[0].origin = origin;
                        batch.prompts[0].evidence = evidence;
                        batch.intervals[0].provider = provider;
                        batch.intervals[0].kind = kind;
                        batch.intervals[0].evidence = evidence;
                        let bytes = encode(&batch, &policy(&registry())).unwrap();
                        assert_eq!(decode(&bytes, &policy(&registry())).unwrap(), batch);
                    }
                }
            }
        }
    }
}

#[test]
fn required_ids_are_nonzero_but_unknown_optional_ids_are_allowed() {
    for offset in [24, 136, 192] {
        let mut bytes = encoded();
        bytes[offset..offset + 16].fill(0);
        rejection(&bytes, Error::InvalidId);
    }
    for family in 0..3 {
        let mut batch = sample();
        match family {
            0 => batch.usage[0].id = [0; 16],
            1 => batch.prompts[0].id = [0; 16],
            _ => batch.intervals[0].execution_id = [0; 16],
        }
        assert_eq!(encode(&batch, &policy(&registry())), Err(Error::InvalidId));
    }
    let mut batch = sample();
    batch.usage[0].execution_id = [0; 16];
    batch.usage[0].account_id = [0; 16];
    batch.prompts[0].execution_id = [0; 16];
    batch.prompts[0].account_id = [0; 16];
    batch.intervals[0].account_id = [0; 16];
    let bytes = encode(&batch, &policy(&registry())).unwrap();
    assert_eq!(decode(&bytes, &policy(&registry())).unwrap(), batch);
}

#[test]
fn usage_and_prompt_offsets_exclude_midnight() {
    for offset in [0, DAY_MS - 1] {
        let mut batch = sample();
        batch.usage[0].offset_ms = offset;
        batch.prompts[0].offset_ms = offset;
        let bytes = encode(&batch, &policy(&registry())).unwrap();
        assert_eq!(decode(&bytes, &policy(&registry())).unwrap(), batch);
    }
    for offset in [DAY_MS, u32::MAX] {
        for wire_offset in [72, 184] {
            let mut bytes = encoded();
            bytes[wire_offset..wire_offset + 4].copy_from_slice(&offset.to_le_bytes());
            rejection(&bytes, Error::InvalidOffset);
        }
        for family in 0..2 {
            let mut batch = sample();
            if family == 0 {
                batch.usage[0].offset_ms = offset;
            } else {
                batch.prompts[0].offset_ms = offset;
            }
            assert_eq!(
                encode(&batch, &policy(&registry())),
                Err(Error::InvalidOffset)
            );
        }
    }
}

#[test]
fn interval_bounds_allow_day_end_but_not_zero_duration_or_large_uncertainty() {
    for (start, end) in [(0, 1), (0, DAY_MS), (DAY_MS - 1, DAY_MS)] {
        let mut batch = sample();
        batch.intervals[0].start_ms = start;
        batch.intervals[0].end_ms = end;
        batch.intervals[0].clock_uncertainty_ms = MAX_CLOCK_UNCERTAINTY_MS;
        let bytes = encode(&batch, &policy(&registry())).unwrap();
        assert_eq!(decode(&bytes, &policy(&registry())).unwrap(), batch);
    }
    for (start, end) in [
        (0, 0),
        (1, 1),
        (2, 1),
        (DAY_MS, DAY_MS),
        (0, DAY_MS + 1),
        (0, u32::MAX),
    ] {
        let mut batch = sample();
        batch.intervals[0].start_ms = start;
        batch.intervals[0].end_ms = end;
        assert_eq!(
            encode(&batch, &policy(&registry())),
            Err(Error::InvalidInterval)
        );
        let mut bytes = encoded();
        bytes[224..228].copy_from_slice(&start.to_le_bytes());
        bytes[228..232].copy_from_slice(&end.to_le_bytes());
        rejection(&bytes, Error::InvalidInterval);
    }
    for uncertainty in [MAX_CLOCK_UNCERTAINTY_MS + 1, u32::MAX] {
        let mut batch = sample();
        batch.intervals[0].clock_uncertainty_ms = uncertainty;
        assert_eq!(
            encode(&batch, &policy(&registry())),
            Err(Error::InvalidClockUncertainty)
        );
        let mut bytes = encoded();
        bytes[236..240].copy_from_slice(&uncertainty.to_le_bytes());
        rejection(&bytes, Error::InvalidClockUncertainty);
    }
}

#[test]
fn token_sum_excludes_reasoning_and_checks_every_bound() {
    assert_eq!(sample().usage[0].tokens.total(), Ok(65));
    assert_eq!(Tokens::default().total(), Ok(0));
    let maximum = Tokens {
        input_uncached: MAX_TOKEN_COUNTER,
        cache_read: MAX_TOKEN_COUNTER,
        cache_write_5m: MAX_TOKEN_COUNTER,
        cache_write_1h: MAX_TOKEN_COUNTER,
        output: MAX_TOKEN_COUNTER,
        reasoning_output: MAX_TOKEN_COUNTER,
    };
    assert_eq!(maximum.total(), Ok(MAX_TOKEN_COUNTER * 5));
    let mut batch = sample();
    batch.usage[0].tokens = maximum;
    let bytes = encode(&batch, &policy(&registry())).unwrap();
    assert_eq!(decode(&bytes, &policy(&registry())).unwrap(), batch);
    for counter in 0..6 {
        for invalid in [MAX_TOKEN_COUNTER + 1, u64::MAX] {
            let mut bytes = encoded();
            bytes[88 + counter * 8..96 + counter * 8].copy_from_slice(&invalid.to_le_bytes());
            rejection(&bytes, Error::InvalidTokens);
        }
    }
    for invalid in [
        Tokens {
            reasoning_output: 16,
            ..sample().usage[0].tokens
        },
        Tokens::default(),
    ] {
        batch.usage[0].tokens = invalid;
        assert_eq!(
            encode(&batch, &policy(&registry())),
            Err(Error::InvalidTokens)
        );
    }
    let mut bytes = encoded();
    bytes[128..136].copy_from_slice(&16_u64.to_le_bytes());
    rejection(&bytes, Error::InvalidTokens);
    bytes[88..136].fill(0);
    rejection(&bytes, Error::InvalidTokens);
}

#[test]
fn codex_cache_write_counters_are_rejected_independently() {
    for tokens in [
        Tokens {
            input_uncached: 1,
            cache_write_5m: 1,
            ..Tokens::default()
        },
        Tokens {
            input_uncached: 1,
            cache_write_1h: 1,
            ..Tokens::default()
        },
    ] {
        let mut batch = sample();
        batch.usage[0].tokens = tokens;
        batch.usage[0].model_id = 0;
        let mut bytes = encode(&batch, &policy(&registry())).unwrap();
        batch.usage[0].provider = Provider::Codex;
        assert_eq!(
            encode(&batch, &policy(&registry())),
            Err(Error::InvalidTokens)
        );
        bytes[76] = 1;
        rejection(&bytes, Error::InvalidTokens);
    }
}

#[test]
fn duplicates_and_reversed_occurrence_keys_fail_for_both_families() {
    for family in 0..2 {
        let mut batch = sample();
        if family == 0 {
            let mut next = batch.usage[0].clone();
            next.id = id(5);
            batch.usage.push(next);
        } else {
            let mut next = batch.prompts[0].clone();
            next.id = id(5);
            batch.prompts.push(next);
        }
        let bytes = encode(&batch, &policy(&registry())).unwrap();
        let (first, second) = if family == 0 { (24, 136) } else { (136, 192) };
        for duplicate in [false, true] {
            let mut changed = batch.clone();
            let mut changed_bytes = bytes.clone();
            if family == 0 {
                if duplicate {
                    changed.usage[1].id = changed.usage[0].id;
                } else {
                    changed.usage.swap(0, 1);
                }
            } else if duplicate {
                changed.prompts[1].id = changed.prompts[0].id;
            } else {
                changed.prompts.swap(0, 1);
            }
            let original = changed_bytes[first..first + 16].to_vec();
            if !duplicate {
                changed_bytes.copy_within(second..second + 16, first);
            }
            changed_bytes[second..second + 16].copy_from_slice(&original);
            assert_eq!(
                encode(&changed, &policy(&registry())),
                Err(Error::NonCanonicalOrder)
            );
            rejection(&changed_bytes, Error::NonCanonicalOrder);
        }
    }
}

#[test]
fn interval_order_uses_all_six_key_parts_but_excludes_evidence() {
    let base = sample().intervals[0].clone();
    let mut variants = vec![
        base.clone(),
        Interval {
            provider: Provider::Codex,
            ..base.clone()
        },
        Interval {
            account_id: id(4),
            ..base.clone()
        },
        Interval {
            end_ms: 44,
            ..base.clone()
        },
        Interval {
            start_ms: 2,
            ..base.clone()
        },
        Interval {
            kind: IntervalKind::ApiRequest,
            ..base.clone()
        },
        Interval {
            execution_id: id(3),
            ..base.clone()
        },
    ];
    variants.sort_by_key(Interval::key);
    let mut batch = sample();
    batch.intervals = variants;
    let bytes = encode(&batch, &policy(&registry())).unwrap();
    assert_eq!(decode(&bytes, &policy(&registry())).unwrap(), batch);
    for index in 1..batch.intervals.len() {
        let mut swapped = batch.clone();
        swapped.intervals.swap(index - 1, index);
        assert_eq!(
            encode(&swapped, &policy(&registry())),
            Err(Error::NonCanonicalOrder)
        );
        let mut bytes = encoded();
        // Build a valid two-interval frame, then reverse its fixed-size records.
        let mut pair = sample();
        pair.intervals = batch.intervals[index - 1..=index].to_vec();
        bytes.clear();
        bytes.extend(encode(&pair, &policy(&registry())).unwrap());
        let first = bytes[192..240].to_vec();
        bytes.copy_within(240..288, 192);
        bytes[240..288].copy_from_slice(&first);
        rejection(&bytes, Error::NonCanonicalOrder);
    }
    batch.intervals = vec![
        base.clone(),
        Interval {
            evidence: Evidence::Imported,
            clock_uncertainty_ms: 3,
            ..base
        },
    ];
    assert_eq!(
        encode(&batch, &policy(&registry())),
        Err(Error::NonCanonicalOrder)
    );
}

#[test]
fn identifier_order_is_lexicographic_not_little_endian_numeric() {
    let mut batch = sample();
    batch.usage[0].id = [0; 16];
    batch.usage[0].id[1] = 255;
    let mut next = batch.usage[0].clone();
    next.id = [0; 16];
    next.id[0] = 1;
    batch.usage.push(next);
    let bytes = encode(&batch, &policy(&registry())).unwrap();
    assert_eq!(decode(&bytes, &policy(&registry())).unwrap(), batch);
}

#[test]
fn deterministic_generated_batches_obey_roundtrip_and_disjoint_sum_laws() {
    let mut random = 0x7016_6ba0_f49a_42c2_u64;
    let mut next = || {
        random ^= random << 13;
        random ^= random >> 7;
        random ^= random << 17;
        random
    };
    for iteration in 0..512 {
        let mut batch = sample();
        batch.utc_day = 20_000 + (next() % 1001) as u32;
        batch.usage.clear();
        for occurrence in 1..=1 + iteration % 19 {
            let mut record = sample().usage[0].clone();
            record.id = id(occurrence);
            record.offset_ms = (next() % u64::from(DAY_MS)) as u32;
            record.tokens = Tokens {
                input_uncached: next() % (MAX_TOKEN_COUNTER + 1),
                cache_read: next() % (MAX_TOKEN_COUNTER + 1),
                cache_write_5m: next() % (MAX_TOKEN_COUNTER + 1),
                cache_write_1h: next() % (MAX_TOKEN_COUNTER + 1),
                output: 1 + next() % MAX_TOKEN_COUNTER,
                reasoning_output: 0,
            };
            record.tokens.reasoning_output = next() % (record.tokens.output + 1);
            assert_eq!(
                record.tokens.total().unwrap(),
                record.tokens.input_uncached
                    + record.tokens.cache_read
                    + record.tokens.cache_write_5m
                    + record.tokens.cache_write_1h
                    + record.tokens.output
            );
            batch.usage.push(record);
        }
        let bytes = encode(&batch, &policy(&registry())).unwrap();
        let decoded = decode(&bytes, &policy(&registry())).unwrap();
        assert_eq!(decoded, batch);
        assert_eq!(encode(&decoded, &policy(&registry())).unwrap(), bytes);
    }
}

#[test]
fn deterministic_arbitrary_bytes_never_panic_or_gain_noncanonical_representation() {
    let mut random = 0x9f97_2dd2_2397_d1b3_u64;
    let original = encoded();
    for iteration in 0..4096 {
        random ^= random << 13;
        random ^= random >> 7;
        random ^= random << 17;
        let mut bytes = original.clone();
        let index = random as usize % bytes.len();
        bytes[index] ^= (random >> 32) as u8;
        if iteration % 3 == 0 {
            bytes.truncate(random as usize % bytes.len());
        }
        if let Ok(batch) = decode(&bytes, &policy(&registry())) {
            assert_eq!(encode(&batch, &policy(&registry())).unwrap(), bytes);
        }
    }
}

#[test]
fn errors_do_not_reflect_submitted_bytes() {
    for secret in [b"chat".as_slice(), b"path", b"name", b"auth"] {
        let mut bytes = encoded();
        bytes[..4].copy_from_slice(secret);
        let error = decode(&bytes, &policy(&registry())).unwrap_err();
        assert_eq!(error.to_string(), "invalid_magic");
        assert_eq!(format!("{error:?}"), "InvalidMagic");
    }
}

#[test]
fn shared_golden_fixture_matches_the_independent_wire_layout() {
    let hex: String = include_str!("../../../fixtures/usage/v1.hex")
        .chars()
        .filter(|character| !character.is_ascii_whitespace())
        .collect();
    assert_eq!(hex.len(), 480);
    let bytes: Vec<u8> = (0..hex.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&hex[index..index + 2], 16).unwrap())
        .collect();
    let expected = Batch {
        utc_day: 20_000,
        registry_revision: 1,
        usage: vec![Usage {
            id: [1; 16],
            execution_id: [2; 16],
            account_id: [3; 16],
            offset_ms: 1234,
            provider: Provider::Codex,
            auth_mode: AuthMode::Subscription,
            evidence: Evidence::Imported,
            model_id: 0,
            context_tier: 0,
            tokens: Tokens {
                input_uncached: 123,
                cache_read: 456,
                cache_write_5m: 0,
                cache_write_1h: 0,
                output: 789,
                reasoning_output: 42,
            },
        }],
        prompts: vec![Prompt {
            id: [4; 16],
            execution_id: [0; 16],
            account_id: [0; 16],
            offset_ms: 1000,
            provider: Provider::Codex,
            origin: Origin::Unknown,
            evidence: Evidence::Imported,
        }],
        intervals: vec![Interval {
            execution_id: [2; 16],
            account_id: [3; 16],
            start_ms: 1000,
            end_ms: 2000,
            provider: Provider::Codex,
            kind: IntervalKind::AgentWork,
            evidence: Evidence::Live,
            clock_uncertainty_ms: 5,
        }],
    };
    assert_eq!(decode(&bytes, &policy(&registry())).unwrap(), expected);
    assert_eq!(encode(&expected, &policy(&registry())).unwrap(), bytes);
}
