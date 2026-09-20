//! Terminal enrollment codec, once-only HTTPS exchange and the single
//! activation seam. The `enroll` driver wires the sealed attempt, custody and
//! transport pieces to the terminal; it never uploads itself. The narrow
//! `enrolled` read resolves the same completed, custody-verified join for the
//! upload command without rerunning the handshake; a returned observation is
//! not permission to upload.
#![allow(dead_code)]

mod attempt;
pub(super) mod contract;
mod diagnostic;
mod https;

pub(crate) use diagnostic::AccountDiagnostic;

use std::path::Path;

/// Terminal I/O the driver needs without owning a console. The caller supplies
/// a wall clock, the one-time pairing handoff, paced waits and status lines so
/// the credential state machine never prints, sleeps or reads time itself.
pub(crate) trait EnrollIo {
    /// Current wall-clock milliseconds, the only time source for the driver.
    fn now_ms(&mut self) -> u64;
    /// Present the one-time pairing URL exactly once for the browser decision.
    fn pairing_url(&mut self, url: &str);
    /// Pace the gap between browser-approval polls.
    fn wait_ms(&mut self, ms: u64);
    /// Report one completed handshake step by its fixed name.
    fn step(&mut self, name: &'static str);
}

/// Nonsecret facts produced once the namespace is custody-verified. No secret,
/// pairing preimage, wire body or custody reference is carried here.
pub(crate) struct EnrollOutcome {
    pub(crate) account_id: [u8; 16],
    pub(crate) device_id: [u8; 32],
    pub(crate) namespace_item_id: [u8; 32],
}

/// Enroll this installation under the anchor at `dir`. Resolves or creates the
/// retained pairing secret, then drives the once-only handshake to a
/// custody-verified namespace. Only fixed error codes are returned; refusal
/// leaves durable recovery state and never remints or retries implicitly.
#[cfg(target_os = "macos")]
pub(crate) fn enroll(dir: &Path, io: &mut dyn EnrollIo) -> Result<EnrollOutcome, &'static str> {
    attempt::drive::enroll(dir, io).map_err(|error| error.code())
}

/// Non-macOS platforms have no qualified credential custody; enrollment stays
/// refused rather than minting into unqualified storage.
#[cfg(not(target_os = "macos"))]
pub(crate) fn enroll(_dir: &Path, _io: &mut dyn EnrollIo) -> Result<EnrollOutcome, &'static str> {
    Err("enroll_requires_qualified_macos_custody")
}

/// Completed-enrollment sender binding facts plus the exact retained pairing
/// and namespace custody records. Secret preimages stay borrow-only inside
/// the records; this join is not an upload grant, transcript or proof of
/// server-side state.
#[cfg(target_os = "macos")]
pub(crate) struct EnrolledInstallation {
    pub(crate) account_id: [u8; 16],
    pub(crate) device_id: [u8; 32],
    pub(crate) recovery_generation: [u8; 32],
    pub(crate) pairing: aicharts_custody::SecretRecord,
    pub(crate) namespace: aicharts_custody::SecretRecord,
}

/// Read only a completed, custody-verified enrollment at `dir` and resolve the
/// exact retained pairing and namespace records by their pinned identities and
/// commitments. Missing, unfinished, revoked or inconsistent anchors refuse
/// closed; nothing is reminted, repaired or substituted.
#[cfg(target_os = "macos")]
pub(crate) fn enrolled(dir: &Path) -> Result<EnrolledInstallation, &'static str> {
    attempt::drive::enrolled(dir).map_err(|error| error.code())
}

/// Same enrolled join, one time. Discard all successful authority-bearing
/// values; diagnostic output is never a substitute for an enrolled authority.
pub(crate) fn diagnose_account(dir: &Path) -> AccountDiagnostic {
    #[cfg(target_os = "macos")]
    {
        match attempt::drive::enrolled_observed(dir) {
            Ok(_) => AccountDiagnostic::qualified(),
            Err(failure) => failure.diagnostic,
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = dir;
        AccountDiagnostic::unsupported()
    }
}
