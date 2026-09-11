//! Private disk framing. It preserves the original expected token across a
//! restart without changing the canonical AICF manifest or any network format.
use super::super::{codec, engine::Candidate, Error, ManifestToken, Result, MAX_MANIFEST_BYTES};
use sha2::{Digest, Sha256};

const HEADER: usize = 64;
const TRAILER: usize = 32;
pub(super) const MAX_BYTES: usize = HEADER + MAX_MANIFEST_BYTES + TRAILER;

fn digest(bytes: &[u8]) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"aicharts:credential-reference-file:v1\0");
    hash.update(bytes);
    hash.finalize().into()
}

fn validate(candidate: &Candidate) -> Result<()> {
    let value = codec::decode(&candidate.bytes).map_err(|_| Error::RecoveryRequired)?;
    if codec::encode(&value) != candidate.bytes {
        return Err(Error::RecoveryRequired);
    }
    match candidate.expected {
        None if value.revision == 0 && value.entries.is_empty() => Ok(()),
        Some(previous) if previous.revision.checked_add(1) == Some(value.revision) => Ok(()),
        _ => Err(Error::RecoveryRequired),
    }
}

pub(super) fn encode(candidate: &Candidate) -> Result<Vec<u8>> {
    validate(candidate)?;
    let mut bytes = vec![0; HEADER];
    bytes[..4].copy_from_slice(b"AICM");
    bytes[4..6].copy_from_slice(&1u16.to_le_bytes());
    if let Some(expected) = candidate.expected {
        bytes[8] = 1;
        bytes[16..24].copy_from_slice(&expected.revision.to_le_bytes());
        bytes[24..56].copy_from_slice(&expected.digest);
    }
    bytes[56..60].copy_from_slice(&(candidate.bytes.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&candidate.bytes);
    bytes.extend_from_slice(&digest(&bytes));
    Ok(bytes)
}

pub(super) fn decode(bytes: &[u8]) -> Result<Candidate> {
    if bytes.len() < HEADER + 96 + TRAILER
        || bytes.len() > MAX_BYTES
        || &bytes[..4] != b"AICM"
        || bytes[4..6] != 1u16.to_le_bytes()
        || bytes[6..8] != [0; 2]
        || bytes[9..16] != [0; 7]
        || bytes[60..64] != [0; 4]
    {
        return Err(Error::RecoveryRequired);
    }
    let length = u32::from_le_bytes(bytes[56..60].try_into().unwrap()) as usize;
    if length > MAX_MANIFEST_BYTES
        || bytes.len() != HEADER + length + TRAILER
        || digest(&bytes[..bytes.len() - TRAILER]) != bytes[bytes.len() - TRAILER..]
    {
        return Err(Error::RecoveryRequired);
    }
    let expected = match bytes[8] {
        0 if bytes[16..56] == [0; 40] => None,
        1 => Some(ManifestToken {
            revision: u64::from_le_bytes(bytes[16..24].try_into().unwrap()),
            digest: bytes[24..56].try_into().unwrap(),
        }),
        _ => return Err(Error::RecoveryRequired),
    };
    let candidate = Candidate {
        expected,
        bytes: bytes[HEADER..HEADER + length].to_vec(),
    };
    validate(&candidate)?;
    Ok(candidate)
}
