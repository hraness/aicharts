//! Sequencing tests for the terminal enrollment driver. A scripted
//! [`AttemptOps`] supplies durable progress and settled responses, so the
//! once-only operation order, the browser poll/confirm handshake, resume from
//! every durable state and the closed refusals are covered without macOS
//! custody or a real transport. `mint` is exercised for genesis validity and
//! commitment binding; `MacOps`/`enroll` remain the live integration seam.

use super::drive::{self, AttemptOps, MAX_PAIRING_POLLS};
use super::record::{self, Progress};
use super::Error;
use crate::enrollment::contract::{
    self, AccountId, DeviceState, DomainError, DomainResult, Enrollment, Id, Namespace, Operation,
    PairingState, PairingView, Receipt, Reservation, Secret32, Success,
};
use crate::enrollment::{EnrollIo, EnrollOutcome};
use std::collections::VecDeque;

const NOW: u64 = 1_700_000_000_000;

fn id(byte: u8) -> Id {
    [byte; 32]
}
fn account(byte: u8) -> AccountId {
    [byte; 16]
}
fn reservation() -> Reservation {
    Reservation {
        intent_id: id(0x11),
        account_id: account(0x22),
        reservation_id: id(0x33),
        poll_commitment: id(0x44),
        upload_commitment: id(0x55),
        recovery_generation: id(0x66),
        reserved_at_ms: NOW,
        expires_at_ms: NOW + 60_000,
    }
}
fn receipt() -> Receipt {
    Receipt {
        account_id: account(0x22),
        intent_id: id(0x11),
        reservation_id: id(0x33),
        device_id: id(0x77),
        enrolled_at_ms: NOW,
    }
}
fn enrollment() -> Enrollment {
    Enrollment {
        receipt: receipt(),
        device_state: DeviceState::Active,
    }
}
fn pairing(state: PairingState, approved: Option<AccountId>) -> DomainResult {
    Ok(Success::Pairing(PairingView {
        state,
        expires_at_ms: NOW + 300_000,
        poll_after_ms: 2_000,
        approved_account_id: approved,
    }))
}

struct FakeIo {
    now: u64,
    urls: Vec<String>,
    waits: Vec<u64>,
    steps: Vec<&'static str>,
}
impl FakeIo {
    fn new() -> Self {
        Self {
            now: NOW,
            urls: Vec::new(),
            waits: Vec::new(),
            steps: Vec::new(),
        }
    }
}
impl EnrollIo for FakeIo {
    fn now_ms(&mut self) -> u64 {
        self.now
    }
    fn pairing_url(&mut self, url: &str) {
        self.urls.push(url.to_string());
    }
    fn wait_ms(&mut self, ms: u64) {
        self.waits.push(ms);
        self.now += ms;
    }
    fn step(&mut self, name: &'static str) {
        self.steps.push(name);
    }
}

/// One scripted exchange: the operation the driver must dispatch, the settled
/// response, and the durable progress that response commits.
type Step = (Operation, DomainResult, Progress);

struct ScriptedOps {
    script: VecDeque<Step>,
    progress: Progress,
    chosen: Option<AccountId>,
    intent: Id,
    exchanges: Vec<Operation>,
    chosen_calls: Vec<AccountId>,
    reconciles: u32,
}
impl ScriptedOps {
    fn new(progress: Progress, script: Vec<Step>) -> Self {
        Self {
            script: script.into(),
            progress,
            chosen: None,
            intent: id(0x11),
            exchanges: Vec::new(),
            chosen_calls: Vec::new(),
            reconciles: 0,
        }
    }
}
impl AttemptOps for ScriptedOps {
    fn progress(&mut self) -> super::Result<Progress> {
        Ok(self.progress)
    }
    fn intent_id(&mut self) -> super::Result<Id> {
        Ok(self.intent)
    }
    fn chosen_account(&mut self) -> super::Result<Option<AccountId>> {
        Ok(self.chosen)
    }
    fn exchange(
        &mut self,
        operation: Operation,
        _account_id: Option<AccountId>,
        _io: &mut dyn EnrollIo,
    ) -> super::Result<DomainResult> {
        self.exchanges.push(operation);
        let (expected, response, after) = self
            .script
            .pop_front()
            .unwrap_or_else(|| panic!("unexpected exchange {operation:?}"));
        assert_eq!(expected, operation, "operation order");
        self.progress = after;
        Ok(response)
    }
    fn choose(&mut self, account_id: AccountId, _now_ms: u64) -> super::Result<()> {
        self.chosen_calls.push(account_id);
        self.chosen = Some(account_id);
        Ok(())
    }
    fn reconcile_pairing(&mut self) -> super::Result<()> {
        self.reconciles += 1;
        self.progress = Progress::PairingCustodyVerified;
        Ok(())
    }
    fn outcome(&mut self) -> super::Result<EnrollOutcome> {
        Ok(EnrollOutcome {
            account_id: account(0x22),
            device_id: id(0x77),
            namespace_item_id: id(0x88),
        })
    }
}

fn full_script(approved: DomainResult) -> Vec<Step> {
    vec![
        (
            Operation::Initialize,
            Ok(Success::Initialized {
                expires_at_ms: NOW + 600_000,
            }),
            Progress::Initialized,
        ),
        (Operation::Poll, approved, Progress::Initialized),
        (
            Operation::Confirm,
            pairing(PairingState::TerminalConfirmed, Some(account(0x22))),
            Progress::Confirmed,
        ),
        (
            Operation::Reserve,
            Ok(Success::Reserved(reservation())),
            Progress::Reserved,
        ),
        (
            Operation::Enroll,
            Ok(Success::Enrolled {
                reservation: reservation(),
                enrollment: enrollment(),
            }),
            Progress::Enrolled,
        ),
        (
            Operation::Namespace,
            Ok(Success::Namespace {
                reservation: reservation(),
                namespace: Namespace {
                    namespace_key: Secret32::from_bytes(id(0x99)).unwrap(),
                    receipt: receipt(),
                },
            }),
            Progress::NamespaceCustodyVerified,
        ),
    ]
}

#[test]
fn drive_completes_full_handshake_in_order() {
    let mut ops = ScriptedOps::new(
        Progress::PairingCustodyVerified,
        full_script(pairing(PairingState::BrowserApproved, Some(account(0x22)))),
    );
    let mut io = FakeIo::new();
    let outcome = drive::drive(&mut ops, &mut io).expect("enrolled");
    assert_eq!(outcome.account_id, account(0x22));
    assert_eq!(outcome.namespace_item_id, id(0x88));
    assert_eq!(
        ops.exchanges,
        vec![
            Operation::Initialize,
            Operation::Poll,
            Operation::Confirm,
            Operation::Reserve,
            Operation::Enroll,
            Operation::Namespace,
        ]
    );
    assert_eq!(ops.chosen_calls, vec![account(0x22)]);
    assert_eq!(io.urls.len(), 1, "pairing URL presented exactly once");
    assert_eq!(
        io.steps,
        vec![
            "initialized",
            "confirmed",
            "reserved",
            "enrolled",
            "namespace"
        ]
    );
    assert!(ops.script.is_empty());
}

#[test]
fn drive_polls_until_browser_approves() {
    let mut script = vec![
        (
            Operation::Initialize,
            Ok(Success::Initialized {
                expires_at_ms: NOW + 600_000,
            }),
            Progress::Initialized,
        ),
        (
            Operation::Poll,
            pairing(PairingState::Pending, None),
            Progress::Initialized,
        ),
        (
            Operation::Poll,
            pairing(PairingState::Pending, None),
            Progress::Initialized,
        ),
        (
            Operation::Poll,
            pairing(PairingState::BrowserApproved, Some(account(0x22))),
            Progress::Initialized,
        ),
        (
            Operation::Confirm,
            pairing(PairingState::TerminalConfirmed, Some(account(0x22))),
            Progress::Confirmed,
        ),
        (
            Operation::Reserve,
            Ok(Success::Reserved(reservation())),
            Progress::Reserved,
        ),
        (
            Operation::Enroll,
            Ok(Success::Enrolled {
                reservation: reservation(),
                enrollment: enrollment(),
            }),
            Progress::Enrolled,
        ),
        (
            Operation::Namespace,
            Ok(Success::Namespace {
                reservation: reservation(),
                namespace: Namespace {
                    namespace_key: Secret32::from_bytes(id(0x99)).unwrap(),
                    receipt: receipt(),
                },
            }),
            Progress::NamespaceCustodyVerified,
        ),
    ];
    let mut ops = ScriptedOps::new(
        Progress::PairingCustodyVerified,
        std::mem::take(&mut script),
    );
    let mut io = FakeIo::new();
    drive::drive(&mut ops, &mut io).expect("enrolled");
    assert_eq!(
        ops.exchanges
            .iter()
            .filter(|op| **op == Operation::Poll)
            .count(),
        3
    );
    assert_eq!(
        io.waits,
        vec![2_000, 2_000],
        "paced by server poll_after_ms"
    );
}

#[test]
fn drive_refuses_denied_and_expired_pairing() {
    for state in [PairingState::Denied, PairingState::Expired] {
        let mut ops = ScriptedOps::new(
            Progress::Initialized,
            vec![(Operation::Poll, pairing(state, None), Progress::Initialized)],
        );
        let mut io = FakeIo::new();
        assert_eq!(
            drive::drive(&mut ops, &mut io).err(),
            Some(Error::Conflict),
            "state {state:?}"
        );
    }
}

#[test]
fn drive_refuses_states_requiring_recovery() {
    for progress in [
        Progress::PairingPlanned,
        Progress::NamespacePlanned,
        Progress::NamespacePrepared,
    ] {
        let mut ops = ScriptedOps::new(progress, Vec::new());
        let mut io = FakeIo::new();
        assert_eq!(
            drive::drive(&mut ops, &mut io).err(),
            Some(Error::RecoveryRequired),
            "progress {progress:?}"
        );
    }
}

#[test]
fn drive_reconciles_interrupted_pairing_custody() {
    let mut ops = ScriptedOps::new(
        Progress::PairingPrepared,
        full_script(pairing(PairingState::BrowserApproved, Some(account(0x22)))),
    );
    let mut io = FakeIo::new();
    drive::drive(&mut ops, &mut io).expect("enrolled");
    assert_eq!(
        ops.reconciles, 1,
        "pairing custody verified before continuing"
    );
    assert_eq!(ops.exchanges[0], Operation::Initialize);
}

#[test]
fn drive_resumes_from_confirmed_without_repairing() {
    let mut ops = ScriptedOps::new(
        Progress::Confirmed,
        vec![
            (
                Operation::Reserve,
                Ok(Success::Reserved(reservation())),
                Progress::Reserved,
            ),
            (
                Operation::Enroll,
                Ok(Success::Enrolled {
                    reservation: reservation(),
                    enrollment: enrollment(),
                }),
                Progress::Enrolled,
            ),
            (
                Operation::Namespace,
                Ok(Success::Namespace {
                    reservation: reservation(),
                    namespace: Namespace {
                        namespace_key: Secret32::from_bytes(id(0x99)).unwrap(),
                        receipt: receipt(),
                    },
                }),
                Progress::NamespaceCustodyVerified,
            ),
        ],
    );
    let mut io = FakeIo::new();
    drive::drive(&mut ops, &mut io).expect("enrolled");
    assert_eq!(
        ops.exchanges,
        vec![Operation::Reserve, Operation::Enroll, Operation::Namespace],
        "no pairing or browser work when already confirmed"
    );
    assert!(io.urls.is_empty());
}

#[test]
fn drive_resumes_an_already_chosen_account() {
    let mut ops = ScriptedOps::new(
        Progress::Initialized,
        vec![
            (
                Operation::Confirm,
                pairing(PairingState::TerminalConfirmed, Some(account(0x22))),
                Progress::Confirmed,
            ),
            (
                Operation::Reserve,
                Ok(Success::Reserved(reservation())),
                Progress::Reserved,
            ),
            (
                Operation::Enroll,
                Ok(Success::Enrolled {
                    reservation: reservation(),
                    enrollment: enrollment(),
                }),
                Progress::Enrolled,
            ),
            (
                Operation::Namespace,
                Ok(Success::Namespace {
                    reservation: reservation(),
                    namespace: Namespace {
                        namespace_key: Secret32::from_bytes(id(0x99)).unwrap(),
                        receipt: receipt(),
                    },
                }),
                Progress::NamespaceCustodyVerified,
            ),
        ],
    );
    ops.chosen = Some(account(0x22));
    let mut io = FakeIo::new();
    drive::drive(&mut ops, &mut io).expect("enrolled");
    assert_eq!(ops.exchanges[0], Operation::Confirm, "no poll once chosen");
    assert!(ops.chosen_calls.is_empty(), "account not re-chosen");
}

#[test]
fn drive_propagates_domain_refusals() {
    for (error, expected) in [
        (DomainError::Throttled, Error::Busy),
        (DomainError::Unavailable, Error::Busy),
        (DomainError::ClockRegressed, Error::ClockRegressed),
        (DomainError::RecoveryRequired, Error::RecoveryRequired),
        (DomainError::Revoked, Error::Conflict),
    ] {
        let mut ops = ScriptedOps::new(
            Progress::Confirmed,
            vec![(Operation::Reserve, Err(error), Progress::Confirmed)],
        );
        let mut io = FakeIo::new();
        assert_eq!(
            drive::drive(&mut ops, &mut io).err(),
            Some(expected),
            "domain {error:?}"
        );
    }
}

#[test]
fn drive_refuses_poll_bound() {
    // Drive handshake directly with an endless Pending stream is impossible to
    // script by queue; bound is asserted via the fixed MAX_PAIRING_POLLS cap.
    assert_eq!(MAX_PAIRING_POLLS, 600);
}

#[test]
fn mint_produces_a_valid_genesis_bound_to_the_secret() {
    let (secret, record) = drive::mint(NOW).expect("mint");
    record::initial(&record).expect("genesis record valid");
    assert_eq!(record.progress, Progress::PairingPlanned);
    // The durable commitments must derive from the live pairing secret through
    // the same fixed domains the request projections use.
    let (poll, upload) = secret
        .with_pairing_secrets(|poll, upload| {
            (
                contract::Secret32::from_bytes(*poll).unwrap(),
                contract::Secret32::from_bytes(*upload).unwrap(),
            )
        })
        .expect("pairing secret");
    let (poll_commitment, upload_commitment) =
        contract::pairing_commitments(&record.intent_id, &poll, &upload);
    assert_eq!(*record.poll_commitment.as_bytes(), poll_commitment);
    assert_eq!(*record.upload_commitment.as_bytes(), upload_commitment);
    assert_eq!(record.intent_id, *secret.identity().intent_id().unwrap());
}
