use crate::{checked_add, Error, Rounding};

/// Refusal of a decimal literal. Malformed text never reaches arithmetic and
/// is never read as an absent or zero quantity.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DecimalError {
    Malformed,
    Arithmetic(Error),
}

impl From<Error> for DecimalError {
    fn from(error: Error) -> Self {
        Self::Arithmetic(error)
    }
}

/// `u128::MAX` has 39 digits; longer canonical literals cannot fit.
pub const MAX_INTEGER_DIGITS: usize = 39;
/// `10^38` is the largest power of ten below `u128::MAX`.
pub const MAX_DECIMAL_SCALE: u32 = 38;

/// Parse an unsigned ASCII integer literal without sign, separators, exponent
/// or leading zeros. `"0"` is canonical; `"00"`, `""` and `"1e3"` are not.
pub fn canonical_integer(text: &str) -> Result<u128, DecimalError> {
    let bytes = text.as_bytes();
    if bytes.is_empty()
        || bytes.len() > MAX_INTEGER_DIGITS
        || !bytes.iter().all(u8::is_ascii_digit)
        || (bytes.len() > 1 && bytes[0] == b'0')
    {
        return Err(DecimalError::Malformed);
    }
    let mut value = 0u128;
    for digit in bytes {
        value = value
            .checked_mul(10)
            .and_then(|value| value.checked_add(u128::from(digit - b'0')))
            .ok_or(Error::Overflow)?;
    }
    Ok(value)
}

/// Exact `text × 10^scale`, rounded once by `rule`. `text` is a canonical
/// unsigned literal: an integer, or an integer, one point and at least one
/// fraction digit. Fraction digits beyond `scale` decide the rounding
/// lexically, so a long literal cannot overflow before it is rounded.
pub fn scaled_decimal(text: &str, scale: u32, rule: Rounding) -> Result<u128, DecimalError> {
    if scale > MAX_DECIMAL_SCALE {
        return Err(DecimalError::Arithmetic(Error::Limit));
    }
    let (integer, fraction) = match text.split_once('.') {
        Some((_, "")) => return Err(DecimalError::Malformed),
        Some(parts) => parts,
        None => (text, ""),
    };
    if !fraction.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(DecimalError::Malformed);
    }
    let integer = canonical_integer(integer)?;
    let (kept, dropped) = fraction.split_at(fraction.len().min(scale as usize));
    // At most `scale` <= 38 kept digits: below 10^38, so this cannot overflow.
    let mut fraction_value = 0u128;
    for digit in kept.bytes() {
        fraction_value = fraction_value * 10 + u128::from(digit - b'0');
    }
    for _ in kept.len()..scale as usize {
        fraction_value *= 10;
    }
    let increment = match rule {
        Rounding::Floor => false,
        Rounding::Ceiling => dropped.bytes().any(|byte| byte != b'0'),
        Rounding::HalfUp => dropped.bytes().next().is_some_and(|byte| byte >= b'5'),
    };
    let power = 10u128.pow(scale);
    let scaled = integer.checked_mul(power).ok_or(Error::Overflow)?;
    let total = checked_add(checked_add(scaled, fraction_value)?, u128::from(increment))?;
    Ok(total)
}
