use super::*;

#[test]
fn canonical_integers_refuse_signs_separators_leading_zeros_and_overflow() {
    assert_eq!(canonical_integer("0"), Ok(0));
    assert_eq!(canonical_integer("10000000"), Ok(10_000_000));
    assert_eq!(
        canonical_integer("340282366920938463463374607431768211455"),
        Ok(u128::MAX)
    );
    assert_eq!(
        canonical_integer("340282366920938463463374607431768211456"),
        Err(DecimalError::Arithmetic(Error::Overflow))
    );
    for malformed in [
        "",
        "00",
        "007",
        "-1",
        "+1",
        "1e6",
        "1_000",
        " 1",
        "1 ",
        "1.0",
        "٣",
        "1000000000000000000000000000000000000000",
    ] {
        assert_eq!(
            canonical_integer(malformed),
            Err(DecimalError::Malformed),
            "{malformed:?}"
        );
    }
}

#[test]
fn scaled_decimals_round_once_from_the_literal_digits() {
    let micro = |text: &str| scaled_decimal(text, 6, Rounding::HalfUp);
    assert_eq!(micro("0"), Ok(0));
    assert_eq!(micro("0.123456"), Ok(123_456));
    assert_eq!(micro("0.25"), Ok(250_000));
    assert_eq!(micro("0.0000035"), Ok(4));
    assert_eq!(micro("0.0000034999999"), Ok(3));
    assert_eq!(micro("0.0001245"), Ok(125));
    assert_eq!(micro("9007199253.99998"), Ok(9_007_199_253_999_980));
    assert_eq!(micro("9007199254"), Ok(9_007_199_254_000_000));
    assert_eq!(scaled_decimal("0.0000035", 6, Rounding::Floor), Ok(3));
    assert_eq!(
        scaled_decimal("0.0000030000000000001", 6, Rounding::Ceiling),
        Ok(4)
    );
    assert_eq!(
        scaled_decimal("0.0000030000000000000", 6, Rounding::Ceiling),
        Ok(3)
    );
    assert_eq!(scaled_decimal("7.5", 0, Rounding::HalfUp), Ok(8));
    assert_eq!(
        scaled_decimal(
            "7.4999999999999999999999999999999999999999",
            0,
            Rounding::HalfUp
        ),
        Ok(7)
    );
    assert_eq!(
        scaled_decimal(
            "340282366920938463463374607431768211455",
            0,
            Rounding::HalfUp
        ),
        Ok(u128::MAX)
    );
    assert_eq!(
        scaled_decimal(
            "340282366920938463463374607431768211455.5",
            0,
            Rounding::HalfUp
        ),
        Err(DecimalError::Arithmetic(Error::Overflow))
    );
    assert_eq!(
        scaled_decimal("34028236692093846346337460743176821146", 1, Rounding::Floor),
        Err(DecimalError::Arithmetic(Error::Overflow))
    );
    assert_eq!(
        scaled_decimal("1", 39, Rounding::Floor),
        Err(DecimalError::Arithmetic(Error::Limit))
    );
    for malformed in [
        "", ".", "1.", ".5", "1..5", "1.5.0", "-0", "-0.5", "1e-6", "01.5", "1.5 ", "1.٣",
    ] {
        assert_eq!(
            micro(malformed),
            Err(DecimalError::Malformed),
            "{malformed:?}"
        );
    }
}

#[test]
fn scaled_decimals_agree_with_exact_ratio_rounding_on_small_literals() {
    for numerator in 0u64..2_000 {
        for scale in 0u32..4 {
            let text = format!("{}.{:03}", numerator / 1_000, numerator % 1_000);
            for rule in [Rounding::Floor, Rounding::Ceiling, Rounding::HalfUp] {
                let expected = ExactRatio::new(u128::from(numerator) * 10u128.pow(scale), 1_000)
                    .unwrap()
                    .rounded(rule)
                    .unwrap();
                assert_eq!(
                    scaled_decimal(&text, scale, rule),
                    Ok(expected),
                    "{text} {scale} {rule:?}"
                );
            }
        }
    }
}
