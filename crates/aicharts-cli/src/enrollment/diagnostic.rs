//! Fixed observations from the existing enrolled read. No identifiers, paths,
//! native messages or secret-bearing records can enter this projection.
use super::attempt::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Stage {
    AttemptSnapshot,
    AttemptReopen,
    ReferencesOpen,
    CustodyConstruct,
    AttemptDurability,
    Binding,
    PairingRead,
    PairingCommitment,
    NamespaceRead,
    NamespaceCommitment,
    Complete,
    Platform,
}

impl Stage {
    fn code(self) -> &'static str {
        match self {
            Self::AttemptSnapshot => "attempt_snapshot",
            Self::AttemptReopen => "attempt_reopen",
            Self::ReferencesOpen => "references_open",
            Self::CustodyConstruct => "custody_construct",
            Self::AttemptDurability => "attempt_durability",
            Self::Binding => "binding",
            Self::PairingRead => "pairing_read",
            Self::PairingCommitment => "pairing_commitment",
            Self::NamespaceRead => "namespace_read",
            Self::NamespaceCommitment => "namespace_commitment",
            Self::Complete => "complete",
            Self::Platform => "platform",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Reason {
    Attempt(Error),
    References(aicharts_custody::references::Error),
    Custody(aicharts_custody::Error),
    CommitmentMismatch,
    Verified,
    UnsupportedPlatform,
}

/// Only constructors tied to the actual read can create a successful result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AccountDiagnostic {
    stage: Stage,
    reason: Reason,
}

impl AccountDiagnostic {
    pub(super) fn qualified() -> Self {
        Self {
            stage: Stage::Complete,
            reason: Reason::Verified,
        }
    }

    #[cfg(not(target_os = "macos"))]
    pub(super) fn unsupported() -> Self {
        Self {
            stage: Stage::Platform,
            reason: Reason::UnsupportedPlatform,
        }
    }

    pub(crate) fn is_qualified(self) -> bool {
        self.reason == Reason::Verified
    }
    pub(crate) fn stage(self) -> &'static str {
        self.stage.code()
    }
    pub(crate) fn reason(self) -> &'static str {
        match self.reason {
            Reason::Attempt(error) => error.code(),
            Reason::References(error) => error.code(),
            Reason::Custody(error) => error.code(),
            Reason::CommitmentMismatch => "commitment_mismatch",
            Reason::Verified => "verified",
            Reason::UnsupportedPlatform => "persistent_state_requires_qualified_macos_custody",
        }
    }

    pub(crate) fn guidance(self) -> &'static str {
        use aicharts_custody::Error as C;
        match self.reason {
            Reason::Verified => "Both retained credentials match this enrollment. Server access and unattended execution have not been checked by this result.",
            Reason::Custody(C::InteractionRequired) | Reason::References(aicharts_custody::references::Error::Custody(C::InteractionRequired)) =>
                "macOS needs you to approve AI Charts' saved keys again, usually after an update. Your keys are not missing. Run this same command once with AICHARTS_CUSTODY_INTERACTION=allow in front of it, enter your Mac password if asked and choose Always Allow. Then run it again without that setting to check that background runs can read the keys.",
            Reason::Custody(C::AccessDenied) | Reason::References(aicharts_custody::references::Error::Custody(C::AccessDenied)) =>
                "macOS denied access or the operator cancelled. Verify the signed executable and review native access consent before another approved attempt. This refusal does not mean credentials are missing.",
            Reason::Custody(C::Unavailable | C::Busy) | Reason::References(aicharts_custody::references::Error::Custody(C::Unavailable | C::Busy)) =>
                "Credential access is unavailable or busy. Check the macOS login session and Keychain availability, then repeat this diagnostic. No conclusion about missing or changed credentials can be drawn.",
            Reason::UnsupportedPlatform => "This platform has no qualified persistent credential custody. Use the existing qualified macOS installation; do not recreate its enrollment here.",
            Reason::Attempt(Error::Busy | Error::StorageUnavailable) | Reason::References(aicharts_custody::references::Error::Busy | aicharts_custody::references::Error::StorageUnavailable) =>
                "Local enrollment state is busy or unavailable. Preserve it, resolve access or concurrent use, then repeat this diagnostic. This result does not establish lost or corrupt state.",
            _ => "Preserve the enrollment, ledger, checkpoint key and retained credentials. Stop publication and investigate this fixed stage and reason; do not reset, reenroll or replace secrets to bypass the refusal.",
        }
    }
}

/// Normal callers retain their exact legacy error. The opt-in caller receives
/// the additional fixed classification from the same failing operation.
pub(super) struct Failure {
    pub(super) error: Error,
    pub(super) diagnostic: AccountDiagnostic,
}

impl Failure {
    pub(super) fn attempt(stage: Stage, error: Error) -> Self {
        Self {
            error,
            diagnostic: AccountDiagnostic {
                stage,
                reason: Reason::Attempt(error),
            },
        }
    }
    pub(super) fn references(
        stage: Stage,
        cause: aicharts_custody::references::Error,
        error: Error,
    ) -> Self {
        Self {
            error,
            diagnostic: AccountDiagnostic {
                stage,
                reason: Reason::References(cause),
            },
        }
    }
    pub(super) fn custody(stage: Stage, cause: aicharts_custody::Error, error: Error) -> Self {
        Self {
            error,
            diagnostic: AccountDiagnostic {
                stage,
                reason: Reason::Custody(cause),
            },
        }
    }
    pub(super) fn commitment(stage: Stage) -> Self {
        Self {
            error: Error::Custody,
            diagnostic: AccountDiagnostic {
                stage,
                reason: Reason::CommitmentMismatch,
            },
        }
    }
}
