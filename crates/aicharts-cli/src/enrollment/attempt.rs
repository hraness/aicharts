//! Dormant nonsecret attempt observations and private persistence primitives.
//! There is no production store constructor, network dispatch, reference/vault
//! effect or authority here. Decoding facts does not authenticate their history.

mod record;
mod storage;

#[cfg(test)]
#[path = "attempt/record_tests.rs"]
mod record_tests;
#[cfg(test)]
#[path = "attempt/storage_tests.rs"]
mod storage_tests;

const MAX_RECORD_BYTES: usize = 4_096;
const MAX_REVISION: u64 = 1_024;
const MAX_FLIGHTS: u16 = 128;
const MAX_DISPATCHES: u8 = 3;

type Result<T> = std::result::Result<T, Error>;

/// Fixed local failures contain no record, identifier, path or native message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Error {
    InvalidRecord,
    InvalidSuccessor,
    ClockRegressed,
    Limit,
    Missing,
    Conflict,
    StaleSnapshot,
    Busy,
    StorageUnavailable,
    RecoveryRequired,
    OutcomeUnknown,
}

impl Error {
    const fn code(self) -> &'static str {
        match self {
            Self::InvalidRecord => "attempt_invalid_record",
            Self::InvalidSuccessor => "attempt_invalid_successor",
            Self::ClockRegressed => "attempt_clock_regressed",
            Self::Limit => "attempt_limit",
            Self::Missing => "attempt_missing",
            Self::Conflict => "attempt_conflict",
            Self::StaleSnapshot => "attempt_stale_snapshot",
            Self::Busy => "attempt_busy",
            Self::StorageUnavailable => "attempt_storage_unavailable",
            Self::RecoveryRequired => "attempt_recovery_required",
            Self::OutcomeUnknown => "attempt_outcome_unknown",
        }
    }
}
