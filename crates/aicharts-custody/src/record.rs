use crate::{Error, Result};
use zeroize::Zeroizing;

pub(crate) const MAX_RECORD_BYTES: usize = 168;
const HEADER_BYTES: usize = 72;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Purpose {
    Checkpoint = 1,
    Pairing = 2,
    Namespace = 3,
}

/// Nonsecret locator. The service namespace is fixed to AI Charts production;
/// callers cannot supply an arbitrary service, account name, URL, or keychain.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CredentialRef {
    installation_id: [u8; 32],
    item_id: [u8; 32],
    purpose: Purpose,
}

impl CredentialRef {
    pub fn new(installation_id: [u8; 32], item_id: [u8; 32], purpose: Purpose) -> Result<Self> {
        if installation_id == [0; 32] || item_id == [0; 32] {
            return Err(Error::InvalidReference);
        }
        Ok(Self {
            installation_id,
            item_id,
            purpose,
        })
    }

    pub fn installation_id(&self) -> &[u8; 32] {
        &self.installation_id
    }
    pub fn item_id(&self) -> &[u8; 32] {
        &self.item_id
    }
    pub fn purpose(&self) -> Purpose {
        self.purpose
    }

    #[cfg(any(test, target_os = "macos"))]
    pub(crate) fn service(&self) -> &'static str {
        match self.purpose {
            Purpose::Checkpoint => "io.aicharts.usage.production.checkpoint.v1",
            Purpose::Pairing => "io.aicharts.usage.production.pairing.v1",
            Purpose::Namespace => "io.aicharts.usage.production.namespace.v1",
        }
    }

    #[cfg(any(test, target_os = "macos"))]
    pub(crate) fn account(&self) -> String {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut value = String::with_capacity(132);
        value.push_str("v1-");
        for (index, bytes) in [&self.installation_id, &self.item_id]
            .into_iter()
            .enumerate()
        {
            if index != 0 {
                value.push('-');
            }
            for byte in bytes {
                value.push(HEX[usize::from(byte >> 4)] as char);
                value.push(HEX[usize::from(byte & 15)] as char);
            }
        }
        value
    }
}

/// Syntactically valid account namespace, not authenticated enrollment evidence.
/// The device-specific enrollment receipt is deliberately outside this crate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NamespaceBinding {
    account_id: [u8; 16],
    recovery_generation: [u8; 32],
    namespace_version: u16,
}

impl NamespaceBinding {
    pub fn new(
        account_id: [u8; 16],
        recovery_generation: [u8; 32],
        namespace_version: u16,
    ) -> Result<Self> {
        if account_id == [0; 16] || recovery_generation == [0; 32] || namespace_version != 1 {
            return Err(Error::InvalidBinding);
        }
        Ok(Self {
            account_id,
            recovery_generation,
            namespace_version,
        })
    }
    pub fn account_id(&self) -> &[u8; 16] {
        &self.account_id
    }
    pub fn recovery_generation(&self) -> &[u8; 32] {
        &self.recovery_generation
    }
    pub fn namespace_version(&self) -> u16 {
        self.namespace_version
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum IdentityKind {
    Checkpoint,
    Pairing { intent_id: [u8; 32] },
    Namespace(NamespaceBinding),
}

/// Expected nonsecret identity supplied by the caller's retained operation intent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordIdentity {
    reference: CredentialRef,
    kind: IdentityKind,
}

impl RecordIdentity {
    pub fn checkpoint(reference: CredentialRef) -> Result<Self> {
        Self::new(reference, Purpose::Checkpoint, IdentityKind::Checkpoint)
    }
    pub fn pairing(reference: CredentialRef, intent_id: [u8; 32]) -> Result<Self> {
        if intent_id == [0; 32] {
            return Err(Error::InvalidBinding);
        }
        Self::new(
            reference,
            Purpose::Pairing,
            IdentityKind::Pairing { intent_id },
        )
    }
    pub fn namespace(reference: CredentialRef, binding: NamespaceBinding) -> Result<Self> {
        Self::new(
            reference,
            Purpose::Namespace,
            IdentityKind::Namespace(binding),
        )
    }
    fn new(reference: CredentialRef, purpose: Purpose, kind: IdentityKind) -> Result<Self> {
        if reference.purpose != purpose {
            return Err(Error::WrongPurpose);
        }
        Ok(Self { reference, kind })
    }
    pub fn reference(&self) -> &CredentialRef {
        &self.reference
    }
    pub fn intent_id(&self) -> Option<&[u8; 32]> {
        match &self.kind {
            IdentityKind::Pairing { intent_id } => Some(intent_id),
            _ => None,
        }
    }
    pub fn namespace_binding(&self) -> Option<&NamespaceBinding> {
        match &self.kind {
            IdentityKind::Namespace(binding) => Some(binding),
            _ => None,
        }
    }
}

/// Nonzero secret with explicit byte access and best-effort owned-buffer wiping.
/// There is no Debug, Clone, Copy, Display, or serialization implementation.
/// Caller and operating-system copies are outside this type's wiping guarantee.
///
/// ```compile_fail
/// use aicharts_custody::Secret32;
/// let secret = Secret32::new([1; 32]).ok().unwrap();
/// println!("{secret:?}");
/// ```
/// ```compile_fail
/// use aicharts_custody::Secret32;
/// let secret = Secret32::new([1; 32]).ok().unwrap();
/// let copied = secret.clone();
/// ```
pub struct Secret32 {
    bytes: Box<Zeroizing<[u8; 32]>>,
}

impl Secret32 {
    pub fn new(bytes: [u8; 32]) -> Result<Self> {
        let bytes = Zeroizing::new(bytes);
        Self::from_slice(bytes.as_ref())
    }

    fn from_slice(bytes: &[u8]) -> Result<Self> {
        if bytes.len() != 32 || bytes.iter().all(|byte| *byte == 0) {
            return Err(Error::InvalidSecret);
        }
        let mut owned = Box::new(Zeroizing::new([0; 32]));
        owned.copy_from_slice(bytes);
        Ok(Self { bytes: owned })
    }

    /// The caller must not log, serialize, or retain a copy of exposed bytes.
    pub fn with_bytes<T>(&self, f: impl FnOnce(&[u8; 32]) -> T) -> T {
        f(&self.bytes)
    }

    fn as_bytes(&self) -> &[u8; 32] {
        &self.bytes
    }
}

enum Secrets {
    One(Secret32),
    Pair { polling: Secret32, upload: Secret32 },
}

/// Typed immutable local record, not a server grant. Its binary codec is private
/// to custody and is never an enrollment or upload wire protocol.
///
/// ```compile_fail
/// fn expose(record: aicharts_custody::SecretRecord) {
///     println!("{record:?}");
/// }
/// ```
/// ```compile_fail
/// fn copy(record: aicharts_custody::SecretRecord) {
///     let duplicate = record.clone();
/// }
/// ```
pub struct SecretRecord {
    identity: RecordIdentity,
    secrets: Secrets,
}

impl SecretRecord {
    pub fn checkpoint(reference: CredentialRef, key: Secret32) -> Result<Self> {
        Ok(Self {
            identity: RecordIdentity::checkpoint(reference)?,
            secrets: Secrets::One(key),
        })
    }
    pub fn pairing(
        reference: CredentialRef,
        intent_id: [u8; 32],
        polling: Secret32,
        upload: Secret32,
    ) -> Result<Self> {
        if bytes_equal(polling.as_bytes(), upload.as_bytes()) {
            return Err(Error::InvalidSecret);
        }
        Ok(Self {
            identity: RecordIdentity::pairing(reference, intent_id)?,
            secrets: Secrets::Pair { polling, upload },
        })
    }
    pub fn namespace(
        reference: CredentialRef,
        binding: NamespaceBinding,
        key: Secret32,
    ) -> Result<Self> {
        Ok(Self {
            identity: RecordIdentity::namespace(reference, binding)?,
            secrets: Secrets::One(key),
        })
    }
    pub fn identity(&self) -> &RecordIdentity {
        &self.identity
    }

    pub fn with_checkpoint_key<T>(&self, f: impl FnOnce(&[u8; 32]) -> T) -> Result<T> {
        match (&self.identity.kind, &self.secrets) {
            (IdentityKind::Checkpoint, Secrets::One(key)) => Ok(key.with_bytes(f)),
            _ => Err(Error::WrongPurpose),
        }
    }
    pub fn with_pairing_secrets<T>(&self, f: impl FnOnce(&[u8; 32], &[u8; 32]) -> T) -> Result<T> {
        match (&self.identity.kind, &self.secrets) {
            (IdentityKind::Pairing { .. }, Secrets::Pair { polling, upload }) => {
                Ok(f(polling.as_bytes(), upload.as_bytes()))
            }
            _ => Err(Error::WrongPurpose),
        }
    }
    pub fn with_namespace_key<T>(&self, f: impl FnOnce(&[u8; 32]) -> T) -> Result<T> {
        match (&self.identity.kind, &self.secrets) {
            (IdentityKind::Namespace(_), Secrets::One(key)) => Ok(key.with_bytes(f)),
            _ => Err(Error::WrongPurpose),
        }
    }

    pub(crate) fn encode(&self) -> Zeroizing<Vec<u8>> {
        let mut bytes = Zeroizing::new(Vec::with_capacity(MAX_RECORD_BYTES));
        bytes.extend_from_slice(b"AICV\x01\x00");
        bytes.extend_from_slice(&[self.identity.reference.purpose as u8, 0]);
        bytes.extend_from_slice(&self.identity.reference.installation_id);
        bytes.extend_from_slice(&self.identity.reference.item_id);
        match &self.identity.kind {
            IdentityKind::Checkpoint => {}
            IdentityKind::Pairing { intent_id } => bytes.extend_from_slice(intent_id),
            IdentityKind::Namespace(binding) => {
                bytes.extend_from_slice(&binding.account_id);
                bytes.extend_from_slice(&binding.recovery_generation);
                bytes.extend_from_slice(&binding.namespace_version.to_le_bytes());
                bytes.extend_from_slice(&[0; 6]);
            }
        }
        match &self.secrets {
            Secrets::One(key) => bytes.extend_from_slice(key.as_bytes()),
            Secrets::Pair { polling, upload } => {
                bytes.extend_from_slice(polling.as_bytes());
                bytes.extend_from_slice(upload.as_bytes());
            }
        }
        bytes
    }

    pub(crate) fn decode(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < HEADER_BYTES
            || bytes.len() > MAX_RECORD_BYTES
            || &bytes[..6] != b"AICV\x01\x00"
            || bytes[7] != 0
        {
            return Err(Error::InvalidRecord);
        }
        let purpose = match bytes[6] {
            1 if bytes.len() == 104 => Purpose::Checkpoint,
            2 if bytes.len() == 168 => Purpose::Pairing,
            3 if bytes.len() == 160 => Purpose::Namespace,
            _ => return Err(Error::InvalidRecord),
        };
        let parse = || -> Result<Self> {
            let reference =
                CredentialRef::new(array(&bytes[8..40])?, array(&bytes[40..72])?, purpose)?;
            match purpose {
                Purpose::Checkpoint => {
                    Self::checkpoint(reference, Secret32::from_slice(&bytes[72..104])?)
                }
                Purpose::Pairing => Self::pairing(
                    reference,
                    array(&bytes[72..104])?,
                    Secret32::from_slice(&bytes[104..136])?,
                    Secret32::from_slice(&bytes[136..168])?,
                ),
                Purpose::Namespace => {
                    if bytes[122..128] != [0; 6] {
                        return Err(Error::InvalidRecord);
                    }
                    let binding = NamespaceBinding::new(
                        array(&bytes[72..88])?,
                        array(&bytes[88..120])?,
                        u16::from_le_bytes(array(&bytes[120..122])?),
                    )?;
                    Self::namespace(reference, binding, Secret32::from_slice(&bytes[128..160])?)
                }
            }
        };
        parse().map_err(|_| Error::InvalidRecord)
    }
}

fn array<const N: usize>(bytes: &[u8]) -> Result<[u8; N]> {
    bytes.try_into().map_err(|_| Error::InvalidRecord)
}

/// Fixed-work byte comparison, with no secret-dependent early return. This is
/// not a claim about hardware timing or an authentication primitive.
pub(crate) fn bytes_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter().zip(right).fold(0, |difference, (a, b)| {
        difference | std::hint::black_box(a ^ b)
    }) == 0
}
