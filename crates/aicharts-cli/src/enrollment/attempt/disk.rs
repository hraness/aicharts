//! Private attempt-file framing. The unchanged canonical JSON is the payload;
//! predecessor observations survive restart without constructing a Token.

use super::{
    record::{self, CanonicalBytes, Token},
    storage::Candidate,
    Error, Result, MAX_RECORD_BYTES, MAX_REVISION,
};
use sha2::{Digest, Sha256};

const HEADER: usize = 64;
const TRAILER: usize = 32;
pub(super) const MAX_BYTES: usize = HEADER + MAX_RECORD_BYTES + TRAILER;

/// Unauthenticated disk facts. Compare with an existing token through getters;
/// this type cannot manufacture a core token or durable observation.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct Predecessor {
    revision: u64,
    digest: [u8; 32],
}
impl Predecessor {
    fn from_token(token: Token) -> Self {
        Self {
            revision: token.revision(),
            digest: *token.digest(),
        }
    }
    pub(super) fn matches(self, token: Token) -> bool {
        self.revision == token.revision() && self.digest == *token.digest()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub(super) struct Decoded {
    pub(super) expected: Option<Predecessor>,
    pub(super) next: Token,
    pub(super) bytes: CanonicalBytes,
}
impl Decoded {
    pub(super) fn matches(&self, candidate: &Candidate) -> bool {
        self.expected == candidate.expected.map(Predecessor::from_token)
            && self.next == candidate.next
            && self.bytes == candidate.bytes
    }
}

fn digest(bytes: &[u8]) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"aicharts:enrollment-attempt-file:v1\0");
    hash.update(bytes);
    hash.finalize().into()
}

fn checked(expected: Option<Predecessor>, bytes: &[u8]) -> Result<Decoded> {
    let value = record::decode(bytes).map_err(|_| Error::RecoveryRequired)?;
    let next = record::token(&value).map_err(|_| Error::RecoveryRequired)?;
    match expected {
        None => record::initial(&value).map_err(|_| Error::RecoveryRequired)?,
        Some(previous)
            if previous.revision < MAX_REVISION && previous.revision + 1 == next.revision() =>
        {
            // The revision transition is valid; continue with canonicalization.
        }
        _ => return Err(Error::RecoveryRequired),
    }
    Ok(Decoded {
        expected,
        next,
        bytes: record::encode(&value).map_err(|_| Error::RecoveryRequired)?,
    })
}

pub(super) fn encode(candidate: &Candidate) -> Result<Vec<u8>> {
    let checked = checked(
        candidate.expected.map(Predecessor::from_token),
        candidate.bytes.as_bytes(),
    )?;
    if checked.next != candidate.next {
        return Err(Error::RecoveryRequired);
    }
    let mut bytes = vec![0; HEADER];
    bytes[..4].copy_from_slice(b"AIAT");
    bytes[4..6].copy_from_slice(&1u16.to_le_bytes());
    if let Some(expected) = candidate.expected {
        bytes[8] = 1;
        bytes[16..24].copy_from_slice(&expected.revision().to_le_bytes());
        bytes[24..56].copy_from_slice(expected.digest());
    }
    bytes[56..60].copy_from_slice(&(checked.bytes.as_bytes().len() as u32).to_le_bytes());
    bytes.extend_from_slice(checked.bytes.as_bytes());
    bytes.extend_from_slice(&digest(&bytes));
    Ok(bytes)
}

pub(super) fn decode(bytes: &[u8]) -> Result<Decoded> {
    if bytes.len() < HEADER + 1 + TRAILER
        || bytes.len() > MAX_BYTES
        || &bytes[..4] != b"AIAT"
        || bytes[4..6] != 1u16.to_le_bytes()
        || bytes[6..8] != [0; 2]
        || bytes[9..16] != [0; 7]
        || bytes[60..64] != [0; 4]
    {
        return Err(Error::RecoveryRequired);
    }
    let length = u32::from_le_bytes(bytes[56..60].try_into().unwrap()) as usize;
    if length > MAX_RECORD_BYTES
        || bytes.len() != HEADER + length + TRAILER
        || digest(&bytes[..bytes.len() - TRAILER]) != bytes[bytes.len() - TRAILER..]
    {
        return Err(Error::RecoveryRequired);
    }
    let expected = match bytes[8] {
        0 if bytes[16..56] == [0; 40] => None,
        1 => Some(Predecessor {
            revision: u64::from_le_bytes(bytes[16..24].try_into().unwrap()),
            digest: bytes[24..56].try_into().unwrap(),
        }),
        _ => return Err(Error::RecoveryRequired),
    };
    checked(expected, &bytes[HEADER..HEADER + length])
}
