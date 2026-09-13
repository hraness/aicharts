use super::{
    disk, record,
    record_tests::{copy, initial_record, namespace_flow},
    storage::Candidate,
    Error, MAX_RECORD_BYTES,
};
use sha2::{Digest, Sha256};

fn candidate(previous: Option<&record::Record>, next: &record::Record) -> Candidate {
    Candidate {
        expected: previous.map(|value| record::token(value).unwrap()),
        next: record::token(next).unwrap(),
        bytes: record::encode(next).unwrap(),
    }
}
fn checksum(bytes: &mut [u8]) {
    let end = bytes.len() - 32;
    let mut hash = Sha256::new();
    hash.update(b"aicharts:enrollment-attempt-file:v1\0");
    hash.update(&bytes[..end]);
    bytes[end..].copy_from_slice(&hash.finalize());
}

#[test]
fn independent_header_and_hash_oracle_preserve_the_exact_canonical_payload() {
    let initial = initial_record();
    let candidate = candidate(None, &initial);
    let encoded = disk::encode(&candidate).unwrap();
    // This header is authored from the file contract, not the file encoder.
    let mut header = [0u8; 64];
    header[0..8].copy_from_slice(&[0x41, 0x49, 0x41, 0x54, 1, 0, 0, 0]);
    header[56..60].copy_from_slice(&(candidate.bytes.as_bytes().len() as u32).to_le_bytes());
    let mut oracle = header.to_vec();
    oracle.extend_from_slice(candidate.bytes.as_bytes());
    let mut hash = Sha256::new();
    hash.update(b"aicharts:enrollment-attempt-file:v1\0");
    hash.update(&oracle);
    oracle.extend_from_slice(&hash.finalize());
    assert_eq!(encoded, oracle);
    let decoded = disk::decode(&oracle).unwrap();
    assert!(decoded.matches(&candidate));
    assert!(decoded.expected.is_none());
    assert_eq!(decoded.bytes.as_bytes(), candidate.bytes.as_bytes());
    assert_eq!(disk::MAX_BYTES, 4_192);
}

#[test]
fn successor_envelope_preserves_expected_token_as_comparison_facts_only() {
    let previous = initial_record();
    let mut next = copy(&previous);
    next.revision = 1;
    next.progress = record::Progress::PairingPrepared;
    let candidate = candidate(Some(&previous), &next);
    let encoded = disk::encode(&candidate).unwrap();
    assert_eq!(encoded[8], 1);
    assert_eq!(&encoded[16..24], &0u64.to_le_bytes());
    assert_eq!(&encoded[24..56], record::token(&previous).unwrap().digest());
    let decoded = disk::decode(&encoded).unwrap();
    assert!(decoded.matches(&candidate));
    assert!(decoded
        .expected
        .unwrap()
        .matches(record::token(&previous).unwrap()));
    let mut another = copy(&previous);
    another.clock_floor_ms += 1;
    assert!(!decoded
        .expected
        .unwrap()
        .matches(record::token(&another).unwrap()));
    assert!(!decoded.expected.unwrap().matches(candidate.next));
    let mut wrong_next = candidate.clone();
    wrong_next.next = record::token(&another).unwrap();
    assert_eq!(
        disk::encode(&wrong_next).err(),
        Some(Error::RecoveryRequired)
    );
}

#[test]
fn every_truncation_extension_and_single_byte_corruption_is_refused() {
    let valid = disk::encode(&candidate(None, &initial_record())).unwrap();
    for end in 0..valid.len() {
        assert_eq!(
            disk::decode(&valid[..end]).err(),
            Some(Error::RecoveryRequired)
        );
    }
    for index in 0..valid.len() {
        let mut bytes = valid.clone();
        bytes[index] ^= 1;
        assert_eq!(disk::decode(&bytes).err(), Some(Error::RecoveryRequired));
    }
    let mut appended = valid.clone();
    appended.push(0);
    assert_eq!(disk::decode(&appended).err(), Some(Error::RecoveryRequired));
    assert_eq!(
        disk::decode(&vec![0; disk::MAX_BYTES + 1]).err(),
        Some(Error::RecoveryRequired)
    );
}

#[test]
fn recomputed_checksums_cannot_relax_magic_reserved_fields_or_revision_rules() {
    let valid = disk::encode(&candidate(None, &initial_record())).unwrap();
    for index in (0..8).chain(9..16).chain(16..56).chain(60..64) {
        let mut bytes = valid.clone();
        bytes[index] ^= 1;
        checksum(&mut bytes);
        assert_eq!(disk::decode(&bytes).err(), Some(Error::RecoveryRequired));
    }
    for flag in [1, 2, 255] {
        let mut bytes = valid.clone();
        bytes[8] = flag;
        checksum(&mut bytes);
        assert_eq!(disk::decode(&bytes).err(), Some(Error::RecoveryRequired));
    }
    let flow = namespace_flow();
    let successor = disk::encode(&candidate(Some(&flow[2]), &flow[3])).unwrap();
    for revision in [0, 19, 22, 1_024, u64::MAX] {
        let mut bytes = successor.clone();
        bytes[16..24].copy_from_slice(&revision.to_le_bytes());
        checksum(&mut bytes);
        assert_eq!(disk::decode(&bytes).err(), Some(Error::RecoveryRequired));
    }
    let mut missing = successor;
    missing[8] = 0;
    missing[16..56].fill(0);
    checksum(&mut missing);
    assert_eq!(disk::decode(&missing).err(), Some(Error::RecoveryRequired));
}

#[test]
fn valid_checksums_do_not_admit_noncanonical_or_unbounded_payloads() {
    let valid = disk::encode(&candidate(None, &initial_record())).unwrap();
    let payload = &valid[64..valid.len() - 32];
    let mut alternatives = vec![Vec::new(), vec![b' '; MAX_RECORD_BYTES + 1]];
    let mut whitespace = payload.to_vec();
    whitespace.push(b' ');
    alternatives.push(whitespace);
    let mut bom = vec![0xef, 0xbb, 0xbf];
    bom.extend_from_slice(payload);
    alternatives.push(bom);
    let text = std::str::from_utf8(payload).unwrap();
    alternatives.push(
        text.replacen("\"revision\":0", "\"revision\":-0", 1)
            .into_bytes(),
    );
    alternatives.push(
        text.replacen(
            "\"schemaVersion\":1",
            "\"schemaVersion\":1,\"schemaVersion\":1",
            1,
        )
        .into_bytes(),
    );
    for payload in alternatives {
        let mut bytes = valid[..64].to_vec();
        bytes[56..60].copy_from_slice(&(payload.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&payload);
        bytes.extend_from_slice(&[0; 32]);
        checksum(&mut bytes);
        assert_eq!(disk::decode(&bytes).err(), Some(Error::RecoveryRequired));
    }
    for declared in [0u32, 1, MAX_RECORD_BYTES as u32, u32::MAX] {
        let mut bytes = valid.clone();
        bytes[56..60].copy_from_slice(&declared.to_le_bytes());
        checksum(&mut bytes);
        assert_eq!(disk::decode(&bytes).err(), Some(Error::RecoveryRequired));
    }
}

#[test]
fn retained_namespace_flight_roundtrip_never_adds_secret_or_wire_material() {
    let flow = namespace_flow();
    for pair in flow.windows(2) {
        let candidate = candidate(Some(&pair[0]), &pair[1]);
        let bytes = disk::encode(&candidate).unwrap();
        assert!(disk::decode(&bytes).unwrap().matches(&candidate));
        assert!(bytes.len() <= disk::MAX_BYTES);
        for canary in [0x22, 0x33, 0x77] {
            assert!(!bytes.windows(32).any(|window| window == [canary; 32]));
        }
        for field in [
            b"pollSecret".as_slice(),
            b"uploadSecret",
            b"namespaceKey",
            b"requestBody",
            b"responseBody",
        ] {
            assert!(!bytes.windows(field.len()).any(|window| window == field));
        }
    }
}
