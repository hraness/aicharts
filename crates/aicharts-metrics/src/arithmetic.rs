use crate::{Error, MAX_DECIMAL};

/// Full-width arithmetic; profile limits are a separate admission decision.
pub const fn checked_add(left: u128, right: u128) -> Result<u128, Error> {
    match left.checked_add(right) {
        Some(value) => Ok(value),
        None => Err(Error::Overflow),
    }
}

pub const fn admit_decimal(value: u128) -> Result<u128, Error> {
    if value <= MAX_DECIMAL {
        Ok(value)
    } else {
        Err(Error::Limit)
    }
}

pub const fn checked_add_bounded(left: u128, right: u128, limit: u128) -> Result<u128, Error> {
    match checked_add(left, right) {
        Ok(value) if value <= limit => Ok(value),
        Ok(_) => Err(Error::Limit),
        Err(error) => Err(error),
    }
}

pub fn checked_sum<const N: usize>(values: [u128; N]) -> Result<u128, Error> {
    let mut sum = 0;
    for value in values {
        sum = checked_add(sum, value)?;
    }
    Ok(sum)
}

/// Replace an exactly identified prior contribution. Membership and ownership
/// of that prior contribution must be established by the caller. No partial
/// state is returned when subtraction or addition fails.
pub const fn checked_replace(
    total: u128,
    previous: u128,
    replacement: u128,
) -> Result<u128, Error> {
    match total.checked_sub(previous) {
        Some(remainder) => checked_add(remainder, replacement),
        None => Err(Error::Underflow),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Rounding {
    Floor,
    Ceiling,
    HalfUp,
}

/// An exact rational. It is deliberately not normalized: reduction is not
/// required for equality of a displayed quotient, and no float enters storage.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ExactRatio {
    numerator: u128,
    denominator: u128,
}

impl ExactRatio {
    pub const fn new(numerator: u128, denominator: u128) -> Result<Self, Error> {
        if denominator == 0 {
            Err(Error::ZeroDenominator)
        } else {
            Ok(Self {
                numerator,
                denominator,
            })
        }
    }

    pub const fn numerator(self) -> u128 {
        self.numerator
    }

    pub const fn denominator(self) -> u128 {
        self.denominator
    }

    pub fn rounded(self, rule: Rounding) -> Result<u128, Error> {
        let quotient = self.numerator / self.denominator;
        let remainder = self.numerator % self.denominator;
        let increment = match rule {
            Rounding::Floor => false,
            Rounding::Ceiling => remainder != 0,
            // ceil(d/2) is representable even when d == u128::MAX.
            Rounding::HalfUp => remainder >= self.denominator / 2 + self.denominator % 2,
        };
        checked_add(quotient, u128::from(increment))
    }
}

/// Exact per-record retail estimate, preserving the current projection's edge
/// semantics. Rates are pico-USD/token. Used buckets need a rate; unused buckets
/// do not. All products, the sum, and the half-up offset must fit u128. Round
/// once per record and then enforce the detailed-stats decimal bound.
pub fn price_microusd(tokens: [u128; 5], rates: [Option<u128>; 5]) -> Result<u128, Error> {
    let mut pico = 0u128;
    let mut index = 0;
    while index < 5 {
        let token_count = tokens[index];
        if token_count != 0 {
            let rate = rates[index].ok_or(Error::MissingRate)?;
            let amount = token_count.checked_mul(rate).ok_or(Error::Overflow)?;
            pico = checked_add(pico, amount)?;
        }
        index += 1;
    }
    let rounded = checked_add(pico, 500_000)? / 1_000_000;
    admit_decimal(rounded)
}
