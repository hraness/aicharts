//! Synthetic process-loss evidence. No filesystem, vault selection or transport.
use super::{tests::Memory, *};
use crate::enrollment::attempt::record_tests::{enrolled_record, initial_record, TIME};

const OPERATIONS: [Operation; 6] = [
    Operation::Initialize,
    Operation::Poll,
    Operation::Confirm,
    Operation::Reserve,
    Operation::Enroll,
    Operation::Namespace,
];

fn secret(current: &Record, poll: u8, upload: u8) -> SecretRecord {
    SecretRecord::pairing(
        current.pairing.identity.reference().clone(),
        current.intent_id,
        Secret32::new([poll; 32]).unwrap(),
        Secret32::new([upload; 32]).unwrap(),
    )
    .unwrap()
}

fn fixture(operation: Operation) -> (Record, Request, Context, SecretRecord) {
    let mut current = if operation == Operation::Initialize {
        let mut value = initial_record();
        value.revision = 2;
        value.progress = Progress::PairingCustodyVerified;
        value
    } else {
        enrolled_record()
    };
    match operation {
        Operation::Initialize | Operation::Namespace => (),
        Operation::Poll | Operation::Confirm => {
            current.progress = Progress::Initialized;
            current.reservation = None;
            current.enrollment = None;
            current.last_pairing = None;
            current.account_choice = if operation == Operation::Poll {
                AccountChoice::Unchosen
            } else {
                AccountChoice::Chosen {
                    account_id: [0x66; 16],
                    chosen_at_ms: TIME + 1_000,
                }
            };
        }
        Operation::Reserve => {
            current.progress = Progress::Confirmed;
            current.reservation = None;
            current.enrollment = None;
        }
        Operation::Enroll => {
            current.progress = Progress::Reserved;
            current.enrollment = None;
        }
    }
    let secret = secret(&current, 0x22, 0x33);
    current.pairing = Pin::from_intent(&RecordIntent::from_record(&secret)).unwrap();
    let proof = contract::PollProof {
        intent_id: current.intent_id,
        poll_secret: contract::Secret32::from_bytes([0x22; 32]).unwrap(),
    };
    let request = match operation {
        Operation::Initialize => Request::Initialize {
            proof,
            upload_commitment: *current.upload_commitment.as_bytes(),
        },
        Operation::Poll => Request::Poll(proof),
        Operation::Confirm => Request::Confirm {
            proof,
            account_id: [0x66; 16],
        },
        operation => {
            let proof = contract::EnrollmentProof {
                pairing: proof,
                upload_secret: contract::Secret32::from_bytes([0x33; 32]).unwrap(),
            };
            match operation {
                Operation::Reserve => Request::Reserve(proof),
                Operation::Enroll => Request::Enroll(proof),
                Operation::Namespace => Request::Namespace(proof),
                _ => unreachable!(),
            }
        }
    };
    let context = Context {
        now_ms: current.clock_floor_ms,
        initialized_expires_at_ms: current.initialized_expires_at_ms,
        confirmed_account_id: current.account_choice.confirmed(),
        reservation: current.reservation.clone(),
        enrollment: current.enrollment.clone(),
    };
    record::validate(&current).unwrap();
    assert!(contract::valid_context(&request, &context));
    (current, request, context, secret)
}

fn prepared(operation: Operation) -> (Record, SecretRecord) {
    let (current, request, context, secret) = fixture(operation);
    let mut storage = Memory::with(&current);
    let prepared = prepare_flight(
        &mut storage,
        record::token(&current).unwrap(),
        &current,
        &request,
        &context,
        context.now_ms + 123,
    )
    .unwrap();
    (prepared.record().clone(), secret)
}

#[test]
fn all_operations_reconstruct_exact_bytes_after_loss_of_original_request_and_context() {
    for operation in OPERATIONS {
        let (bytes, token, expected_request, expected_context, original_time, secret) = {
            let (current, request, context, secret) = fixture(operation);
            let mut storage = Memory::with(&current);
            let prepared = prepare_flight(
                &mut storage,
                record::token(&current).unwrap(),
                &current,
                &request,
                &context,
                context.now_ms + 123,
            )
            .unwrap();
            let dispatched = dispatch_flight(
                &mut storage,
                prepared.token(),
                prepared.record(),
                &request,
                &context,
                context.now_ms + 124,
            )
            .unwrap();
            let failed = record_transport_failure(
                &mut storage,
                dispatched.token(),
                dispatched.record(),
                &request,
                &context,
                context.now_ms + 125,
            )
            .unwrap();
            (
                record::encode(failed.record()).unwrap(),
                failed.token(),
                contract::encode_request(&request).unwrap(),
                context_digest(&context).unwrap(),
                context.now_ms,
                secret,
            )
        }; // Only canonical nonsecret state and the original custody survive.
        let restored = record::decode(bytes.as_bytes()).unwrap();
        let (request, context) = reconstruct_flight(&restored, token, &secret).unwrap();
        assert_eq!(request.operation(), operation);
        assert!(
            contract::encode_request(&request).unwrap().as_bytes() == expected_request.as_bytes()
        );
        assert!(context_digest(&context).unwrap() == expected_context);
        assert_eq!(context.now_ms, original_time);
        assert_ne!(
            context.now_ms,
            restored.flight.as_ref().unwrap().prepared_at_ms
        );
        let mut restarted = Memory::with(&restored);
        let retried = dispatch_flight(
            &mut restarted,
            token,
            &restored,
            &request,
            &context,
            original_time + 126,
        )
        .unwrap();
        assert_eq!(retried.record().flight.as_ref().unwrap().dispatches, 2);
        for canary in ["22".repeat(32), "33".repeat(32)] {
            assert!(!bytes
                .as_bytes()
                .windows(64)
                .any(|part| part == canary.as_bytes()));
        }
        for canary in [[0x22; 32], [0x33; 32]] {
            assert!(!bytes.as_bytes().windows(32).any(|part| part == canary));
        }
    }
}

#[test]
fn reconstruction_requires_exact_snapshot_and_original_pairing_identity_and_secret() {
    let (current, original) = prepared(Operation::Initialize);
    let expected = record::token(&current).unwrap();
    for wrong in [
        secret(&current, 0x23, 0x33),
        secret(&current, 0x22, 0x34),
        SecretRecord::pairing(
            CredentialRef::new([0xa2; 32], [0xb2; 32], Purpose::Pairing).unwrap(),
            current.intent_id,
            Secret32::new([0x22; 32]).unwrap(),
            Secret32::new([0x33; 32]).unwrap(),
        )
        .unwrap(),
        SecretRecord::pairing(
            current.pairing.identity.reference().clone(),
            [0x12; 32],
            Secret32::new([0x22; 32]).unwrap(),
            Secret32::new([0x33; 32]).unwrap(),
        )
        .unwrap(),
        SecretRecord::namespace(
            CredentialRef::new(current.installation_id, [0xb2; 32], Purpose::Namespace).unwrap(),
            NamespaceBinding::new([0x66; 16], [0x44; 32], 1).unwrap(),
            Secret32::new([0x22; 32]).unwrap(),
        )
        .unwrap(),
    ] {
        assert_eq!(
            reconstruct_flight(&current, expected, &wrong).err(),
            Some(Error::Custody)
        );
    }
    let mut changed = current.clone();
    changed.revision += 1;
    assert_eq!(
        reconstruct_flight(&changed, expected, &original).err(),
        Some(Error::StaleSnapshot)
    );
    let (no_flight, _, _, secret) = fixture(Operation::Initialize);
    assert_eq!(
        reconstruct_flight(&no_flight, record::token(&no_flight).unwrap(), &secret).err(),
        Some(Error::Missing)
    );
}

#[test]
fn locally_coherent_changed_facts_cannot_replace_original_flight_correlation() {
    let (confirm, secret) = prepared(Operation::Confirm);
    let mut changed = confirm;
    if let AccountChoice::Chosen {
        ref mut account_id, ..
    } = changed.account_choice
    {
        *account_id = [0x67; 16];
    }
    let token = record::token(&changed).unwrap();
    assert_eq!(
        reconstruct_flight(&changed, token, &secret).err(),
        Some(Error::Conflict)
    );

    let (enroll, secret) = prepared(Operation::Enroll);
    for mutate in [
        (|v: &mut Record| v.reservation.as_mut().unwrap().reservation_id = [0x56; 32])
            as fn(&mut Record),
        |v| v.reservation.as_mut().unwrap().recovery_generation = [0x45; 32],
        |v| v.flight.as_mut().unwrap().context_now_ms -= 1,
        |v| v.flight.as_mut().unwrap().request_sha = Commitment::new([1; 32]).unwrap(),
        |v| v.flight.as_mut().unwrap().context_sha = Commitment::new([2; 32]).unwrap(),
    ] {
        let mut changed = enroll.clone();
        mutate(&mut changed);
        let token = record::token(&changed).unwrap();
        assert_eq!(
            reconstruct_flight(&changed, token, &secret).err(),
            Some(Error::Conflict)
        );
    }
    // Poll does not send the upload proof, but recovery must still match it.
    let (mut poll, secret) = prepared(Operation::Poll);
    poll.upload_commitment = Commitment::new([3; 32]).unwrap();
    let token = record::token(&poll).unwrap();
    assert_eq!(
        reconstruct_flight(&poll, token, &secret).err(),
        Some(Error::Custody)
    );
}

#[test]
fn reconstruction_does_not_refresh_expiry_or_reset_clock_and_dispatch_limits() {
    for operation in [Operation::Confirm, Operation::Namespace] {
        let (current, secret) = prepared(operation);
        let expected = record::token(&current).unwrap();
        let (request, context) = reconstruct_flight(&current, expected, &secret).unwrap();
        let expires = if operation == Operation::Confirm {
            current.initialized_expires_at_ms.unwrap()
        } else {
            current.reservation.as_ref().unwrap().expires_at_ms
        };
        let mut storage = Memory::with(&current);
        assert_eq!(
            dispatch_flight(
                &mut storage,
                expected,
                &current,
                &request,
                &context,
                current.clock_floor_ms - 1
            )
            .err(),
            Some(Error::ClockRegressed)
        );
        assert_eq!(
            dispatch_flight(
                &mut storage,
                expected,
                &current,
                &request,
                &context,
                expires
            )
            .err(),
            Some(Error::InvalidSuccessor)
        );
        let mut current = current;
        for attempt in 1..=MAX_DISPATCHES {
            let token = record::token(&current).unwrap();
            let (request, context) = reconstruct_flight(&current, token, &secret).unwrap();
            let dispatched = dispatch_flight(
                &mut storage,
                token,
                &current,
                &request,
                &context,
                current.clock_floor_ms + 1,
            )
            .unwrap();
            current = dispatched.record().clone();
            assert_eq!(current.flight.as_ref().unwrap().dispatches, attempt);
        }
        let token = record::token(&current).unwrap();
        let (request, context) = reconstruct_flight(&current, token, &secret).unwrap();
        assert_eq!(
            dispatch_flight(
                &mut storage,
                token,
                &current,
                &request,
                &context,
                current.clock_floor_ms + 1
            )
            .err(),
            Some(Error::Limit)
        );
        assert_eq!(
            context.now_ms,
            current.flight.as_ref().unwrap().context_now_ms
        );
        assert!(storage::inspect(&mut storage).unwrap().token() == token);
    }
}

#[test]
fn reconstructed_namespace_success_still_requires_fresh_acceptance() {
    let (current, secret) = prepared(Operation::Namespace);
    let mut storage = Memory::with(&current);
    let token = record::token(&current).unwrap();
    let (request, context) = reconstruct_flight(&current, token, &secret).unwrap();
    let dispatched = dispatch_flight(
        &mut storage,
        token,
        &current,
        &request,
        &context,
        current.clock_floor_ms + 1,
    )
    .unwrap();
    let restored = record::decode(record::encode(dispatched.record()).unwrap().as_bytes()).unwrap();
    let (request, context) = reconstruct_flight(&restored, dispatched.token(), &secret).unwrap();
    let expires = restored.reservation.as_ref().unwrap().expires_at_ms;
    let result = Ok(Success::Namespace {
        reservation: restored.reservation.clone().unwrap(),
        namespace: contract::Namespace {
            namespace_key: contract::Secret32::from_bytes([0x77; 32]).unwrap(),
            receipt: restored.enrollment.as_ref().unwrap().receipt.clone(),
        },
    });
    assert_eq!(
        settle_response(
            &mut storage,
            dispatched.token(),
            &restored,
            &request,
            &context,
            expires,
            &result
        )
        .err(),
        Some(Error::InvalidSuccessor)
    );
    assert!(storage::inspect(&mut storage)
        .unwrap()
        .record()
        .namespace
        .is_none());
}

#[test]
fn abandoned_poll_flight_records_the_loss_and_admits_the_next_prepared_flight() {
    let (current, request, context, _secret) = fixture(Operation::Poll);
    let mut storage = Memory::with(&current);
    let token = record::token(&current).unwrap();
    let prepared = prepare_flight(
        &mut storage,
        token,
        &current,
        &request,
        &context,
        context.now_ms + 1,
    )
    .unwrap();
    let dispatched = dispatch_flight(
        &mut storage,
        prepared.token(),
        prepared.record(),
        &request,
        &context,
        context.now_ms + 2,
    )
    .unwrap();
    let abandoned = abandon_poll_flight(
        &mut storage,
        dispatched.token(),
        dispatched.record(),
        context.now_ms + 3,
    )
    .unwrap();
    // The successor keeps every durable fact and drops only the dead read; the
    // outcome stays explicitly recorded instead of silently retried.
    assert!(abandoned.record().flight.is_none());
    assert_eq!(
        abandoned.record().last_failure,
        Some(LastFailure::OutcomeUnknown)
    );
    assert_eq!(
        abandoned.record().flights_started,
        dispatched.record().flights_started
    );
    assert_eq!(
        abandoned.record().revision,
        dispatched.record().revision + 1
    );
    assert_eq!(abandoned.record().clock_floor_ms, context.now_ms + 3);
    let bytes = record::encode(abandoned.record()).unwrap();
    for canary in [[0x22; 32], [0x33; 32]] {
        assert!(!bytes.as_bytes().windows(32).any(|part| part == canary));
    }
    // The next paced poll prepares a fresh flight on the same attempt.
    let later = Context {
        now_ms: context.now_ms + 5_000,
        ..context.clone()
    };
    let reprepared = prepare_flight(
        &mut storage,
        abandoned.token(),
        abandoned.record(),
        &request,
        &later,
        context.now_ms + 5_000,
    )
    .unwrap();
    let flight = reprepared.record().flight.as_ref().unwrap();
    assert_eq!(flight.operation, Operation::Poll);
    assert_eq!(flight.dispatches, 0);
    assert_eq!(flight.ordinal, reprepared.record().flights_started);
}

#[test]
fn only_a_dispatched_poll_flight_can_be_abandoned() {
    for operation in [
        Operation::Initialize,
        Operation::Confirm,
        Operation::Reserve,
        Operation::Enroll,
        Operation::Namespace,
    ] {
        let (current, request, context, _secret) = fixture(operation);
        let mut storage = Memory::with(&current);
        let token = record::token(&current).unwrap();
        let prepared = prepare_flight(
            &mut storage,
            token,
            &current,
            &request,
            &context,
            context.now_ms + 1,
        )
        .unwrap();
        let dispatched = dispatch_flight(
            &mut storage,
            prepared.token(),
            prepared.record(),
            &request,
            &context,
            context.now_ms + 2,
        )
        .unwrap();
        assert_eq!(
            abandon_poll_flight(
                &mut storage,
                dispatched.token(),
                dispatched.record(),
                context.now_ms + 3
            )
            .err(),
            Some(Error::Conflict),
            "operation {operation:?}"
        );
        assert!(dispatched.record().flight.is_some());
    }
    // An undispatched poll flight was never sent; it stays retained.
    let (current, request, context, _secret) = fixture(Operation::Poll);
    let mut storage = Memory::with(&current);
    let token = record::token(&current).unwrap();
    let prepared = prepare_flight(
        &mut storage,
        token,
        &current,
        &request,
        &context,
        context.now_ms + 1,
    )
    .unwrap();
    assert_eq!(
        abandon_poll_flight(
            &mut storage,
            prepared.token(),
            prepared.record(),
            context.now_ms + 2
        )
        .err(),
        Some(Error::Conflict)
    );
    // No flight at all has nothing to abandon.
    assert_eq!(
        abandon_poll_flight(&mut storage, token, &current, context.now_ms + 2).err(),
        Some(Error::Missing)
    );
    // A regressed observation is not a recovery boundary.
    let (current, request, context, _secret) = fixture(Operation::Poll);
    let mut storage = Memory::with(&current);
    let token = record::token(&current).unwrap();
    let prepared = prepare_flight(
        &mut storage,
        token,
        &current,
        &request,
        &context,
        context.now_ms + 1,
    )
    .unwrap();
    let dispatched = dispatch_flight(
        &mut storage,
        prepared.token(),
        prepared.record(),
        &request,
        &context,
        context.now_ms + 2,
    )
    .unwrap();
    assert_eq!(
        abandon_poll_flight(
            &mut storage,
            dispatched.token(),
            dispatched.record(),
            dispatched.record().clock_floor_ms - 1
        )
        .err(),
        Some(Error::ClockRegressed)
    );
}
