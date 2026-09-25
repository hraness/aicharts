//! Seeded laws for the exact metric kernel. Every expectation is computed by
//! an independent fold over the same inputs, never by calling the kernel twice.
use crate::{config_from_env, receipt_line, Context, Rng};
use aicharts_metrics::{
    admit_decimal, checked_add, checked_add_bounded, checked_replace, checked_sum,
    component_dominance, merge_owner, price_microusd, wire_token_total, Dominance, Error,
    ExactRatio, Rounding, TokenPartition, MAX_DECIMAL, MAX_WIRE_TOKEN_COUNTER,
};

fn wide(rng: &mut Rng) -> u128 {
    match rng.below(8) {
        0 => 0,
        1 => u128::from(rng.below(1_000)),
        2 => MAX_DECIMAL,
        3 => MAX_DECIMAL + 1,
        4 => u128::MAX,
        5 => u128::MAX - u128::from(rng.below(1_000)),
        6 => u128::from(rng.next_u64()),
        _ => (u128::from(rng.next_u64()) << 64) | u128::from(rng.next_u64()),
    }
}

fn counter(rng: &mut Rng) -> u64 {
    match rng.below(8) {
        0 => 0,
        1 => rng.below(64),
        2 => MAX_WIRE_TOKEN_COUNTER,
        3 => MAX_WIRE_TOKEN_COUNTER + 1 + rng.below(1_000),
        4 => MAX_WIRE_TOKEN_COUNTER - rng.below(1_000),
        _ => rng.below(MAX_WIRE_TOKEN_COUNTER),
    }
}

fn vector(rng: &mut Rng) -> [u64; 6] {
    let scale = rng.range(1, 4);
    std::array::from_fn(|_| rng.below(scale))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Reference {
    Equal,
    Left,
    Right,
    Conflict,
}
fn reference_dominance(left: [u64; 6], right: [u64; 6]) -> Reference {
    let greater = left.iter().zip(right).filter(|(l, r)| **l > *r).count();
    let smaller = left.iter().zip(right).filter(|(l, r)| **l < *r).count();
    match (greater > 0, smaller > 0) {
        (false, false) => Reference::Equal,
        (true, false) => Reference::Left,
        (false, true) => Reference::Right,
        (true, true) => Reference::Conflict,
    }
}
fn same(actual: Dominance, expected: Reference) -> bool {
    matches!(
        (actual, expected),
        (Dominance::Equal, Reference::Equal)
            | (Dominance::Left, Reference::Left)
            | (Dominance::Right, Reference::Right)
            | (Dominance::Conflict, Reference::Conflict)
    )
}

#[test]
fn checked_arithmetic_and_pricing_laws_hold_for_seeded_inputs() {
    const SUITE: &str = "metrics-arithmetic";
    let config = config_from_env();
    for seed in &config.seeds {
        let mut rng = Rng::new(seed.value);
        let (mut overflows, mut priced) = (0u64, 0u64);
        for iteration in 0..config.iterations {
            let context = Context {
                suite: SUITE,
                seed,
                iteration,
            };
            let (a, b, c) = (wide(&mut rng), wide(&mut rng), wide(&mut rng));
            let expected = a.checked_add(b).ok_or(Error::Overflow);
            check!(
                context,
                checked_add(a, b) == expected,
                "checked_add matches the reference"
            );
            check!(
                context,
                checked_add(b, a) == expected,
                "checked_add commutes"
            );
            if expected.is_err() {
                overflows += 1;
            }
            if let (Ok(ab), Ok(bc)) = (checked_add(a, b), checked_add(b, c)) {
                if let (Ok(left), Ok(right)) = (checked_add(ab, c), checked_add(a, bc)) {
                    check!(
                        context,
                        left == right,
                        "checked_add associates when defined"
                    );
                }
            }
            let fold = a
                .checked_add(b)
                .and_then(|sum| sum.checked_add(c))
                .ok_or(Error::Overflow);
            check!(
                context,
                checked_sum([a, b, c]) == fold,
                "checked_sum equals the fold"
            );
            let limit = wide(&mut rng);
            let bounded = checked_add_bounded(a, b, limit);
            match a.checked_add(b) {
                None => check!(
                    context,
                    bounded == Err(Error::Overflow),
                    "bounded add overflow"
                ),
                Some(sum) if sum <= limit => {
                    check!(context, bounded == Ok(sum), "bounded add within limit")
                }
                Some(_) => check!(
                    context,
                    bounded == Err(Error::Limit),
                    "bounded add over limit"
                ),
            }
            check!(
                context,
                admit_decimal(a)
                    == if a <= MAX_DECIMAL {
                        Ok(a)
                    } else {
                        Err(Error::Limit)
                    },
                "admit_decimal is the exact bound"
            );
            let replaced = checked_replace(a, b, c);
            match a.checked_sub(b) {
                None => check!(
                    context,
                    replaced == Err(Error::Underflow),
                    "replace underflow"
                ),
                Some(rest) => check!(
                    context,
                    replaced == rest.checked_add(c).ok_or(Error::Overflow),
                    "replace equals subtract-then-add"
                ),
            }
            if b <= a {
                check!(
                    context,
                    checked_replace(a, b, b) == Ok(a),
                    "replacing with itself is identity"
                );
            }
            let denominator = wide(&mut rng);
            match ExactRatio::new(a, denominator) {
                Err(error) => {
                    check!(
                        context,
                        denominator == 0 && error == Error::ZeroDenominator,
                        "zero denominator refused"
                    )
                }
                Ok(ratio) => {
                    check!(
                        context,
                        ratio.numerator() == a && ratio.denominator() == denominator,
                        "ratio keeps its parts"
                    );
                    let floor = ratio.rounded(Rounding::Floor).unwrap();
                    let ceiling = ratio.rounded(Rounding::Ceiling);
                    let half = ratio.rounded(Rounding::HalfUp);
                    check!(context, floor == a / denominator, "floor is the quotient");
                    let exact = a % denominator == 0;
                    match ceiling {
                        Ok(ceiling) => {
                            check!(
                                context,
                                ceiling == floor + u128::from(!exact),
                                "ceiling is floor plus the remainder flag"
                            );
                            let half = half.unwrap();
                            check!(
                                context,
                                floor <= half && half <= ceiling,
                                "half-up sits between floor and ceiling"
                            );
                            let remainder = a % denominator;
                            let up = remainder != 0 && remainder >= denominator - remainder;
                            check!(
                                context,
                                half == floor + u128::from(up),
                                "half-up rounds at the midpoint"
                            );
                        }
                        Err(error) => check!(
                            context,
                            error == Error::Overflow && floor == u128::MAX && !exact,
                            "ceiling overflows only at the top"
                        ),
                    }
                }
            }
            let tokens: [u128; 5] = std::array::from_fn(|_| {
                if rng.chance(1, 3) {
                    0
                } else {
                    u128::from(rng.below(1 << 40))
                }
            });
            let rates: [Option<u128>; 5] = std::array::from_fn(|_| {
                if rng.chance(1, 6) {
                    None
                } else {
                    Some(u128::from(rng.below(1 << 40)))
                }
            });
            let mut pico = 0u128;
            let mut missing = false;
            for (count, rate) in tokens.iter().zip(rates) {
                if *count == 0 {
                    continue;
                }
                match rate {
                    None => missing = true,
                    Some(rate) => pico += count * rate,
                }
            }
            let priced_value = price_microusd(tokens, rates);
            if missing {
                check!(
                    context,
                    priced_value == Err(Error::MissingRate),
                    "a used bucket needs a rate"
                );
            } else {
                let expected = (pico + 500_000) / 1_000_000;
                check!(
                    context,
                    priced_value == admit_decimal(expected),
                    "price is the rounded exact sum"
                );
                priced += 1;
                let bucket = rng.below(5) as usize;
                if tokens[bucket] != 0 {
                    let mut more = tokens;
                    more[bucket] += 1;
                    let higher = price_microusd(more, rates).unwrap();
                    check!(
                        context,
                        higher >= priced_value.unwrap(),
                        "price is monotone in tokens"
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
                &[("overflow_cases", overflows), ("priced_cases", priced)]
            )
        );
    }
}

#[test]
fn wire_token_partition_laws_hold_for_seeded_counters() {
    const SUITE: &str = "metrics-tokens";
    let config = config_from_env();
    for seed in &config.seeds {
        let mut rng = Rng::new(seed.value);
        let (mut valid, mut limited, mut partition_errors) = (0u64, 0u64, 0u64);
        for iteration in 0..config.iterations {
            let context = Context {
                suite: SUITE,
                seed,
                iteration,
            };
            let mut counters: [u64; 6] = std::array::from_fn(|_| counter(&mut rng));
            if rng.chance(1, 2) {
                counters[5] = counters[5].min(counters[4]);
            }
            let expected = if counters.iter().any(|value| *value > MAX_WIRE_TOKEN_COUNTER) {
                Err(Error::Limit)
            } else if counters[5] > counters[4] {
                Err(Error::InvalidPartition)
            } else {
                Ok(counters[..5].iter().sum::<u64>())
            };
            let total = wire_token_total(counters);
            check!(
                context,
                total == expected,
                "wire total is the five-counter sum with bounds"
            );
            match total {
                Err(Error::Limit) => limited += 1,
                Err(_) => partition_errors += 1,
                Ok(total) => {
                    valid += 1;
                    let partition = TokenPartition::from_wire(counters, true).unwrap();
                    check!(
                        context,
                        partition.total() == Ok(u128::from(total)),
                        "partition total equals the wire total"
                    );
                    check!(
                        context,
                        partition.to_wire() == Ok(counters),
                        "wire round trip is lossless"
                    );
                    let detailed = partition.to_detailed().unwrap();
                    let expected_detailed = [
                        u128::from(counters[0]),
                        u128::from(counters[1]),
                        u128::from(counters[2]) + u128::from(counters[3]),
                        u128::from(counters[4] - counters[5]),
                        u128::from(counters[5]),
                    ];
                    check!(
                        context,
                        detailed == expected_detailed,
                        "detailed buckets split output and reasoning"
                    );
                    let back = TokenPartition::from_detailed(detailed).unwrap();
                    check!(
                        context,
                        back.total() == Ok(u128::from(total)),
                        "detailed round trip keeps the total"
                    );
                    check!(
                        context,
                        back.to_wire() == Err(Error::MissingCacheTtl),
                        "detailed evidence never invents a cache TTL"
                    );
                    let unknown_reasoning = TokenPartition::from_wire(counters, false);
                    if counters[5] == 0 {
                        check!(
                            context,
                            unknown_reasoning.unwrap().to_wire() == Err(Error::MissingReasoning),
                            "unknown reasoning is not zero reasoning"
                        );
                    } else {
                        check!(
                            context,
                            unknown_reasoning == Err(Error::InvalidPartition),
                            "nonzero reasoning cannot be erased"
                        );
                    }
                    let mut all_reasoning = counters;
                    all_reasoning[5] = counters[4];
                    check!(
                        context,
                        wire_token_total(all_reasoning) == Ok(total),
                        "reasoning is never added twice"
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
                    ("valid_cases", valid),
                    ("limit_cases", limited),
                    ("partition_error_cases", partition_errors)
                ]
            )
        );
    }
}

#[test]
fn dominance_and_owner_merge_laws_hold_for_seeded_vectors() {
    const SUITE: &str = "metrics-dominance";
    let config = config_from_env();
    let owners: [[u8; 16]; 4] = [[0; 16], [1; 16], [2; 16], [3; 16]];
    for seed in &config.seeds {
        let mut rng = Rng::new(seed.value);
        let (mut conflicts, mut chains) = (0u64, 0u64);
        for iteration in 0..config.iterations {
            let context = Context {
                suite: SUITE,
                seed,
                iteration,
            };
            let (a, b, c) = (vector(&mut rng), vector(&mut rng), vector(&mut rng));
            let ab = component_dominance(a, b);
            check!(
                context,
                same(ab, reference_dominance(a, b)),
                "dominance matches the componentwise reference"
            );
            check!(
                context,
                component_dominance(a, a) == Dominance::Equal,
                "dominance is reflexive"
            );
            let ba = component_dominance(b, a);
            let mirrored = match ab {
                Dominance::Left => Dominance::Right,
                Dominance::Right => Dominance::Left,
                other => other,
            };
            check!(
                context,
                ba == mirrored,
                "swapping operands mirrors the verdict"
            );
            if ab == Dominance::Conflict {
                conflicts += 1;
            }
            let bc = component_dominance(b, c);
            if matches!(ab, Dominance::Right | Dominance::Equal)
                && matches!(bc, Dominance::Right | Dominance::Equal)
            {
                chains += 1;
                check!(
                    context,
                    matches!(
                        component_dominance(a, c),
                        Dominance::Right | Dominance::Equal
                    ),
                    "non-decreasing chains stay non-decreasing"
                );
            }
            let (left, right) = (*rng.pick(&owners), *rng.pick(&owners));
            check!(
                context,
                merge_owner(left, left, false) == Ok(left),
                "an owner merges with itself"
            );
            let strict = merge_owner(left, right, false);
            check!(
                context,
                strict
                    == if left == right {
                        Ok(left)
                    } else {
                        Err(Error::OwnerConflict)
                    },
                "strict merge needs equality"
            );
            let expected = if left == right {
                Ok(left)
            } else if left == [0; 16] {
                Ok(right)
            } else if right == [0; 16] {
                Ok(left)
            } else {
                Err(Error::OwnerConflict)
            };
            check!(
                context,
                merge_owner(left, right, true) == expected,
                "enrichment fills only unknown owners"
            );
            check!(
                context,
                merge_owner(right, left, true) == expected,
                "enrichment is symmetric"
            );
        }
        println!(
            "{}",
            receipt_line(
                SUITE,
                seed,
                config.iterations,
                &[("conflict_cases", conflicts), ("chain_cases", chains)]
            )
        );
    }
}
