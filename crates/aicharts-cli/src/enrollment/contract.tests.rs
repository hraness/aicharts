use super::*;
use std::sync::OnceLock;

const FIXTURE: &str = include_str!("../../../../fixtures/usage/terminal-enrollment-v1.json");
fn fixture() -> &'static Value {
    static VALUE: OnceLock<Value> = OnceLock::new();
    VALUE.get_or_init(|| serde_json::from_str(FIXTURE).expect("synthetic fixture JSON"))
}
fn sample(name: &str) -> &'static Value {
    fixture()["vectors"]
        .as_array()
        .expect("vectors")
        .iter()
        .find(|value| value["name"].as_str() == Some(name))
        .expect("named synthetic vector")
}
fn context(value: &Value) -> Context {
    let item = object(
        value,
        &[
            "nowMs",
            "initializedExpiresAtMs",
            "confirmedAccountId",
            "reservation",
            "enrollment",
        ],
    )
    .expect("context schema");
    Context {
        now_ms: number(&item["nowMs"]).expect("time"),
        initialized_expires_at_ms: (!item["initializedExpiresAtMs"].is_null())
            .then(|| number(&item["initializedExpiresAtMs"]).expect("expiry")),
        confirmed_account_id: (!item["confirmedAccountId"].is_null())
            .then(|| account(&item["confirmedAccountId"]).expect("account")),
        reservation: (!item["reservation"].is_null())
            .then(|| parse_reservation(&item["reservation"]).expect("reservation")),
        enrollment: (!item["enrollment"].is_null())
            .then(|| parse_enrollment(&item["enrollment"]).expect("enrollment")),
    }
}
fn parts(name: &str) -> (Request, Context, DomainResult) {
    let value = sample(name);
    let request = decode_request(
        value["requestAscii"]
            .as_str()
            .expect("request ASCII")
            .as_bytes(),
    )
    .expect("request");
    let result = parse_domain(request.operation(), &value["result"]).expect("result schema");
    (request, context(&value["context"]), result)
}
fn bytes_from_hex(text: &str) -> Vec<u8> {
    assert!(text.len().is_multiple_of(2));
    text.as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let digit = |byte| match byte {
                b'0'..=b'9' => byte - b'0',
                b'a'..=b'f' => byte - b'a' + 10,
                _ => panic!("fixture hex"),
            };
            digit(pair[0]) * 16 + digit(pair[1])
        })
        .collect()
}
fn refused(request: &Request, context: &Context, result: &DomainResult) {
    assert!(matches!(
        encode_response(request, context, result),
        Err(CodecError::InvalidResponse)
    ));
}
fn mutation(name: &str, change: impl FnOnce(&mut Context, &mut DomainResult)) {
    let (request, mut context, mut result) = parts(name);
    change(&mut context, &mut result);
    refused(&request, &context, &result);
}
fn reservation_mut(result: &mut DomainResult) -> &mut Reservation {
    match result.as_mut().expect("success") {
        Success::Reserved(reservation)
        | Success::Enrolled { reservation, .. }
        | Success::Namespace { reservation, .. } => reservation,
        _ => panic!("reservation result"),
    }
}
fn receipt_mut(result: &mut DomainResult) -> &mut Receipt {
    match result.as_mut().expect("success") {
        Success::Enrolled { enrollment, .. } => &mut enrollment.receipt,
        Success::Namespace { namespace, .. } => &mut namespace.receipt,
        _ => panic!("receipt result"),
    }
}
const OPERATIONS: &[(&str, Operation)] = &[
    ("initialize-success", Operation::Initialize),
    ("poll-success", Operation::Poll),
    ("confirm-success", Operation::Confirm),
    ("reserveEnrollment-success", Operation::Reserve),
    ("enroll-success", Operation::Enroll),
    ("namespaceForEnrollment-success", Operation::Namespace),
];

#[test]
fn frozen_vectors_are_independent_literal_byte_evidence() {
    assert_eq!(
        format!("{:x}", Sha256::digest(FIXTURE.as_bytes())),
        "4220ac9434d518b0e4c3af3283016536b26d97cf1c8bbabddd12cd08df5c46f9"
    );
    let source = fixture();
    assert_eq!(source["schemaVersion"], 1);
    assert_eq!(source["protocol"], "aicharts-terminal-enrollment-v1");
    assert_eq!(source["url"], URL);
    assert_eq!(MEDIA, "application/json; charset=utf-8");
    assert_eq!(source["requestMaxBytes"], MAX_REQUEST_BYTES);
    assert_eq!(source["responseMaxBytes"], MAX_RESPONSE_BYTES);
    assert_eq!(source["times"]["initializedAtMs"], 1_789_300_800_000u64);
    let vectors = source["vectors"].as_array().expect("vectors");
    assert_eq!(vectors.len(), 25);
    for value in vectors {
        let name = value["name"].as_str().expect("name");
        let request_bytes = bytes_from_hex(value["requestHex"].as_str().expect("request hex"));
        let response_bytes = bytes_from_hex(value["responseHex"].as_str().expect("response hex"));
        assert!(
            request_bytes
                == value["requestAscii"]
                    .as_str()
                    .expect("request ASCII")
                    .as_bytes(),
            "{name}"
        );
        assert!(
            response_bytes
                == value["responseAscii"]
                    .as_str()
                    .expect("response ASCII")
                    .as_bytes(),
            "{name}"
        );
        let (request, context, result) = parts(name);
        assert!(
            parse_request(&value["request"]).is_some_and(|owned| owned == request),
            "{name}"
        );
        assert!(
            encode_request(&request)
                .expect("request encoding")
                .as_bytes()
                == request_bytes,
            "{name}"
        );
        let encoded = encode_response(&request, &context, &result);
        let decoded = decode_response(&response_bytes, &request, &context);
        if value["acceptResponse"] == false {
            assert!(
                matches!(encoded, Err(CodecError::InvalidResponse)),
                "{name}"
            );
            assert!(
                matches!(decoded, Err(CodecError::InvalidResponse)),
                "{name}"
            );
        } else {
            assert!(
                encoded.expect("response encoding").as_bytes() == response_bytes,
                "{name}"
            );
            assert!(decoded.expect("response decoding") == result, "{name}");
        }
    }
    let invalid = source["invalidRequests"]
        .as_array()
        .expect("invalid requests");
    assert_eq!(invalid.len(), 5);
    for value in invalid {
        let bytes = bytes_from_hex(value["requestHex"].as_str().expect("request hex"));
        assert!(
            bytes
                == value["requestAscii"]
                    .as_str()
                    .expect("request ASCII")
                    .as_bytes()
        );
        assert!(matches!(
            decode_request(&bytes),
            Err(CodecError::InvalidRequest)
        ));
    }
}

#[test]
fn hashes_bind_ascii_hex_preimages_not_raw_identifier_bytes() {
    for derivation in fixture()["derivations"]
        .as_object()
        .expect("derivations")
        .values()
    {
        assert_eq!(
            format!(
                "{:x}",
                Sha256::digest(derivation["ascii"].as_str().expect("preimage").as_bytes())
            ),
            derivation["sha256"].as_str().expect("digest")
        );
    }
    let (request, context, result) = parts("reserveEnrollment-success");
    let proof = request.proof();
    assert!(
        commitment(b"poll", &proof.intent_id, &proof.poll_secret)
            == id(&fixture()["derivations"]["pollCommitment"]["sha256"]).expect("poll commitment")
    );
    assert!(
        request.upload_commitment()
            == Some(
                id(&fixture()["derivations"]["uploadCommitment"]["sha256"])
                    .expect("upload commitment")
            )
    );
    let reservation = match result {
        Ok(Success::Reserved(value)) => value,
        _ => panic!("reservation"),
    };
    assert!(
        device_id(&reservation)
            == id(&fixture()["derivations"]["deviceId"]["sha256"]).expect("device")
    );
    let mut digest = Sha256::new();
    digest.update(b"aicharts:pairing:v1\0poll\0");
    digest.update(proof.intent_id);
    digest.update(b"\0");
    digest.update(proof.poll_secret.as_bytes());
    let mut altered = reservation;
    altered.poll_commitment = digest.finalize().into();
    refused(&request, &context, &Ok(Success::Reserved(altered)));
}

#[test]
fn typed_requests_reject_zero_accounts_reused_secrets_and_commitment_domains() {
    for (name, _) in OPERATIONS {
        let (mut request, _, _) = parts(name);
        let proof = match &mut request {
            Request::Initialize { proof, .. }
            | Request::Poll(proof)
            | Request::Confirm { proof, .. } => proof,
            Request::Reserve(proof) | Request::Enroll(proof) | Request::Namespace(proof) => {
                &mut proof.pairing
            }
        };
        proof.intent_id = [0; 32];
        assert!(matches!(
            encode_request(&request),
            Err(CodecError::InvalidRequest)
        ));
    }
    for role in [b"poll".as_slice(), b"upload"] {
        let (mut request, _, _) = parts("initialize-success");
        if let Request::Initialize {
            proof,
            upload_commitment,
        } = &mut request
        {
            *upload_commitment = commitment(role, &proof.intent_id, &proof.poll_secret);
        }
        assert!(encode_request(&request).is_err());
    }
    for name in [
        "reserveEnrollment-success",
        "enroll-success",
        "namespaceForEnrollment-success",
    ] {
        let (mut request, _, _) = parts(name);
        if let Request::Reserve(proof) | Request::Enroll(proof) | Request::Namespace(proof) =
            &mut request
        {
            proof.upload_secret = Secret32(*proof.pairing.poll_secret.as_bytes());
        }
        assert!(encode_request(&request).is_err());
    }
    let (mut request, _, _) = parts("confirm-success");
    if let Request::Confirm { account_id, .. } = &mut request {
        *account_id = [0; 16];
    }
    assert!(encode_request(&request).is_err());
    assert!(Secret32::from_bytes([0; 32]).is_none());
}

#[test]
fn wire_spelling_duplicates_unknown_fields_and_bounds_are_closed() {
    for (name, _) in OPERATIONS {
        let source = sample(name);
        let (request, context, _) = parts(name);
        for (field, response) in [("requestAscii", false), ("responseAscii", true)] {
            let original = source[field].as_str().expect("ASCII");
            let changed = [
                format!(" {original}"),
                format!("{original}\n"),
                format!("\u{feff}{original}"),
                original.replacen(
                    "\"schemaVersion\":1",
                    "\"schemaVersion\":1,\"schemaVersion\":1",
                    1,
                ),
                original.replacen("\"schemaVersion\":1", "\"schemaVersion\":1.0", 1),
                original.replacen("\"schemaVersion\":1", "\"schemaVersion\":1e0", 1),
                original.replacen("\"schemaVersion\":1", "\"schemaVersion\":-0", 1),
                original.replacen(
                    "\"schemaVersion\":1",
                    "\"schemaVersion\":1,\"extra\":null",
                    1,
                ),
                original.replacen("\"schemaVersion\"", "\"\\u0073chemaVersion\"", 1),
                original.replacen("\"operation\":", "\"OPERATION\":", 1),
                original.replacen("11111111", "AAAAAAAA", 1),
                original.replacen("\"intentId\":", "\"constructor\":", 1),
            ];
            for bytes in changed {
                if response {
                    assert!(decode_response(bytes.as_bytes(), &request, &context).is_err());
                } else {
                    assert!(decode_request(bytes.as_bytes()).is_err());
                }
            }
            for end in 0..original.len() {
                if response {
                    assert!(
                        decode_response(&original.as_bytes()[..end], &request, &context).is_err()
                    );
                } else {
                    assert!(decode_request(&original.as_bytes()[..end]).is_err());
                }
            }
        }
        for bytes in [
            vec![],
            vec![b' '; MAX_RESPONSE_BYTES + 1],
            vec![255],
            b"null".to_vec(),
            b"[]".to_vec(),
        ] {
            assert!(decode_request(&bytes).is_err());
            assert!(decode_response(&bytes, &request, &context).is_err());
        }
        assert!(decode_request(&vec![b' '; MAX_REQUEST_BYTES + 1]).is_err());
        let nested = format!("{}0{}", "[".repeat(300), "]".repeat(300));
        assert!(decode_request(nested.as_bytes()).is_err());
    }
}

#[test]
fn exact_envelope_and_nested_response_identity_cannot_be_substituted() {
    let (request, context, _) = parts("namespaceForEnrollment-success");
    let original = sample("namespaceForEnrollment-success")["responseAscii"]
        .as_str()
        .expect("ASCII");
    for changed in [
        original.replacen("\"namespaceForEnrollment\"", "\"enroll\"", 1),
        original.replacen(&"11".repeat(32), &"88".repeat(32), 1),
        original.replace(&"66".repeat(16), &"88".repeat(16)),
        original.replace(&"44".repeat(32), &"88".repeat(32)),
        original.replace(&"55".repeat(32), &"88".repeat(32)),
        original.replace(&"77".repeat(32), &"00".repeat(32)),
        original.replace("\"namespaceVersion\":1", "\"namespaceVersion\":2"),
        original.replacen("\"result\":{", "\"result\":{\"extra\":0,", 1),
        original.replacen("\"namespaceKey\":", "\"uploadSecret\":", 1),
    ] {
        assert!(decode_response(changed.as_bytes(), &request, &context).is_err());
    }
    mutation("confirm-success", |_, result| {
        if let Ok(Success::Pairing(view)) = result {
            view.approved_account_id = Some([0x88; 16]);
        }
    });
    mutation("poll-browser-approved", |context, _| {
        context.confirmed_account_id = Some([0x88; 16]);
    });
    mutation("poll-success", |_, result| {
        if let Ok(Success::Pairing(view)) = result {
            view.poll_after_ms = 4_999;
        }
    });
    mutation("poll-success", |_, result| {
        if let Ok(Success::Pairing(view)) = result {
            view.approved_account_id = Some([0x66; 16]);
        }
    });
}

#[test]
fn reservation_lifetime_proof_and_generation_match_retained_evidence() {
    for selector in 0..10 {
        mutation("reserveEnrollment-success", |context, result| {
            let initialized = context.initialized_expires_at_ms.expect("initialized");
            let reservation = reservation_mut(result);
            match selector {
                0 => reservation.intent_id = [0x88; 32],
                1 => reservation.account_id = [0x88; 16],
                2 => reservation.reservation_id = [0; 32],
                3 => reservation.recovery_generation = [0; 32],
                4 => reservation.poll_commitment = [0x88; 32],
                5 => reservation.upload_commitment = reservation.poll_commitment,
                6 => reservation.reserved_at_ms = initialized - TTL_MS - 1,
                7 => reservation.reserved_at_ms = context.now_ms + 1,
                8 => reservation.expires_at_ms = initialized + 1,
                9 => reservation.expires_at_ms = reservation.reserved_at_ms,
                _ => unreachable!(),
            }
        });
    }
    for name in [
        "reserve-expired-readback",
        "enroll-success",
        "namespaceForEnrollment-success",
    ] {
        for selector in 0..4 {
            mutation(name, |_, result| {
                let reservation = reservation_mut(result);
                match selector {
                    0 => reservation.reservation_id = [0x88; 32],
                    1 => reservation.recovery_generation = [0x88; 32],
                    2 => reservation.reserved_at_ms += 1,
                    3 => reservation.expires_at_ms -= 1,
                    _ => unreachable!(),
                }
            });
        }
    }
}

#[test]
fn receipt_derivation_commit_time_and_replays_are_immutable() {
    for name in ["enroll-success", "namespaceForEnrollment-success"] {
        for selector in 0..8 {
            mutation(name, |context, result| {
                let reservation = context.reservation.as_ref().expect("reservation");
                let receipt = receipt_mut(result);
                match selector {
                    0 => receipt.account_id = [0x88; 16],
                    1 => receipt.intent_id = [0x88; 32],
                    2 => receipt.reservation_id = [0x88; 32],
                    3 => receipt.device_id = [0x88; 32],
                    4 => receipt.enrolled_at_ms = reservation.reserved_at_ms - 1,
                    5 => receipt.enrolled_at_ms = reservation.expires_at_ms,
                    6 => receipt.enrolled_at_ms = context.now_ms + 1,
                    7 => receipt.enrolled_at_ms = MAX_TIME_MS + 1,
                    _ => unreachable!(),
                }
            });
        }
    }
    mutation("enroll-expired-readback", |_, result| {
        receipt_mut(result).enrolled_at_ms += 1;
    });
    mutation("namespaceForEnrollment-success", |_, result| {
        receipt_mut(result).enrolled_at_ms -= 1;
    });
}

#[test]
fn context_requires_prior_facts_even_for_failure_bodies() {
    for (name, operation) in OPERATIONS {
        let (request, context, result) = parts(name);
        let error = Err(DomainError::StorageInvalid);
        let mut invalid = context.clone();
        invalid.now_ms = MAX_TIME_MS + 1;
        refused(&request, &invalid, &result);
        refused(&request, &invalid, &error);
        if *operation != Operation::Initialize {
            let mut invalid = context.clone();
            invalid.initialized_expires_at_ms = None;
            refused(&request, &invalid, &result);
            refused(&request, &invalid, &error);
            let mut invalid = context.clone();
            invalid.now_ms = invalid.initialized_expires_at_ms.expect("expiry") - TTL_MS - 1;
            refused(&request, &invalid, &error);
        }
        if matches!(
            operation,
            Operation::Reserve | Operation::Enroll | Operation::Namespace
        ) {
            let mut invalid = context.clone();
            invalid.confirmed_account_id = None;
            refused(&request, &invalid, &error);
            let mut invalid = context.clone();
            invalid.confirmed_account_id = Some([0; 16]);
            refused(&request, &invalid, &error);
        }
        if matches!(operation, Operation::Enroll | Operation::Namespace) {
            let mut invalid = context.clone();
            invalid.reservation = None;
            refused(&request, &invalid, &error);
        }
        if *operation == Operation::Namespace {
            let mut invalid = context;
            invalid.enrollment = None;
            refused(&request, &invalid, &error);
        }
    }
    mutation("confirm-success", |context, _| {
        context.confirmed_account_id = Some([0x88; 16]);
    });
    mutation("initialize-success", |context, _| {
        context.confirmed_account_id = Some([0x66; 16]);
    });
    mutation("initialize-success", |_, result| {
        *result = Ok(Success::Initialized {
            expires_at_ms: TTL_MS - 1,
        });
    });
}

#[test]
fn expired_observations_never_renew_live_namespace_or_confirmation() {
    for name in [
        "initialize-expired-readback",
        "reserve-expired-readback",
        "enroll-expired-readback",
        "enroll-retained-revocation",
    ] {
        let (request, context, result) = parts(name);
        assert!(context.now_ms >= context.initialized_expires_at_ms.expect("expiry"));
        assert!(encode_response(&request, &context, &result).is_ok());
    }
    for name in ["namespaceForEnrollment-success", "confirm-success"] {
        let (request, mut context, result) = parts(name);
        context.now_ms = context.initialized_expires_at_ms.expect("expiry");
        refused(&request, &context, &result);
        let error = Err(DomainError::Expired);
        let bytes = encode_response(&request, &context, &error).expect("domain observation");
        assert!(
            decode_response(bytes.as_bytes(), &request, &context).expect("decoded observation")
                == error
        );
    }
    let (request, mut context, _) = parts("namespaceForEnrollment-success");
    context
        .enrollment
        .as_mut()
        .expect("enrollment")
        .device_state = DeviceState::Revoked;
    let bytes = encode_response(&request, &context, &Err(DomainError::Revoked))
        .expect("revoked observation");
    assert!(matches!(
        decode_response(bytes.as_bytes(), &request, &context),
        Ok(Err(DomainError::Revoked))
    ));
    mutation("enroll-retained-revocation", |_, result| {
        if let Ok(Success::Enrolled { enrollment, .. }) = result {
            enrollment.device_state = DeviceState::Active;
        }
    });
}

#[test]
fn domain_errors_have_independent_exact_operation_allowlists() {
    let names = [
        "invalid_input",
        "storage_invalid",
        "clock_regressed",
        "conflict",
        "not_initialized",
        "unauthorized",
        "expired",
        "throttled",
        "invalid_transition",
        "authentication_not_fresh",
        "recovery_required",
        "unavailable",
        "not_reserved",
        "not_enrolled",
        "revoked",
        "storage_unavailable",
        "limit",
    ];
    // Index sets are literal expectations, separate from the production match.
    let accepted: [&[usize]; 6] = [
        &[0, 1, 2, 3],
        &[0, 1, 2, 4, 5, 6, 7],
        &[0, 1, 2, 4, 5, 6, 8, 9],
        &[0, 1, 2, 4, 5, 6, 8, 10],
        &[0, 1, 2, 3, 5, 6, 10, 11, 12, 13, 14, 15, 16],
        &[0, 1, 2, 3, 5, 6, 10, 11, 12, 13, 14, 15, 16],
    ];
    for (index, (name, _)) in OPERATIONS.iter().enumerate() {
        let (request, context, _) = parts(name);
        for (error_index, name) in names.iter().enumerate() {
            let error =
                DomainError::parse(&Value::String((*name).into())).expect("fixed domain error");
            let encoded = encode_response(&request, &context, &Err(error));
            if accepted[index].contains(&error_index) {
                let bytes = encoded.expect("allowed error");
                assert!(
                    matches!(decode_response(bytes.as_bytes(), &request, &context), Ok(Err(decoded)) if decoded == error)
                );
            } else {
                assert!(encoded.is_err());
            }
        }
        let raw = sample(name)["responseAscii"].as_str().expect("ASCII");
        let prefix = raw.split_once("\"result\":").expect("result separator").0;
        for result in [
            "{\"ok\":false,\"error\":\"PRIVATE_CANARY\"}",
            "{\"ok\":true,\"error\":\"expired\"}",
            "{\"ok\":false,\"error\":\"expired\",\"details\":\"PRIVATE_CANARY\"}",
        ] {
            assert!(decode_response(
                format!("{prefix}\"result\":{result}}}").as_bytes(),
                &request,
                &context
            )
            .is_err());
        }
    }
}

#[test]
fn unsigned_time_extremes_and_success_variants_stay_bounded() {
    let (request, mut context, _) = parts("initialize-success");
    context.now_ms = 0;
    assert!(encode_response(
        &request,
        &context,
        &Ok(Success::Initialized {
            expires_at_ms: TTL_MS
        })
    )
    .is_ok());
    refused(
        &request,
        &context,
        &Ok(Success::Initialized {
            expires_at_ms: TTL_MS + 1,
        }),
    );
    context.now_ms = MAX_TIME_MS;
    assert!(encode_response(
        &request,
        &context,
        &Ok(Success::Initialized {
            expires_at_ms: MAX_TIME_MS
        })
    )
    .is_ok());
    refused(
        &request,
        &context,
        &Ok(Success::Initialized {
            expires_at_ms: MAX_TIME_MS + 1,
        }),
    );
    let (poll, context, _) = parts("poll-success");
    refused(
        &poll,
        &context,
        &Ok(Success::Initialized {
            expires_at_ms: MAX_TIME_MS,
        }),
    );
    let raw = sample("confirm-success")["responseAscii"]
        .as_str()
        .expect("ASCII");
    let (request, context, _) = parts("confirm-success");
    for spelling in [
        "-0",
        "-1",
        "0.0",
        "0e0",
        "9007199254740992",
        "18446744073709551616",
    ] {
        let changed = raw.replacen(
            "\"pollAfterMs\":0",
            &format!("\"pollAfterMs\":{spelling}"),
            1,
        );
        assert_ne!(changed, raw);
        assert!(decode_response(changed.as_bytes(), &request, &context).is_err());
    }
}

#[test]
fn secret_bearing_types_do_not_implement_debug_or_clone() {
    // Inference is ambiguous (and compilation fails) if a guarded type acquires
    // the trait. This avoids new assertion dependencies or runtime secret logs.
    trait AmbiguousDebug<A> {
        fn marker() {}
    }
    impl<T: ?Sized> AmbiguousDebug<()> for T {}
    impl<T: ?Sized + std::fmt::Debug> AmbiguousDebug<u8> for T {}
    trait AmbiguousClone<A> {
        fn marker() {}
    }
    impl<T: ?Sized> AmbiguousClone<()> for T {}
    impl<T: Clone> AmbiguousClone<u8> for T {}
    macro_rules! guarded { ($($kind:ty),+) => { $(
        let _ = <$kind as AmbiguousDebug<_>>::marker;
        let _ = <$kind as AmbiguousClone<_>>::marker;
    )+ }; }
    guarded!(
        Secret32,
        PollProof,
        EnrollmentProof,
        Request,
        Namespace,
        Success,
        DomainResult,
        WireBytes
    );
}
