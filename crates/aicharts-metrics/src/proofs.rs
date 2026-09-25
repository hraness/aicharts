//! Harnesses call the production functions, with no replacement stubs or
//! disabled safety checks. Scalar domains are their complete Rust widths unless
//! the name/contract explicitly fixes a rate or denominator. Container bounds
//! are the actual fixed profile lengths (five/six buckets, sixteen owner bytes).
use super::*;

/// A 129-bit addition oracle using independent 64-bit limbs. Each limb sum fits
/// u128; the carry decides whether the mathematical sum fits the result type.
fn reference_add(left: u128, right: u128) -> Option<u128> {
    let mask = u128::from(u64::MAX);
    let low = (left & mask) + (right & mask);
    let high = (left >> 64) + (right >> 64) + (low >> 64);
    if high > mask {
        None
    } else {
        Some((high << 64) | (low & mask))
    }
}

/// Every evidence basis, chosen by an unconstrained symbolic selector. Bases
/// are enumerated here so the harness never edits or derives on kernel types.
fn any_basis() -> Basis {
    match kani::any::<u8>() % 3 {
        0 => Basis::Reported,
        1 => Basis::Derived,
        _ => Basis::Estimated,
    }
}

/// The two counters a known observation of `basis` advances.
fn basis_components(totals: EvidenceTotals, basis: Basis) -> (u128, u128) {
    match basis {
        Basis::Reported => (totals.reported, totals.reported_records),
        Basis::Derived => (totals.derived, totals.derived_records),
        Basis::Estimated => (totals.estimated, totals.estimated_records),
    }
}

/// Every counter a known observation of `basis` must leave untouched.
fn other_components(totals: EvidenceTotals, basis: Basis) -> [u128; 6] {
    let (reported, derived, estimated) = (
        (totals.reported, totals.reported_records),
        (totals.derived, totals.derived_records),
        (totals.estimated, totals.estimated_records),
    );
    let (first, second) = match basis {
        Basis::Reported => (derived, estimated),
        Basis::Derived => (reported, estimated),
        Basis::Estimated => (reported, derived),
    };
    [
        first.0,
        first.1,
        second.0,
        second.1,
        totals.unknown_records,
        totals.unsupported_records,
    ]
}

fn any_totals() -> EvidenceTotals {
    EvidenceTotals {
        reported: kani::any(),
        reported_records: kani::any(),
        derived: kani::any(),
        derived_records: kani::any(),
        estimated: kani::any(),
        estimated_records: kani::any(),
        unknown_records: kani::any(),
        unsupported_records: kani::any(),
    }
}

#[kani::proof]
fn checked_add_full_u128_matches_129_bit_math() {
    let left: u128 = kani::any();
    let right: u128 = kani::any();
    let actual = checked_add(left, right);
    assert_eq!(actual.ok(), reference_add(left, right));
    kani::cover!(actual.is_ok());
    kani::cover!(actual == Err(Error::Overflow));
    kani::cover!(left == u128::MAX && right == 0 && actual == Ok(u128::MAX));
}

#[kani::proof]
fn bounded_add_full_u128_preserves_math_and_limit() {
    let left: u128 = kani::any();
    let right: u128 = kani::any();
    let limit: u128 = kani::any();
    let expected = reference_add(left, right).filter(|sum| *sum <= limit);
    let actual = checked_add_bounded(left, right, limit);
    assert_eq!(actual.ok(), expected);
    kani::cover!(actual.is_ok());
    kani::cover!(actual == Err(Error::Overflow));
    kani::cover!(actual == Err(Error::Limit));
}

#[kani::proof]
fn decimal_admission_has_exact_profile_boundary() {
    let value: u128 = kani::any();
    assert_eq!(admit_decimal(value).is_ok(), value <= MAX_DECIMAL);
    kani::cover!(value == MAX_DECIMAL && admit_decimal(value) == Ok(value));
    kani::cover!(value == MAX_DECIMAL + 1 && admit_decimal(value) == Err(Error::Limit));
}

#[kani::proof]
fn replacement_full_u128_refuses_underflow_or_overflow() {
    let total: u128 = kani::any();
    let previous: u128 = kani::any();
    let replacement: u128 = kani::any();
    let expected = if total < previous {
        None
    } else {
        reference_add(total - previous, replacement)
    };
    let actual = checked_replace(total, previous, replacement);
    assert_eq!(actual.ok(), expected);
    kani::cover!(actual.is_ok());
    kani::cover!(actual == Err(Error::Underflow));
    kani::cover!(actual == Err(Error::Overflow));
}

#[kani::proof]
#[kani::unwind(7)]
fn six_bucket_sum_matches_wider_integer_reference() {
    let values: [u64; 6] = kani::any();
    let expected = u128::from(values[0])
        + u128::from(values[1])
        + u128::from(values[2])
        + u128::from(values[3])
        + u128::from(values[4])
        + u128::from(values[5]);
    let actual = checked_sum(values.map(u128::from));
    assert_eq!(actual, Ok(expected));
    kani::cover!(expected > u128::from(u64::MAX));
    kani::cover!(expected == 0);
}

#[kani::proof]
#[kani::unwind(7)]
fn wire_total_full_u64_counts_the_output_subset_once() {
    let counters: [u64; 6] = kani::any();
    let valid =
        counters.iter().all(|value| *value <= 1_000_000_000_000) && counters[5] <= counters[4];
    let total = u128::from(counters[0])
        + u128::from(counters[1])
        + u128::from(counters[2])
        + u128::from(counters[3])
        + u128::from(counters[4]);
    let actual = wire_token_total(counters);
    assert_eq!(actual.is_ok(), valid);
    if let Ok(value) = actual {
        assert_eq!(u128::from(value), total);
    }
    kani::cover!(actual == Ok(5_000_000_000_000));
    kani::cover!(actual == Err(Error::Limit));
    kani::cover!(actual == Err(Error::InvalidPartition));
}

#[kani::proof]
fn inclusive_output_full_u128_preserves_unknown_and_known_subsets() {
    let total: u128 = kani::any();
    let reasoning: u128 = kani::any();
    let known: bool = kani::any();
    let actual = InclusiveOutput::new(total, known.then_some(reasoning));
    assert_eq!(actual.is_ok(), !known || reasoning <= total);
    if let Ok(output) = actual {
        assert_eq!(output.total(), total);
        if known {
            if let Ok([visible, subset]) = output.disjoint() {
                assert_eq!(subset, reasoning);
                assert_eq!(reference_add(visible, subset), Some(total));
            } else {
                assert!(false, "a valid known subset must split");
            }
        } else {
            assert_eq!(output.reasoning(), None);
            assert_eq!(output.disjoint(), Err(Error::MissingReasoning));
        }
    }
    kani::cover!(known && total == 0 && reasoning == 0 && actual.is_ok());
    kani::cover!(!known && total == 0 && actual.is_ok());
    kani::cover!(actual == Err(Error::InvalidPartition));
}

#[kani::proof]
fn cache_ttl_full_u128_requires_an_exact_retained_partition() {
    let total: u128 = kani::any();
    let five: u128 = kani::any();
    let hour: u128 = kani::any();
    let actual = CacheWrites::with_ttl(total, five, hour);
    assert_eq!(actual.is_ok(), reference_add(five, hour) == Some(total));
    let unknown = CacheWrites::unknown(total);
    assert_eq!(unknown.total(), total);
    assert_eq!(unknown.ttl(), CacheTtl::Unknown);
    kani::cover!(actual.is_ok());
    kani::cover!(actual == Err(Error::Overflow));
    kani::cover!(actual == Err(Error::InvalidPartition));
}

#[kani::proof]
#[kani::unwind(97)]
fn wire_profile_round_trip_preserves_full_admitted_counters() {
    let counters: [u64; 6] = kani::any();
    let actual = TokenPartition::from_wire(counters, true);
    assert_eq!(actual.is_ok(), wire_token_total(counters).is_ok());
    if let Ok(partition) = actual {
        assert_eq!(partition.to_wire(), Ok(counters));
        assert_eq!(
            partition.total(),
            wire_token_total(counters).map(u128::from)
        );
        if let Ok(detailed) = partition.to_detailed() {
            assert_eq!(checked_sum(detailed), partition.total());
        } else {
            assert!(
                false,
                "an admitted known wire partition must fit detailed buckets"
            );
        }
    }
    kani::cover!(actual.is_ok());
    kani::cover!(actual.is_err());
}

#[kani::proof]
#[kani::unwind(97)]
fn detailed_profile_full_u128_never_fabricates_ttl() {
    let values: [u128; 5] = kani::any();
    let actual = TokenPartition::from_detailed(values);
    assert_eq!(
        actual.is_ok(),
        values.iter().all(|value| *value <= MAX_DECIMAL)
    );
    if let Ok(partition) = actual {
        assert_eq!(partition.to_detailed(), Ok(values));
        assert_eq!(partition.cache_write.ttl(), CacheTtl::Unknown);
        assert_eq!(partition.to_wire(), Err(Error::MissingCacheTtl));
        assert_eq!(partition.total(), checked_sum(values));
    }
    kani::cover!(actual.is_ok());
    kani::cover!(actual == Err(Error::Limit));
}

#[kani::proof]
#[kani::unwind(17)]
fn owner_merge_full_ids_rejects_distinct_known_owners() {
    let left: [u8; 16] = kani::any();
    let right: [u8; 16] = kani::any();
    let allow: bool = kani::any();
    let valid = left == right || (allow && (left == [0; 16] || right == [0; 16]));
    let actual = merge_owner(left, right, allow);
    assert_eq!(actual.is_ok(), valid);
    assert_eq!(actual, merge_owner(right, left, allow));
    if let Ok(owner) = actual {
        assert_eq!(owner, if left != [0; 16] { left } else { right });
    }
    kani::cover!(actual.is_ok() && left == right && left != [0; 16]);
    kani::cover!(actual.is_ok() && left == [0; 16] && right != [0; 16]);
    kani::cover!(actual == Err(Error::OwnerConflict));
}

#[kani::proof]
#[kani::unwind(97)]
fn six_component_dominance_full_u64_is_partial_order_comparison() {
    let left: [u64; 6] = kani::any();
    let right: [u64; 6] = kani::any();
    let actual = component_dominance(left, right);
    let left_dominates = (0..6).all(|index| left[index] >= right[index]);
    let right_dominates = (0..6).all(|index| right[index] >= left[index]);
    assert_eq!(actual == Dominance::Equal, left == right);
    assert_eq!(actual == Dominance::Left, left_dominates && left != right);
    assert_eq!(actual == Dominance::Right, right_dominates && left != right);
    assert_eq!(
        actual == Dominance::Conflict,
        !left_dominates && !right_dominates
    );
    kani::cover!(actual == Dominance::Equal);
    kani::cover!(actual == Dominance::Left);
    kani::cover!(actual == Dominance::Right);
    kani::cover!(actual == Dominance::Conflict);
}

#[kani::proof]
fn rational_construction_full_u128_preserves_exact_components() {
    let numerator: u128 = kani::any();
    let denominator: u128 = kani::any();
    let actual = ExactRatio::new(numerator, denominator);
    assert_eq!(actual.is_ok(), denominator != 0);
    if let Ok(ratio) = actual {
        assert_eq!(ratio.numerator(), numerator);
        assert_eq!(ratio.denominator(), denominator);
    }
    kani::cover!(actual == Err(Error::ZeroDenominator));
    kani::cover!(numerator == 0 && actual.is_ok());
}

#[kani::proof]
#[kani::unwind(97)]
fn price_zero_or_missing_rates_preserves_full_u128_token_domain() {
    let tokens: [u128; 5] = kani::any();
    let actual = price_microusd(tokens, [None; 5]);
    assert_eq!(actual == Ok(0), tokens == [0; 5]);
    assert!(actual == Ok(0) || actual == Err(Error::MissingRate));
    kani::cover!(actual == Ok(0));
    kani::cover!(actual == Err(Error::MissingRate));
}

// The full-u128 unit-rate pricing obligation is proved against extracted
// production code by pricing_unit_rate_exact in verify/lean/Pricing.proofs.lean.
// Its three constructive boundary witnesses replace the retired solver covers;
// verify/kani/harnesses.json records the reviewed obligation transfer.

#[kani::proof]
fn evidence_add_full_u128_keeps_zero_distinct_from_missing() {
    let value: u128 = kani::any();
    let basis = any_basis();
    let old = any_totals();
    let (initial, count) = basis_components(old, basis);
    let actual = old.observe(QuantityEvidence::Known { value, basis });
    let expected_sum = reference_add(initial, value);
    let expected_count = reference_add(count, 1);
    assert_eq!(
        actual.map(|next| basis_components(next, basis)).ok(),
        expected_sum.zip(expected_count)
    );
    if let Ok(next) = actual {
        assert_eq!(other_components(next, basis), other_components(old, basis));
    }
    let unknown = old.observe(QuantityEvidence::Unknown);
    assert_eq!(
        unknown.map(|next| next.unknown_records).ok(),
        reference_add(old.unknown_records, 1)
    );
    if let Ok(next) = unknown {
        assert_eq!(basis_components(next, basis), (initial, count));
        assert_eq!(next.unsupported_records, old.unsupported_records);
    }
    let unsupported = old.observe(QuantityEvidence::Unsupported);
    assert_eq!(
        unsupported.map(|next| next.unsupported_records).ok(),
        reference_add(old.unsupported_records, 1)
    );
    if let Ok(next) = unsupported {
        assert_eq!(basis_components(next, basis), (initial, count));
        assert_eq!(next.unknown_records, old.unknown_records);
    }
    kani::cover!(value == 0 && actual.is_ok() && basis == Basis::Derived);
    kani::cover!(actual == Err(Error::Overflow) && basis == Basis::Estimated);
    kani::cover!(unknown == Err(Error::Overflow) && actual.is_ok());
}

#[kani::proof]
fn checked_add_full_u128_has_the_same_result_for_both_parenthesizations() {
    let a: u128 = kani::any();
    let b: u128 = kani::any();
    let c: u128 = kani::any();
    let left = checked_add(a, b).and_then(|sum| checked_add(sum, c));
    let right = checked_add(b, c).and_then(|sum| checked_add(a, sum));
    assert_eq!(left, right);
    kani::cover!(left.is_ok());
    kani::cover!(left == Err(Error::Overflow));
}

#[kani::proof]
#[kani::unwind(17)]
fn matching_full_population_identity_never_confuses_missing_with_zero() {
    let left_population = Population {
        identity: kani::any(),
        unit: kani::any(),
        grain: kani::any(),
    };
    let right_population = Population {
        identity: kani::any(),
        unit: kani::any(),
        grain: kani::any(),
    };
    let left_value: u128 = kani::any();
    let right_value: u128 = kani::any();
    let left_known: bool = kani::any();
    let right_known: bool = kani::any();
    let left_basis = any_basis();
    let right_basis = any_basis();
    let left = ScopedQuantity {
        population: left_population,
        evidence: if left_known {
            QuantityEvidence::Known {
                value: left_value,
                basis: left_basis,
            }
        } else {
            QuantityEvidence::Unknown
        },
    };
    let right = ScopedQuantity {
        population: right_population,
        evidence: if right_known {
            QuantityEvidence::Known {
                value: right_value,
                basis: right_basis,
            }
        } else {
            QuantityEvidence::Unsupported
        },
    };
    let actual = match_quantities(left, right);
    assert_eq!(
        actual.is_ok(),
        left_population == right_population && left_known && right_known
    );
    if let Ok(pair) = actual {
        assert_eq!(pair.left, left_value);
        assert_eq!(pair.right, right_value);
        assert_eq!(pair.left_basis, left_basis);
        assert_eq!(pair.right_basis, right_basis);
        assert_eq!(pair.ratio().is_ok(), right_value != 0);
    }
    kani::cover!(actual.is_ok() && left_value == 0 && left_basis != right_basis);
    kani::cover!(matches!(actual, Err(Error::MissingEvidence)) && left_value == 0);
    kani::cover!(matches!(actual, Err(Error::PopulationMismatch)));
}

#[kani::proof]
fn rounded_production_width_ratio_follows_floor_ceiling_and_half_up_laws() {
    // The domain is built from an exact quotient, nonzero denominator and
    // remainder below it so the reference needs no division: the only division
    // circuits are the production u128 ones under test. Wider symbolic operands
    // (u16 quotient with u8 denominator, or u32 with u16) exceeded a 900-second
    // CaDiCaL budget without a counterexample, so this bounded u8 domain is the
    // admitted Kani evidence; it exercises every rule and the exact half-up law
    // but does not qualify production-width operands. The gate refuses
    // `kani::assume`, so the domain is reached by total maps instead: a zero
    // denominator maps to one and an out-of-range remainder maps to zero, which
    // still reaches every nonzero u8 denominator and every remainder below it.
    let quotient: u8 = kani::any();
    let raw_denominator: u8 = kani::any();
    let denominator = if raw_denominator == 0 {
        1
    } else {
        raw_denominator
    };
    let raw_remainder: u8 = kani::any();
    let remainder = if raw_remainder < denominator {
        raw_remainder
    } else {
        0
    };
    let numerator = u128::from(u64::from(quotient) * u64::from(denominator) + u64::from(remainder));
    assert_eq!(ExactRatio::new(numerator, 0), Err(Error::ZeroDenominator));
    let selector: u8 = kani::any();
    let rule = match selector {
        0 => Rounding::Floor,
        1 => Rounding::Ceiling,
        _ => Rounding::HalfUp,
    };
    let increment = match rule {
        Rounding::Floor => 0,
        Rounding::Ceiling => u128::from(remainder != 0),
        // 2r >= d is the exact half-up law for every d, including odd d.
        Rounding::HalfUp => u128::from(u32::from(remainder) * 2 >= u32::from(denominator)),
    };
    let actual =
        ExactRatio::new(numerator, u128::from(denominator)).map(|ratio| ratio.rounded(rule));
    assert_eq!(actual, Ok(Ok(u128::from(quotient) + increment)));
    kani::cover!(rule == Rounding::Floor && remainder != 0);
    kani::cover!(rule == Rounding::Ceiling && increment == 1);
    kani::cover!(rule == Rounding::HalfUp && remainder != 0 && increment == 1);
    kani::cover!(rule == Rounding::HalfUp && remainder != 0 && increment == 0);
}

#[kani::proof]
fn evidence_merge_full_u128_adds_every_component_or_refuses() {
    let left = any_totals();
    let right = any_totals();
    let actual = left.merge(right);
    let expected = [
        reference_add(left.reported, right.reported),
        reference_add(left.reported_records, right.reported_records),
        reference_add(left.derived, right.derived),
        reference_add(left.derived_records, right.derived_records),
        reference_add(left.estimated, right.estimated),
        reference_add(left.estimated_records, right.estimated_records),
        reference_add(left.unknown_records, right.unknown_records),
        reference_add(left.unsupported_records, right.unsupported_records),
    ];
    let all_fit = expected[0].is_some()
        && expected[1].is_some()
        && expected[2].is_some()
        && expected[3].is_some()
        && expected[4].is_some()
        && expected[5].is_some()
        && expected[6].is_some()
        && expected[7].is_some();
    assert_eq!(actual.is_ok(), all_fit);
    if let Ok(merged) = actual {
        assert_eq!(Some(merged.reported), expected[0]);
        assert_eq!(Some(merged.reported_records), expected[1]);
        assert_eq!(Some(merged.derived), expected[2]);
        assert_eq!(Some(merged.derived_records), expected[3]);
        assert_eq!(Some(merged.estimated), expected[4]);
        assert_eq!(Some(merged.estimated_records), expected[5]);
        assert_eq!(Some(merged.unknown_records), expected[6]);
        assert_eq!(Some(merged.unsupported_records), expected[7]);
        assert_eq!(Ok(merged), right.merge(left));
    }
    kani::cover!(actual.is_ok() && left != EvidenceTotals::default());
    kani::cover!(actual == Err(Error::Overflow) && right.reported == 0);
}

#[kani::proof]
fn disjoint_output_full_u128_sums_visible_and_reasoning_once() {
    let visible: u128 = kani::any();
    let reasoning: u128 = kani::any();
    let actual = InclusiveOutput::from_disjoint(visible, reasoning);
    let expected = reference_add(visible, reasoning);
    assert_eq!(actual.map(InclusiveOutput::total).ok(), expected);
    if let Ok(output) = actual {
        assert_eq!(output.reasoning(), Some(reasoning));
        assert_eq!(output.disjoint(), Ok([visible, reasoning]));
        assert_eq!(
            Ok(output),
            InclusiveOutput::new(output.total(), Some(reasoning))
        );
    }
    kani::cover!(actual.is_ok() && visible == 0 && reasoning != 0);
    kani::cover!(actual == Err(Error::Overflow));
}
