//! Dormant nonsecret attempt observations and private persistence primitives.
//! Custody handoff functions validate typed secret records and persist only
//! nonsecret progress. The CLI still has no caller or production constructor;
//! decoding facts does not authenticate their history.

mod coordinator;
mod record;
mod sequencer;
mod session;
mod storage;

#[cfg(target_os = "macos")]
mod disk;
#[cfg(target_os = "macos")]
pub(super) mod drive;
#[cfg(target_os = "macos")]
mod macos;

#[cfg(test)]
#[path = "attempt/coordinator_tests.rs"]
mod coordinator_tests;
#[cfg(all(test, target_os = "macos"))]
#[path = "attempt/disk_tests.rs"]
mod disk_tests;
#[cfg(all(test, target_os = "macos"))]
#[path = "attempt/drive_tests.rs"]
mod drive_tests;
#[cfg(test)]
#[path = "attempt/record_tests.rs"]
mod record_tests;
#[cfg(test)]
#[path = "attempt/session_tests.rs"]
mod session_tests;
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
pub(super) enum Error {
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
    Custody,
}

impl Error {
    pub(super) const fn code(self) -> &'static str {
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
            Self::Custody => "attempt_custody",
        }
    }
}
