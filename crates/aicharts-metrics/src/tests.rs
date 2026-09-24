use super::*;

#[test]
fn addition_profiles_and_replacement_refuse_without_partial_state() {
    assert_eq!(checked_add(u128::MAX, 0), Ok(u128::MAX));
    assert_eq!(checked_add(u128::MAX, 1), Err(Error::Overflow));
    assert_eq!(
        checked_add_bounded(MAX_DECIMAL - 1, 1, MAX_DECIMAL),
        Ok(MAX_DECIMAL)
    );
    assert_eq!(
        checked_add_bounded(MAX_DECIMAL, 1, MAX_DECIMAL),
        Err(Error::Limit)
    );
    assert_eq!(checked_sum([u128::MAX, 0, 0, 0, 0]), Ok(u128::MAX));
    assert_eq!(checked_sum([1, u128::MAX, 0, 0, 0]), Err(Error::Overflow));
    let total = u128::MAX;
    assert_eq!(checked_replace(total, 7, 7), Ok(total));
    assert_eq!(checked_replace(total, 7, 8), Err(Error::Overflow));
    assert_eq!(checked_replace(3, 4, 0), Err(Error::Underflow));
    assert_eq!(total, u128::MAX);
    assert_eq!(checked_sum::<0>([]), Ok(0));
}

#[test]
fn all_rounding_rules_match_independent_small_integer_references() {
    for numerator in 0u64..512 {
        for denominator in 1u64..33 {
            let ratio = ExactRatio::new(numerator.into(), denominator.into()).unwrap();
            assert_eq!(
                ratio.rounded(Rounding::Floor),
                Ok((numerator / denominator).into())
            );
            assert_eq!(
                ratio.rounded(Rounding::Ceiling),
                Ok(numerator.div_ceil(denominator).into())
            );
            assert_eq!(
                ratio.rounded(Rounding::HalfUp),
                Ok(((2 * numerator + denominator) / (2 * denominator)).into())
            );
        }
    }
    assert_eq!(ExactRatio::new(0, 0), Err(Error::ZeroDenominator));
    for rounding in [Rounding::Floor, Rounding::Ceiling, Rounding::HalfUp] {
        assert_eq!(
            ExactRatio::new(u128::MAX, 1).unwrap().rounded(rounding),
            Ok(u128::MAX)
        );
        assert_eq!(
            ExactRatio::new(u128::MAX, u128::MAX)
                .unwrap()
                .rounded(rounding),
            Ok(1)
        );
    }
    assert_eq!(
        ExactRatio::new(u128::MAX / 2, u128::MAX)
            .unwrap()
            .rounded(Rounding::HalfUp),
        Ok(0)
    );
    assert_eq!(
        ExactRatio::new(u128::MAX / 2 + 1, u128::MAX)
            .unwrap()
            .rounded(Rounding::HalfUp),
        Ok(1)
    );
}

#[test]
fn prices_keep_unused_unknown_rates_and_one_record_rounding() {
    assert_eq!(price_microusd([0; 5], [None; 5]), Ok(0));
    assert_eq!(
        price_microusd([1, 0, 0, 0, 0], [Some(0), None, None, None, None]),
        Ok(0)
    );
    assert_eq!(
        price_microusd([1, 1, 0, 0, 0], [Some(1), None, None, None, None]),
        Err(Error::MissingRate)
    );
    // Separate bucket rounding would produce 0; the record's exact sum yields 1.
    assert_eq!(
        price_microusd(
            [1, 1, 0, 0, 0],
            [Some(250_000), Some(250_000), None, None, None]
        ),
        Ok(1)
    );
    assert_eq!(
        price_microusd(
            [100, 0, 0, 10, 5],
            [
                Some(2_500_000),
                None,
                None,
                Some(10_000_000),
                Some(10_000_000)
            ]
        ),
        Ok(400)
    );
    assert_eq!(
        price_microusd([2, 0, 0, 0, 0], [Some(u128::MAX), None, None, None, None]),
        Err(Error::Overflow)
    );
    // Preserve the existing half-up offset's overflow/refusal boundary.
    assert_eq!(
        price_microusd([u128::MAX, 0, 0, 0, 0], [Some(1), None, None, None, None]),
        Err(Error::Overflow)
    );
    assert_eq!(
        price_microusd(
            [MAX_DECIMAL, 0, 0, 0, 0],
            [Some(1_000_000), None, None, None, None]
        ),
        Ok(MAX_DECIMAL)
    );
    assert_eq!(
        price_microusd(
            [MAX_DECIMAL + 1, 0, 0, 0, 0],
            [Some(1_000_000), None, None, None, None]
        ),
        Err(Error::Limit)
    );
    let last_unit_rate_input = MAX_DECIMAL * 1_000_000 + 499_999;
    assert_eq!(
        price_microusd(
            [last_unit_rate_input, 0, 0, 0, 0],
            [Some(1), None, None, None, None]
        ),
        Ok(MAX_DECIMAL)
    );
    assert_eq!(
        price_microusd(
            [last_unit_rate_input + 1, 0, 0, 0, 0],
            [Some(1), None, None, None, None]
        ),
        Err(Error::Limit)
    );
    for (tokens, error) in [
        (u128::MAX - 500_000, Error::Limit),
        (u128::MAX - 499_999, Error::Overflow),
    ] {
        assert_eq!(
            price_microusd([tokens, 0, 0, 0, 0], [Some(1), None, None, None, None]),
            Err(error)
        );
    }
}

#[test]
fn wire_total_counts_reasoning_once_at_real_scalar_limits() {
    assert_eq!(
        wire_token_total([MAX_WIRE_TOKEN_COUNTER; 6]),
        Ok(5 * MAX_WIRE_TOKEN_COUNTER)
    );
    assert_eq!(wire_token_total([0; 6]), Ok(0));
    assert_eq!(
        wire_token_total([0, 0, 0, 0, 3, 4]),
        Err(Error::InvalidPartition)
    );
    for index in 0..6 {
        let mut values = [0; 6];
        values[index] = MAX_WIRE_TOKEN_COUNTER + 1;
        assert_eq!(wire_token_total(values), Err(Error::Limit));
    }
}

#[test]
fn profile_conversion_preserves_partition_and_refuses_invented_evidence() {
    let counters = [10, 20, 30, 40, 50, 15];
    let partition = TokenPartition::from_wire(counters, true).unwrap();
    assert_eq!(partition.total(), Ok(150));
    assert_eq!(partition.to_detailed(), Ok([10, 20, 70, 35, 15]));
    assert_eq!(partition.to_wire(), Ok(counters));
    let detail = TokenPartition::from_detailed([10, 20, 70, 35, 15]).unwrap();
    assert_eq!(detail.total(), partition.total());
    assert_eq!(detail.cache_write.ttl(), CacheTtl::Unknown);
    assert_eq!(detail.to_wire(), Err(Error::MissingCacheTtl));
    let unknown = TokenPartition::from_wire([10, 20, 30, 40, 50, 0], false).unwrap();
    assert_eq!(unknown.output.total(), 50);
    assert_eq!(unknown.output.reasoning(), None);
    assert_eq!(unknown.to_detailed(), Err(Error::MissingReasoning));
    assert_eq!(unknown.to_wire(), Err(Error::MissingReasoning));
    assert_eq!(
        TokenPartition::from_wire(counters, false),
        Err(Error::InvalidPartition)
    );
    assert_eq!(
        InclusiveOutput::new(0, Some(0)).unwrap().disjoint(),
        Ok([0, 0])
    );
    assert_eq!(
        InclusiveOutput::new(0, None).unwrap().disjoint(),
        Err(Error::MissingReasoning)
    );
}

#[test]
fn full_width_partition_overflow_and_profile_limits_are_distinct() {
    assert_eq!(
        CacheWrites::with_ttl(u128::MAX, u128::MAX, 0)
            .unwrap()
            .total(),
        u128::MAX
    );
    assert_eq!(CacheWrites::with_ttl(0, u128::MAX, 1), Err(Error::Overflow));
    assert_eq!(CacheWrites::with_ttl(5, 2, 2), Err(Error::InvalidPartition));
    assert_eq!(
        InclusiveOutput::from_disjoint(u128::MAX, 1),
        Err(Error::Overflow)
    );
    assert_eq!(
        InclusiveOutput::new(1, Some(2)),
        Err(Error::InvalidPartition)
    );
    assert_eq!(
        TokenPartition::from_detailed([MAX_DECIMAL + 1, 0, 0, 0, 0]),
        Err(Error::Limit)
    );
    let partition = TokenPartition {
        input_uncached: u128::MAX,
        cache_read: 1,
        cache_write: CacheWrites::unknown(0),
        output: InclusiveOutput::new(0, None).unwrap(),
    };
    assert_eq!(partition.total(), Err(Error::Overflow));
    let mut representability = TokenPartition::from_wire([0; 6], true).unwrap();
    representability.input_uncached = u128::from(u64::MAX) + 1;
    assert_eq!(representability.to_wire(), Err(Error::Limit));
}

#[test]
fn owner_enrichment_is_symmetric_and_never_picks_a_conflicting_known_owner() {
    for allow in [false, true] {
        for left in [[0; 16], [1; 16], [2; 16]] {
            for right in [[0; 16], [1; 16], [2; 16]] {
                assert_eq!(
                    merge_owner(left, right, allow),
                    merge_owner(right, left, allow)
                );
                let result = merge_owner(left, right, allow);
                if left != right && (!allow || (left != [0; 16] && right != [0; 16])) {
                    assert_eq!(result, Err(Error::OwnerConflict));
                } else {
                    assert_eq!(result, Ok(if left != [0; 16] { left } else { right }));
                }
            }
        }
    }
}

#[test]
fn dominance_keeps_the_historical_nonassociativity_counterexample_visible() {
    let (left, right, maximum) = ([3, 1], [1, 3], [3, 3]);
    assert_eq!(component_dominance(left, right), Dominance::Conflict);
    assert_eq!(component_dominance(maximum, left), Dominance::Left);
    assert_eq!(component_dominance(maximum, right), Dominance::Left);
    assert_eq!(component_dominance(left, maximum), Dominance::Right);
    assert_eq!(
        component_dominance([u64::MAX; 6], [u64::MAX; 6]),
        Dominance::Equal
    );
    assert_eq!(component_dominance::<0>([], []), Dominance::Equal);
}

fn population() -> Population {
    Population {
        identity: [7; 16],
        unit: 1,
        grain: 2,
    }
}

#[test]
fn matched_populations_require_compatible_identity_unit_grain_and_known_values() {
    let left = ScopedQuantity {
        population: population(),
        evidence: QuantityEvidence::Known {
            value: 0,
            basis: Basis::Reported,
        },
    };
    let right = ScopedQuantity {
        evidence: QuantityEvidence::Known {
            value: 3,
            basis: Basis::Estimated,
        },
        ..left
    };
    let matched = match_quantities(left, right).unwrap();
    assert_eq!(matched.left, 0);
    assert_eq!(matched.left_basis, Basis::Reported);
    assert_eq!(matched.right_basis, Basis::Estimated);
    assert_eq!(matched.ratio(), ExactRatio::new(0, 3));
    assert_eq!(
        match_quantities(left, left).unwrap().ratio(),
        Err(Error::ZeroDenominator)
    );
    for evidence in [QuantityEvidence::Unknown, QuantityEvidence::Unsupported] {
        assert_eq!(
            match_quantities(left, ScopedQuantity { evidence, ..right }),
            Err(Error::MissingEvidence)
        );
    }
    for incompatible in [
        Population {
            identity: [8; 16],
            ..population()
        },
        Population {
            unit: 2,
            ..population()
        },
        Population {
            grain: 3,
            ..population()
        },
    ] {
        assert_eq!(
            match_quantities(
                left,
                ScopedQuantity {
                    population: incompatible,
                    ..right
                }
            ),
            Err(Error::PopulationMismatch)
        );
    }
}

#[test]
fn evidence_folds_keep_zero_missing_and_estimated_populations_separate() {
    let facts = [
        QuantityEvidence::Known {
            value: 0,
            basis: Basis::Reported,
        },
        QuantityEvidence::Known {
            value: 17,
            basis: Basis::Derived,
        },
        QuantityEvidence::Known {
            value: 23,
            basis: Basis::Estimated,
        },
        QuantityEvidence::Unknown,
        QuantityEvidence::Unsupported,
    ];
    let fold = |values: &[QuantityEvidence]| {
        values
            .iter()
            .try_fold(EvidenceTotals::default(), |sum, value| sum.observe(*value))
    };
    let total = fold(&facts).unwrap();
    assert_eq!(total.reported, 0);
    assert_eq!(total.reported_records, 1);
    assert_eq!(total.derived, 17);
    assert_eq!(total.estimated, 23);
    assert_eq!(total.unknown_records, 1);
    assert_eq!(total.unsupported_records, 1);
    for split in 0..=facts.len() {
        assert_eq!(
            fold(&facts[..split])
                .unwrap()
                .merge(fold(&facts[split..]).unwrap()),
            Ok(total)
        );
    }
    let mut reversed = facts;
    reversed.reverse();
    assert_eq!(fold(&reversed), Ok(total));
    let old = EvidenceTotals {
        reported: u128::MAX,
        ..EvidenceTotals::default()
    };
    assert_eq!(
        old.observe(QuantityEvidence::Known {
            value: 1,
            basis: Basis::Reported
        }),
        Err(Error::Overflow)
    );
    assert_eq!(old.reported, u128::MAX);
    let old = EvidenceTotals {
        reported_records: u128::MAX,
        ..EvidenceTotals::default()
    };
    assert_eq!(
        old.observe(QuantityEvidence::Known {
            value: 0,
            basis: Basis::Reported
        }),
        Err(Error::Overflow)
    );
}
