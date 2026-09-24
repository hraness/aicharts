//! Exact, I/O-free arithmetic and evidence predicates for usage measurements.
//!
//! These functions do not authenticate a source, identify a population, or prove
//! that observations are complete. Callers establish those facts before folding
//! quantities. In particular, an occurrence merge is a partial operation, not an
//! associative componentwise maximum.

#![forbid(unsafe_code)]

mod arithmetic;
mod decimal;
mod evidence;
mod revision;
mod tokens;

pub use arithmetic::*;
pub use decimal::*;
pub use evidence::*;
pub use revision::*;
pub use tokens::*;

/// Largest canonical decimal admitted by the existing detailed-stats profile.
pub const MAX_DECIMAL: u128 = 999_999_999_999_999_999_999_999;
/// Existing v1 wire limit, independently applied to all six scalar counters.
pub const MAX_WIRE_TOKEN_COUNTER: u64 = 1_000_000_000_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Error {
    Overflow,
    Underflow,
    Limit,
    InvalidPartition,
    MissingReasoning,
    MissingCacheTtl,
    MissingRate,
    ZeroDenominator,
    OwnerConflict,
    PopulationMismatch,
    MissingEvidence,
}

#[cfg(test)]
mod decimal_tests;
#[cfg(test)]
mod tests;

#[cfg(kani)]
mod proofs;
