use super::{Error, ManifestSnapshot, RecordIntent, ReferenceEntry, ReferenceState, Result};
use crate::{CredentialRef, NamespaceBinding, Purpose, RecordIdentity};
use sha2::{Digest, Sha256};

const HEADER: usize = 64;
const ENTRY: usize = 160;

fn checksum(bytes: &[u8]) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"aicharts:credential-manifest:v1\0");
    hash.update(bytes);
    hash.finalize().into()
}

pub(super) fn encode(value: &ManifestSnapshot) -> Vec<u8> {
    let mut bytes = vec![0; HEADER + value.entries.len() * ENTRY];
    bytes[..4].copy_from_slice(b"AICF");
    bytes[4..6].copy_from_slice(&1u16.to_le_bytes());
    bytes[8..40].copy_from_slice(&value.installation);
    bytes[40..48].copy_from_slice(&value.revision.to_le_bytes());
    bytes[48..50].copy_from_slice(&(value.entries.len() as u16).to_le_bytes());
    for (entry, out) in value
        .entries
        .iter()
        .zip(bytes[HEADER..].chunks_exact_mut(ENTRY))
    {
        let identity = &entry.intent.identity;
        out[0] = identity.reference().purpose() as u8;
        out[1] = match entry.state {
            ReferenceState::Prepared => 1,
            ReferenceState::CustodyVerified => 2,
        };
        out[8..40].copy_from_slice(identity.reference().item_id());
        if let Some(intent) = identity.intent_id() {
            out[40..72].copy_from_slice(intent);
        }
        if let Some(binding) = identity.namespace_binding() {
            out[72..88].copy_from_slice(binding.account_id());
            out[88..120].copy_from_slice(binding.recovery_generation());
            out[120..122].copy_from_slice(&binding.namespace_version().to_le_bytes());
        }
        out[128..160].copy_from_slice(&entry.intent.commitment);
    }
    let tail = checksum(&bytes);
    bytes.extend_from_slice(&tail);
    bytes
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn decode(bytes: &[u8]) -> Result<ManifestSnapshot> {
    if bytes.len() < HEADER + 32
        || bytes.len() > super::MAX_MANIFEST_BYTES
        || &bytes[..4] != b"AICF"
        || bytes[4..6] != 1u16.to_le_bytes()
        || bytes[6..8] != [0; 2]
        || bytes[50..64] != [0; 14]
    {
        return Err(Error::InvalidManifest);
    }
    let count = u16::from_le_bytes(bytes[48..50].try_into().unwrap()) as usize;
    if count > super::MAX_ENTRIES
        || bytes.len() != HEADER + count * ENTRY + 32
        || checksum(&bytes[..bytes.len() - 32]) != bytes[bytes.len() - 32..]
    {
        return Err(Error::InvalidManifest);
    }
    let installation = bytes[8..40].try_into().unwrap();
    if installation == [0; 32] {
        return Err(Error::InvalidManifest);
    }
    let revision = u64::from_le_bytes(bytes[40..48].try_into().unwrap());
    let mut entries = Vec::with_capacity(count);
    let mut previous = None;
    let mut prepared = 0;
    for raw in bytes[HEADER..bytes.len() - 32].chunks_exact(ENTRY) {
        if raw[2..8] != [0; 6] || raw[122..128] != [0; 6] {
            return Err(Error::InvalidManifest);
        }
        let purpose = match raw[0] {
            1 => Purpose::Checkpoint,
            2 => Purpose::Pairing,
            3 => Purpose::Namespace,
            _ => return Err(Error::InvalidManifest),
        };
        let state = match raw[1] {
            1 => {
                prepared += 1;
                ReferenceState::Prepared
            }
            2 => ReferenceState::CustodyVerified,
            _ => return Err(Error::InvalidManifest),
        };
        let item = raw[8..40].try_into().unwrap();
        if previous.is_some_and(|prev| prev >= item) {
            return Err(Error::InvalidManifest);
        }
        previous = Some(item);
        let reference =
            CredentialRef::new(installation, item, purpose).map_err(|_| Error::InvalidManifest)?;
        let identity = match purpose {
            Purpose::Checkpoint if raw[40..122] == [0; 82] => RecordIdentity::checkpoint(reference),
            Purpose::Pairing if raw[72..122] == [0; 50] => {
                RecordIdentity::pairing(reference, raw[40..72].try_into().unwrap())
            }
            Purpose::Namespace if raw[40..72] == [0; 32] => RecordIdentity::namespace(
                reference,
                NamespaceBinding::new(
                    raw[72..88].try_into().unwrap(),
                    raw[88..120].try_into().unwrap(),
                    u16::from_le_bytes(raw[120..122].try_into().unwrap()),
                )
                .map_err(|_| Error::InvalidManifest)?,
            ),
            _ => return Err(Error::InvalidManifest),
        }
        .map_err(|_| Error::InvalidManifest)?;
        entries.push(ReferenceEntry {
            intent: RecordIntent {
                identity,
                commitment: raw[128..160].try_into().unwrap(),
            },
            state,
        });
    }
    // V1 has only append and Prepared -> Verified. There is no delete, rotation,
    // timestamp update, or mutable metadata operation that can spend a revision.
    if prepared > 1 || revision != (count * 2 - prepared) as u64 {
        return Err(Error::InvalidManifest);
    }
    Ok(ManifestSnapshot {
        installation,
        revision,
        entries,
    })
}
