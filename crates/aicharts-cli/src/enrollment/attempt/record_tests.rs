use super::{
    record::{self, *},
    Error, MAX_DISPATCHES, MAX_FLIGHTS, MAX_RECORD_BYTES, MAX_REVISION,
};
use crate::enrollment::contract::{
    DeviceState, DomainError, Enrollment, Operation, PairingState, PairingView, Receipt,
    Reservation, CLOCK_SKEW_MS, MAX_TIME_MS, POLL_MS, TTL_MS,
};
use aicharts_custody::{
    references::RecordIntent, CredentialRef, NamespaceBinding, Purpose, RecordIdentity, Secret32,
    SecretRecord,
};
use sha2::{Digest, Sha256};

pub(super) const TIME: u64 = 1_789_300_800_000;

// Independently authored bytes, not encoder-generated expectations. Protocol
// hashes are pinned by terminal-enrollment-v1.json; the local custody pins in
// these vectors are deliberately unauthenticated synthetic observations.
const INITIAL: &[u8] = concat!(
    r#"{"schemaVersion":1,"revision":0,"installationId":"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1","#,
    r#""intentId":"1111111111111111111111111111111111111111111111111111111111111111","#,
    r#""pairing":{"identity":{"installationId":"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1","itemId":"b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2","purpose":"pairing","intentId":"1111111111111111111111111111111111111111111111111111111111111111"},"commitment":"d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4"},"namespaceItemId":"c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3","#,
    r#""pollCommitment":"3405f21768755d92addb5cc941649473c0498ac6e8072a842e242fded17284c5","uploadCommitment":"497cbafd9fe88f7295283d30ec0d8a812545be8a0bf812d879bb31cec40421e0","#,
    r#""progress":"pairing-planned","initializedExpiresAtMs":null,"lastPairing":null,"accountChoice":{"state":"unchosen"},"reservation":null,"enrollment":null,"namespace":null,"flight":null,"flightsStarted":0,"lastFailure":null,"clockFloorMs":1789300800000}"#,
).as_bytes();

const COMPLETE: &[u8] = concat!(
    r#"{"schemaVersion":1,"revision":24,"installationId":"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1","#,
    r#""intentId":"1111111111111111111111111111111111111111111111111111111111111111","#,
    r#""pairing":{"identity":{"installationId":"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1","itemId":"b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2","purpose":"pairing","intentId":"1111111111111111111111111111111111111111111111111111111111111111"},"commitment":"d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4"},"namespaceItemId":"c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3","#,
    r#""pollCommitment":"3405f21768755d92addb5cc941649473c0498ac6e8072a842e242fded17284c5","uploadCommitment":"497cbafd9fe88f7295283d30ec0d8a812545be8a0bf812d879bb31cec40421e0","#,
    r#""progress":"namespace-custody-verified","initializedExpiresAtMs":1789301400000,"lastPairing":{"observedAtMs":1789300802000,"view":{"state":"terminal-confirmed","expiresAtMs":1789301400000,"pollAfterMs":0,"approvedAccountId":"acct_66666666666666666666666666666666"}},"accountChoice":{"state":"confirmed","accountId":"acct_66666666666666666666666666666666","chosenAtMs":1789300801000,"confirmedAtMs":1789300802000},"reservation":{"schemaVersion":1,"intentId":"1111111111111111111111111111111111111111111111111111111111111111","accountId":"acct_66666666666666666666666666666666","reservationId":"5555555555555555555555555555555555555555555555555555555555555555","pollCommitment":"3405f21768755d92addb5cc941649473c0498ac6e8072a842e242fded17284c5","uploadCommitment":"497cbafd9fe88f7295283d30ec0d8a812545be8a0bf812d879bb31cec40421e0","recoveryGeneration":"4444444444444444444444444444444444444444444444444444444444444444","reservedAtMs":1789300803000,"expiresAtMs":1789300860000},"enrollment":{"receipt":{"schemaVersion":1,"accountId":"acct_66666666666666666666666666666666","intentId":"1111111111111111111111111111111111111111111111111111111111111111","reservationId":"5555555555555555555555555555555555555555555555555555555555555555","deviceId":"15a89decb584b14c594fdaa317d10aacaf9c1e7d305b8c7375093ea72a6cecca","enrolledAtMs":1789300804000,"namespaceVersion":1},"deviceState":"active"},"namespace":{"pin":{"identity":{"installationId":"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1","itemId":"c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3","purpose":"namespace","accountId":"acct_66666666666666666666666666666666","recoveryGeneration":"4444444444444444444444444444444444444444444444444444444444444444","namespaceVersion":1},"commitment":"e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5"},"acceptedAtMs":1789300805000},"flight":null,"flightsStarted":5,"lastFailure":null,"clockFloorMs":1789300807000}"#,
).as_bytes();

fn fixed_id(text: &str) -> [u8; 32] {
    assert_eq!(text.len(), 64);
    let mut id = [0; 32];
    for (byte, text) in id.iter_mut().zip(text.as_bytes().chunks_exact(2)) {
        *byte = u8::from_str_radix(std::str::from_utf8(text).unwrap(), 16).unwrap();
    }
    id
}
pub(super) fn copy(value: &Record) -> Record {
    record::decode(record::encode(value).unwrap().as_bytes()).unwrap()
}
pub(super) fn initial_record() -> Record {
    Record {
        revision: 0,
        installation_id: [0xa1; 32],
        intent_id: [0x11; 32],
        pairing: Pin {
            identity: RecordIdentity::pairing(
                CredentialRef::new([0xa1; 32], [0xb2; 32], Purpose::Pairing).unwrap(),
                [0x11; 32],
            )
            .unwrap(),
            commitment: Commitment::new([0xd4; 32]).unwrap(),
        },
        namespace_item_id: [0xc3; 32],
        poll_commitment: Commitment::new(fixed_id(
            "3405f21768755d92addb5cc941649473c0498ac6e8072a842e242fded17284c5",
        ))
        .unwrap(),
        upload_commitment: Commitment::new(fixed_id(
            "497cbafd9fe88f7295283d30ec0d8a812545be8a0bf812d879bb31cec40421e0",
        ))
        .unwrap(),
        progress: Progress::PairingPlanned,
        initialized_expires_at_ms: None,
        last_pairing: None,
        account_choice: AccountChoice::Unchosen,
        reservation: None,
        enrollment: None,
        namespace: None,
        flight: None,
        flights_started: 0,
        last_failure: None,
        clock_floor_ms: TIME,
    }
}
pub(super) fn flight_record() -> Record {
    let mut value = initial_record();
    value.progress = Progress::PairingCustodyVerified;
    value.revision = 3;
    value.flights_started = 1;
    value.flight = Some(Flight {
        operation: Operation::Initialize,
        ordinal: 1,
        prepared_revision: 3,
        prepared_at_ms: TIME,
        context_now_ms: TIME,
        last_attempt_at_ms: None,
        dispatches: 0,
        request_sha: Commitment::new([0x81; 32]).unwrap(),
        context_sha: Commitment::new([0x82; 32]).unwrap(),
    });
    value
}
pub(super) fn enrolled_record() -> Record {
    let mut value = initial_record();
    value.revision = 20;
    value.flights_started = 4;
    value.progress = Progress::Enrolled;
    value.clock_floor_ms = TIME + 7_000;
    value.initialized_expires_at_ms = Some(TIME + TTL_MS);
    value.account_choice = AccountChoice::Confirmed {
        account_id: [0x66; 16],
        chosen_at_ms: TIME + 1_000,
        confirmed_at_ms: TIME + 2_000,
    };
    value.last_pairing = Some(PairingObservation {
        observed_at_ms: TIME + 2_000,
        view: PairingView {
            state: PairingState::TerminalConfirmed,
            expires_at_ms: TIME + TTL_MS,
            poll_after_ms: 0,
            approved_account_id: Some([0x66; 16]),
        },
    });
    value.reservation = Some(Reservation {
        intent_id: value.intent_id,
        account_id: [0x66; 16],
        reservation_id: [0x55; 32],
        poll_commitment: *value.poll_commitment.as_bytes(),
        upload_commitment: *value.upload_commitment.as_bytes(),
        recovery_generation: [0x44; 32],
        reserved_at_ms: TIME + 3_000,
        expires_at_ms: TIME + 60_000,
    });
    value.enrollment = Some(Enrollment {
        receipt: Receipt {
            account_id: [0x66; 16],
            intent_id: value.intent_id,
            reservation_id: [0x55; 32],
            device_id: fixed_id("15a89decb584b14c594fdaa317d10aacaf9c1e7d305b8c7375093ea72a6cecca"),
            enrolled_at_ms: TIME + 4_000,
        },
        device_state: DeviceState::Active,
    });
    value
}
fn complete_record() -> Record {
    let mut value = enrolled_record();
    value.revision = 24;
    value.flights_started = 5;
    value.progress = Progress::NamespaceCustodyVerified;
    value.namespace = Some(NamespacePin {
        pin: Pin {
            identity: RecordIdentity::namespace(
                CredentialRef::new(
                    value.installation_id,
                    value.namespace_item_id,
                    Purpose::Namespace,
                )
                .unwrap(),
                NamespaceBinding::new([0x66; 16], [0x44; 32], 1).unwrap(),
            )
            .unwrap(),
            commitment: Commitment::new([0xe5; 32]).unwrap(),
        },
        accepted_at_ms: TIME + 5_000,
    });
    value
}

#[test]
fn independent_initial_and_complete_vectors_pin_shape_order_and_token_domain() {
    for (value, literal) in [(initial_record(), INITIAL), (complete_record(), COMPLETE)] {
        assert!(record::decode(literal).unwrap() == value);
        assert_eq!(record::encode(&value).unwrap().as_bytes(), literal);
        let mut oracle = b"aicharts:enrollment-attempt-token:v1\0".to_vec();
        oracle.extend_from_slice(literal);
        let expected: [u8; 32] = Sha256::digest(&oracle).into();
        assert_eq!(record::token(&value).unwrap().digest(), &expected);
        assert_eq!(record::token(&value).unwrap().revision(), value.revision);
    }
}

#[test]
fn bounded_canonical_decoder_refuses_all_truncations_duplicates_and_alternate_spellings() {
    for cut in 0..INITIAL.len() {
        assert!(record::decode(&INITIAL[..cut]).is_err(), "cut {cut}");
    }
    let text = std::str::from_utf8(INITIAL).unwrap();
    for invalid in [
        format!(" {text}"),
        format!("{text}\n"),
        format!("\u{feff}{text}"),
        text.replacen(
            "\"schemaVersion\":1",
            "\"schemaVersion\":1,\"schemaVersion\":1",
            1,
        ),
        text.replacen(
            "\"schemaVersion\":1,\"revision\":0",
            "\"revision\":0,\"schemaVersion\":1",
            1,
        ),
        text.replacen("\"revision\":0", "\"revision\":-0", 1),
        text.replacen("\"revision\":0", "\"revision\":0.0", 1),
        text.replacen(
            "\"clockFloorMs\":1789300800000",
            "\"clockFloorMs\":1.7893008e12",
            1,
        ),
        text.replacen("\"schemaVersion\":1", "\"schemaVersion\":2", 1),
        text.replacen("a1a1", "A1a1", 1),
        text.replacen("pairing-planned", "pairing\\u002dplanned", 1),
        text.replacen(
            "\"clockFloorMs\":",
            "\"secret\":\"SYNTHETIC_PRIVATE_CANARY\",\"clockFloorMs\":",
            1,
        ),
        "null".into(),
        "[]".into(),
        "{}".into(),
    ] {
        assert!(record::decode(invalid.as_bytes()).is_err());
    }
    assert_eq!(
        record::decode(&vec![b' '; MAX_RECORD_BYTES + 1]).err(),
        Some(Error::Limit)
    );
}

#[test]
fn typed_custody_pins_exclude_pairing_and_namespace_secret_preimages() {
    let mut value = initial_record();
    let secret = SecretRecord::pairing(
        value.pairing.identity.reference().clone(),
        value.intent_id,
        Secret32::new([0x22; 32]).unwrap(),
        Secret32::new([0x33; 32]).unwrap(),
    )
    .unwrap();
    let intent = RecordIntent::from_record(&secret);
    value.pairing = Pin::from_intent(&intent).unwrap();
    assert!(value.pairing.identity == *intent.identity());
    assert_eq!(value.pairing.commitment.as_bytes(), intent.commitment());
    let mut namespace_value = complete_record();
    let identity = &namespace_value.namespace.as_ref().unwrap().pin.identity;
    let namespace_secret = SecretRecord::namespace(
        identity.reference().clone(),
        identity.namespace_binding().unwrap().clone(),
        Secret32::new([0x77; 32]).unwrap(),
    )
    .unwrap();
    let namespace_intent = RecordIntent::from_record(&namespace_secret);
    namespace_value.namespace.as_mut().unwrap().pin = Pin::from_intent(&namespace_intent).unwrap();
    assert_eq!(
        namespace_value
            .namespace
            .as_ref()
            .unwrap()
            .pin
            .commitment
            .as_bytes(),
        namespace_intent.commitment()
    );
    for bytes in [
        record::encode(&value).unwrap(),
        record::encode(&namespace_value).unwrap(),
    ] {
        for raw in [[0x22; 32], [0x33; 32], [0x77; 32]] {
            assert!(!bytes
                .as_bytes()
                .windows(raw.len())
                .any(|window| window == raw));
            let ascii = raw
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            assert!(!std::str::from_utf8(bytes.as_bytes())
                .unwrap()
                .contains(&ascii));
        }
        for forbidden in [
            "pollSecret",
            "uploadSecret",
            "namespaceKey",
            "browserProof",
            "ledgerSequence",
            "SYNTHETIC_PRIVATE_CANARY",
        ] {
            assert!(!std::str::from_utf8(bytes.as_bytes())
                .unwrap()
                .contains(forbidden));
        }
    }
    assert!(Commitment::new([0; 32]).is_err());
}

#[test]
fn identity_phase_account_and_protocol_bindings_are_checked_before_encoding() {
    let mutations: &[fn(&mut Record)] = &[
        |v| v.installation_id = [0; 32],
        |v| v.intent_id = [0; 32],
        |v| v.namespace_item_id = [0; 32],
        |v| v.installation_id[0] ^= 1,
        |v| v.intent_id[0] ^= 1,
        |v| v.namespace_item_id = *v.pairing.identity.reference().item_id(),
        |v| v.upload_commitment = v.poll_commitment,
        |v| {
            v.pairing.identity = RecordIdentity::checkpoint(
                CredentialRef::new(v.installation_id, [9; 32], Purpose::Checkpoint).unwrap(),
            )
            .unwrap()
        },
        |v| v.progress = Progress::PairingCustodyVerified,
        |v| v.initialized_expires_at_ms = None,
        |v| v.account_choice = AccountChoice::Unchosen,
        |v| v.reservation = None,
        |v| v.enrollment = None,
        |v| v.reservation.as_mut().unwrap().account_id[0] ^= 1,
        |v| v.reservation.as_mut().unwrap().intent_id[0] ^= 1,
        |v| v.reservation.as_mut().unwrap().reservation_id = [0; 32],
        |v| v.reservation.as_mut().unwrap().recovery_generation = [0; 32],
        |v| v.reservation.as_mut().unwrap().poll_commitment[0] ^= 1,
        |v| v.reservation.as_mut().unwrap().upload_commitment[0] ^= 1,
        |v| v.enrollment.as_mut().unwrap().receipt.device_id[0] ^= 1,
        |v| v.enrollment.as_mut().unwrap().receipt.account_id[0] ^= 1,
        |v| v.enrollment.as_mut().unwrap().receipt.intent_id[0] ^= 1,
        |v| v.enrollment.as_mut().unwrap().receipt.reservation_id[0] ^= 1,
        |v| v.last_pairing.as_mut().unwrap().view.approved_account_id = None,
        |v| v.last_pairing.as_mut().unwrap().view.approved_account_id = Some([0x67; 16]),
        |v| v.last_pairing.as_mut().unwrap().view.state = PairingState::Pending,
        |v| v.last_pairing.as_mut().unwrap().view.expires_at_ms += 1,
    ];
    for (index, mutate) in mutations.iter().enumerate() {
        let mut value = enrolled_record();
        mutate(&mut value);
        assert!(record::encode(&value).is_err(), "binding case {index}");
    }
}

#[test]
fn clock_ttl_poll_and_namespace_bounds_preserve_expired_observations() {
    let mutations: &[fn(&mut Record)] = &[
        |v| v.clock_floor_ms = MAX_TIME_MS + 1,
        |v| v.clock_floor_ms = TIME - CLOCK_SKEW_MS - 1,
        |v| v.initialized_expires_at_ms = Some(TTL_MS - 1),
        |v| v.initialized_expires_at_ms = Some(MAX_TIME_MS + 1),
        |v| {
            v.account_choice = AccountChoice::Confirmed {
                account_id: [0x66; 16],
                chosen_at_ms: TIME - 1,
                confirmed_at_ms: TIME + 2_000,
            }
        },
        |v| {
            v.account_choice = AccountChoice::Confirmed {
                account_id: [0x66; 16],
                chosen_at_ms: TIME + 2_001,
                confirmed_at_ms: TIME + 2_000,
            }
        },
        |v| {
            v.account_choice = AccountChoice::Confirmed {
                account_id: [0x66; 16],
                chosen_at_ms: TIME + 1_000,
                confirmed_at_ms: TIME + TTL_MS,
            }
        },
        |v| v.last_pairing.as_mut().unwrap().observed_at_ms = TIME - 1,
        |v| v.last_pairing.as_mut().unwrap().observed_at_ms = v.clock_floor_ms + CLOCK_SKEW_MS + 1,
        |v| v.last_pairing.as_mut().unwrap().view.poll_after_ms = POLL_MS + 1,
        |v| v.reservation.as_mut().unwrap().reserved_at_ms = TIME - 1,
        |v| v.reservation.as_mut().unwrap().reserved_at_ms = TIME + 60_000,
        |v| v.reservation.as_mut().unwrap().expires_at_ms = TIME + TTL_MS + 1,
        |v| v.enrollment.as_mut().unwrap().receipt.enrolled_at_ms = TIME + 2_999,
        |v| v.enrollment.as_mut().unwrap().receipt.enrolled_at_ms = TIME + 60_000,
        |v| v.namespace.as_mut().unwrap().accepted_at_ms = TIME + 3_999,
        |v| v.namespace.as_mut().unwrap().accepted_at_ms = TIME + 60_000,
        |v| {
            v.namespace.as_mut().unwrap().pin.identity = RecordIdentity::namespace(
                CredentialRef::new(v.installation_id, v.namespace_item_id, Purpose::Namespace)
                    .unwrap(),
                NamespaceBinding::new([0x67; 16], [0x44; 32], 1).unwrap(),
            )
            .unwrap()
        },
    ];
    for (index, mutate) in mutations.iter().enumerate() {
        let mut value = complete_record();
        mutate(&mut value);
        assert!(record::encode(&value).is_err(), "time case {index}");
    }
    // Server-issued timestamps may lead the local clock floor by the skew
    // bound; exactly at the bound they still encode.
    let mut edge = complete_record();
    edge.last_pairing.as_mut().unwrap().observed_at_ms = edge.clock_floor_ms + CLOCK_SKEW_MS;
    assert!(record::encode(&edge).is_ok());
    let mut edge = flight_record();
    edge.flight.as_mut().unwrap().prepared_at_ms = edge.clock_floor_ms + CLOCK_SKEW_MS;
    assert!(record::encode(&edge).is_ok());
    let mut late = complete_record();
    late.clock_floor_ms = MAX_TIME_MS;
    late.enrollment.as_mut().unwrap().device_state = DeviceState::Revoked;
    assert!(record::decode(record::encode(&late).unwrap().as_bytes()).unwrap() == late);
    assert_eq!(
        late.reservation.as_ref().unwrap().expires_at_ms,
        TIME + 60_000
    );
    assert_eq!(late.initialized_expires_at_ms, Some(TIME + TTL_MS));
}

#[test]
fn retained_flight_freezes_digests_times_and_explicit_dispatches_across_retries() {
    let mut previous = flight_record();
    let frozen = previous.flight.as_ref().unwrap().clone();
    for dispatch in 1..=MAX_DISPATCHES {
        let mut next = copy(&previous);
        next.revision += 1;
        next.clock_floor_ms += 1;
        let flight = next.flight.as_mut().unwrap();
        flight.dispatches = dispatch;
        flight.last_attempt_at_ms = Some(next.clock_floor_ms);
        assert!(
            flight.request_sha == frozen.request_sha && flight.context_sha == frozen.context_sha
        );
        assert_eq!(record::successor(&previous, &next), Ok(()));
        previous = next;
    }
    let mut late = copy(&previous);
    late.revision += 1;
    late.clock_floor_ms += TTL_MS * 2;
    late.last_failure = Some(LastFailure::OutcomeUnknown);
    assert_eq!(record::successor(&previous, &late), Ok(()));
    assert!(late.flight == previous.flight);
    let mut fourth = copy(&late);
    fourth.revision += 1;
    fourth.flight.as_mut().unwrap().dispatches += 1;
    assert!(record::encode(&fourth).is_err());
    let mut settled = copy(&late);
    settled.revision += 1;
    settled.flight = None;
    settled.progress = Progress::Initialized;
    settled.initialized_expires_at_ms = Some(TIME + TTL_MS);
    assert_eq!(record::successor(&late, &settled), Ok(()));
}

#[test]
fn invalid_flight_fields_counter_limits_and_operation_requirements_refuse() {
    let mutations: &[fn(&mut Record)] = &[
        |v| v.flight.as_mut().unwrap().ordinal = 0,
        |v| v.flight.as_mut().unwrap().ordinal = 2,
        |v| v.flight.as_mut().unwrap().prepared_revision = 0,
        |v| v.flight.as_mut().unwrap().prepared_revision = v.revision + 1,
        |v| v.flight.as_mut().unwrap().prepared_at_ms = v.clock_floor_ms + CLOCK_SKEW_MS + 1,
        |v| v.flight.as_mut().unwrap().last_attempt_at_ms = Some(TIME),
        |v| v.flight.as_mut().unwrap().dispatches = 1,
        |v| v.flight.as_mut().unwrap().operation = Operation::Poll,
        |v| v.flight.as_mut().unwrap().operation = Operation::Confirm,
        |v| v.flight.as_mut().unwrap().operation = Operation::Reserve,
        |v| v.flight.as_mut().unwrap().operation = Operation::Enroll,
        |v| v.flight.as_mut().unwrap().operation = Operation::Namespace,
        |v| v.flights_started = MAX_FLIGHTS + 1,
        |v| v.revision = MAX_REVISION + 1,
    ];
    for (index, mutate) in mutations.iter().enumerate() {
        let mut value = flight_record();
        mutate(&mut value);
        assert!(record::encode(&value).is_err(), "flight case {index}");
    }
    let mut boundary = flight_record();
    boundary.revision = MAX_REVISION;
    boundary.flights_started = MAX_FLIGHTS;
    let flight = boundary.flight.as_mut().unwrap();
    flight.ordinal = MAX_FLIGHTS;
    flight.prepared_revision = MAX_REVISION - u64::from(MAX_DISPATCHES);
    flight.dispatches = MAX_DISPATCHES;
    flight.last_attempt_at_ms = Some(TIME);
    assert!(record::encode(&boundary).is_ok());
}

#[test]
fn successor_refuses_reminting_changed_receipts_choice_reset_and_regressions() {
    let old = enrolled_record();
    let mutations: &[fn(&mut Record)] = &[
        |v| v.pairing.commitment = Commitment::new([9; 32]).unwrap(),
        |v| v.namespace_item_id = [9; 32],
        |v| v.initialized_expires_at_ms = Some(TIME + TTL_MS - 1),
        |v| v.reservation.as_mut().unwrap().expires_at_ms -= 1,
        |v| v.enrollment.as_mut().unwrap().receipt.enrolled_at_ms += 1,
        |v| {
            v.account_choice = AccountChoice::Confirmed {
                account_id: [0x66; 16],
                chosen_at_ms: TIME + 999,
                confirmed_at_ms: TIME + 2_000,
            }
        },
        |v| v.last_pairing = None,
        |v| v.last_pairing.as_mut().unwrap().observed_at_ms -= 1,
        |v| v.clock_floor_ms -= 1,
        |v| v.flights_started += 1,
        |v| v.revision += 1,
    ];
    for mutate in mutations {
        let mut next = copy(&old);
        next.revision += 1;
        mutate(&mut next);
        assert!(record::successor(&old, &next).is_err());
    }
    let mut revoked = copy(&old);
    revoked.revision += 1;
    revoked.enrollment.as_mut().unwrap().device_state = DeviceState::Revoked;
    assert_eq!(record::successor(&old, &revoked), Ok(()));
    let mut active = copy(&revoked);
    active.revision += 1;
    active.enrollment.as_mut().unwrap().device_state = DeviceState::Active;
    assert_eq!(
        record::successor(&revoked, &active),
        Err(Error::InvalidSuccessor)
    );
    let old = flight_record();
    for mutate in [
        (|v: &mut Record| {
            v.flight.as_mut().unwrap().request_sha = Commitment::new([9; 32]).unwrap()
        }) as fn(&mut Record),
        |v| v.flight.as_mut().unwrap().context_sha = Commitment::new([9; 32]).unwrap(),
        |v| v.flight.as_mut().unwrap().prepared_at_ms -= 1,
        |v| v.flight.as_mut().unwrap().context_now_ms -= 1,
        |v| v.flight.as_mut().unwrap().prepared_revision -= 1,
        |v| v.flight = None,
    ] {
        let mut next = copy(&old);
        next.revision += 1;
        mutate(&mut next);
        assert!(record::successor(&old, &next).is_err());
    }
}

#[test]
fn namespace_acceptance_times_and_sticky_pins_cannot_be_refreshed_by_late_retries() {
    let old = enrolled_record();
    let mut pending = copy(&old);
    pending.revision += 1;
    pending.flights_started += 1;
    pending.flight = Some(Flight {
        operation: Operation::Namespace,
        ordinal: pending.flights_started,
        prepared_revision: pending.revision,
        prepared_at_ms: pending.clock_floor_ms,
        context_now_ms: pending.clock_floor_ms,
        last_attempt_at_ms: None,
        dispatches: 0,
        request_sha: Commitment::new([0x81; 32]).unwrap(),
        context_sha: Commitment::new([0x82; 32]).unwrap(),
    });
    assert_eq!(record::successor(&old, &pending), Ok(()));
    let mut late = copy(&pending);
    late.revision += 1;
    late.clock_floor_ms = TIME + TTL_MS;
    assert_eq!(record::successor(&pending, &late), Ok(()));
    late.flight.as_mut().unwrap().dispatches = 1;
    late.flight.as_mut().unwrap().last_attempt_at_ms = Some(TIME + 60_000);
    assert!(record::encode(&late).is_err());
    let complete = complete_record();
    let mut changed = copy(&complete);
    changed.revision += 1;
    changed.namespace.as_mut().unwrap().accepted_at_ms += 1;
    assert_eq!(
        record::successor(&complete, &changed),
        Err(Error::InvalidSuccessor)
    );
    changed = copy(&complete);
    changed.revision += 1;
    changed.namespace.as_mut().unwrap().pin.commitment = Commitment::new([9; 32]).unwrap();
    assert_eq!(
        record::successor(&complete, &changed),
        Err(Error::InvalidSuccessor)
    );
}

#[test]
fn failures_are_fixed_and_domain_errors_retain_the_protocol_operation_union() {
    let mut value = initial_record();
    for failure in [
        LastFailure::Transport,
        LastFailure::ClockRegressed,
        LastFailure::Storage,
        LastFailure::Custody,
        LastFailure::OutcomeUnknown,
        LastFailure::Domain {
            operation: Operation::Initialize,
            error: DomainError::Conflict,
        },
        LastFailure::Domain {
            operation: Operation::Namespace,
            error: DomainError::Revoked,
        },
    ] {
        value.last_failure = Some(failure);
        let bytes = record::encode(&value).unwrap();
        assert!(record::decode(bytes.as_bytes()).unwrap() == value);
        assert!(record::initial(&value).is_err());
    }
    value.last_failure = Some(LastFailure::Domain {
        operation: Operation::Initialize,
        error: DomainError::Revoked,
    });
    assert!(record::encode(&value).is_err());
    for error in [
        Error::InvalidRecord,
        Error::InvalidSuccessor,
        Error::ClockRegressed,
        Error::Limit,
        Error::Missing,
        Error::Conflict,
        Error::StaleSnapshot,
        Error::Busy,
        Error::StorageUnavailable,
        Error::RecoveryRequired,
        Error::OutcomeUnknown,
    ] {
        assert!(error.code().starts_with("attempt_"));
        assert!(error
            .code()
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte == b'_'));
    }
}

#[test]
fn full_optional_record_at_counter_and_clock_limits_remains_bounded() {
    let mut value = complete_record();
    value.progress = Progress::NamespacePrepared;
    value.revision = MAX_REVISION;
    value.clock_floor_ms = MAX_TIME_MS;
    value.flights_started = MAX_FLIGHTS;
    value.flight = Some(Flight {
        operation: Operation::Namespace,
        ordinal: MAX_FLIGHTS,
        prepared_revision: MAX_REVISION - u64::from(MAX_DISPATCHES),
        prepared_at_ms: TIME + 4_100,
        context_now_ms: TIME + 4_000,
        last_attempt_at_ms: Some(TIME + 4_900),
        dispatches: MAX_DISPATCHES,
        request_sha: Commitment::new([0x81; 32]).unwrap(),
        context_sha: Commitment::new([0x82; 32]).unwrap(),
    });
    value.last_failure = Some(LastFailure::Domain {
        operation: Operation::Namespace,
        error: DomainError::StorageUnavailable,
    });
    let bytes = record::encode(&value).unwrap();
    assert!(bytes.as_bytes().len() <= MAX_RECORD_BYTES);
    assert!(record::decode(bytes.as_bytes()).unwrap() == value);
    let mut zero_clock = initial_record();
    zero_clock.clock_floor_ms = 0;
    assert!(record::encode(&zero_clock).is_ok());
}

#[test]
fn original_context_time_is_required_and_cannot_follow_preparation() {
    let mut value = flight_record();
    let bytes = record::encode(&value).unwrap();
    let old_shape = std::str::from_utf8(bytes.as_bytes())
        .unwrap()
        .replace(",\"contextNowMs\":1789300800000", "");
    assert!(record::decode(old_shape.as_bytes()).is_err());
    value.flight.as_mut().unwrap().context_now_ms += 1;
    assert_eq!(record::validate(&value), Err(Error::InvalidRecord));
    value.flight.as_mut().unwrap().context_now_ms = u64::MAX;
    assert_eq!(record::validate(&value), Err(Error::InvalidRecord));
}

#[test]
fn record_and_commitment_types_have_no_implicit_debug_projection() {
    trait AmbiguousIfDebug<Marker> {
        fn marker() {}
    }
    impl<T: ?Sized> AmbiguousIfDebug<()> for T {}
    struct HasDebug;
    impl<T: ?Sized + std::fmt::Debug> AmbiguousIfDebug<HasDebug> for T {}
    let _ = <Record as AmbiguousIfDebug<_>>::marker;
    let _ = <Commitment as AmbiguousIfDebug<_>>::marker;
    let _ = <CanonicalBytes as AmbiguousIfDebug<_>>::marker;
    let _ = <Pin as AmbiguousIfDebug<_>>::marker;
    let _ = <Flight as AmbiguousIfDebug<_>>::marker;
}

pub(super) fn namespace_flow() -> Vec<Record> {
    let mut enrolled = enrolled_record();
    enrolled.revision = 19;
    enrolled.clock_floor_ms = TIME + 4_000;
    let mut prepared = copy(&enrolled);
    prepared.revision = 20;
    prepared.clock_floor_ms = TIME + 4_100;
    prepared.flights_started = 5;
    prepared.flight = Some(Flight {
        operation: Operation::Namespace,
        ordinal: 5,
        prepared_revision: 20,
        prepared_at_ms: TIME + 4_100,
        context_now_ms: TIME + 4_000,
        last_attempt_at_ms: None,
        dispatches: 0,
        request_sha: Commitment::new([0x81; 32]).unwrap(),
        context_sha: Commitment::new([0x82; 32]).unwrap(),
    });
    let mut dispatched = copy(&prepared);
    dispatched.revision = 21;
    dispatched.clock_floor_ms = TIME + 4_200;
    dispatched.flight.as_mut().unwrap().dispatches = 1;
    dispatched.flight.as_mut().unwrap().last_attempt_at_ms = Some(TIME + 4_200);
    let mut pinned = copy(&dispatched);
    pinned.revision = 22;
    pinned.clock_floor_ms = TIME + 5_000;
    pinned.progress = Progress::NamespacePlanned;
    pinned.namespace = complete_record().namespace;
    let mut references_prepared = copy(&pinned);
    references_prepared.revision = 23;
    references_prepared.clock_floor_ms = TIME + 6_000;
    references_prepared.progress = Progress::NamespacePrepared;
    let mut verified = copy(&references_prepared);
    verified.revision = 24;
    verified.clock_floor_ms = TIME + 7_000;
    verified.progress = Progress::NamespaceCustodyVerified;
    verified.flight = None;
    vec![
        enrolled,
        prepared,
        dispatched,
        pinned,
        references_prepared,
        verified,
    ]
}

#[test]
fn namespace_response_pin_and_local_custody_steps_retain_the_original_flight_until_completion() {
    let flow = namespace_flow();
    let literal_flight = br#"{"operation":"namespaceForEnrollment","ordinal":5,"preparedRevision":20,"preparedAtMs":1789300804100,"contextNowMs":1789300804000,"lastAttemptAtMs":1789300804200,"dispatches":1,"requestSHA":"8181818181818181818181818181818181818181818181818181818181818181","contextSHA":"8282828282828282828282828282828282828282828282828282828282828282"}"#;
    for pair in flow.windows(2) {
        assert_eq!(record::successor(&pair[0], &pair[1]), Ok(()));
    }
    for retained in &flow[2..5] {
        let bytes = record::encode(retained).unwrap();
        assert!(bytes
            .as_bytes()
            .windows(literal_flight.len())
            .any(|window| window == literal_flight));
    }
    assert_eq!(
        record::encode(flow.last().unwrap()).unwrap().as_bytes(),
        COMPLETE
    );
    let mut late = copy(&flow[4]);
    late.clock_floor_ms = MAX_TIME_MS;
    assert_eq!(record::successor(&flow[3], &late), Ok(()));
    let mut completed = copy(&late);
    completed.revision += 1;
    completed.progress = Progress::NamespaceCustodyVerified;
    completed.flight = None;
    assert_eq!(record::successor(&late, &completed), Ok(()));
    assert_eq!(
        completed.namespace.as_ref().unwrap().accepted_at_ms,
        TIME + 5_000
    );
}

#[test]
fn pending_namespace_custody_forbids_dispatch_refresh_rebinding_skipped_stage_and_early_clear() {
    let flow = namespace_flow();
    let mutations: &[fn(&mut Record)] = &[
        |v| v.flight.as_mut().unwrap().dispatches += 1,
        |v| v.flight.as_mut().unwrap().request_sha = Commitment::new([9; 32]).unwrap(),
        |v| v.flight.as_mut().unwrap().context_sha = Commitment::new([9; 32]).unwrap(),
        |v| v.namespace.as_mut().unwrap().pin.commitment = Commitment::new([9; 32]).unwrap(),
        |v| v.namespace.as_mut().unwrap().accepted_at_ms += 1,
    ];
    for previous in &flow[3..5] {
        for mutate in mutations {
            let mut next = copy(previous);
            next.revision += 1;
            next.clock_floor_ms += 1;
            mutate(&mut next);
            assert_eq!(record::validate(&next), Ok(()));
            assert_eq!(
                record::successor(previous, &next),
                Err(Error::InvalidSuccessor)
            );
        }
    }
    let mut skipped = copy(&flow[3]);
    skipped.progress = Progress::NamespacePrepared;
    assert_eq!(record::validate(&skipped), Ok(()));
    assert_eq!(
        record::successor(&flow[2], &skipped),
        Err(Error::InvalidSuccessor)
    );
    let mut early = copy(&flow[3]);
    early.revision += 1;
    early.progress = Progress::NamespaceCustodyVerified;
    early.flight = None;
    assert_eq!(record::validate(&early), Ok(()));
    assert_eq!(
        record::successor(&flow[3], &early),
        Err(Error::InvalidSuccessor)
    );
    let mut missing = copy(&flow[2]);
    missing.revision += 1;
    missing.flight = None;
    assert_eq!(
        record::successor(&flow[2], &missing),
        Err(Error::InvalidSuccessor)
    );
    let mut unpinned = copy(&flow[2]);
    unpinned.revision += 1;
    unpinned.namespace = complete_record().namespace;
    unpinned.progress = Progress::NamespacePlanned;
    unpinned.clock_floor_ms = TIME + 5_000;
    unpinned.namespace.as_mut().unwrap().accepted_at_ms = TIME + 4_199;
    assert!(record::validate(&unpinned).is_err());
}
