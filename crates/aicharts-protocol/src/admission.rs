//! Canonical operation and terminal-journal framing for usage admission.
//!
//! These hashes bind bytes; neither a digest nor a decoded receipt authenticates
//! its issuer. A caller must establish trusted receipt custody independently.
//! Nested measurement policy is explicit, and storage/admission authorization
//! remains outside this file-and-network-free codec.

use std::{collections::BTreeSet, fmt};

use sha2::{Digest as _, Sha256};

use crate::{Id, Policy};

pub type Digest = [u8; 32];
pub const FRAME_BYTES: usize = 136;
pub const DESCRIPTOR_BYTES: usize = 184;
pub const PUT_BYTES: usize = DESCRIPTOR_BYTES + FRAME_BYTES;
pub const RECEIPT_BYTES: usize = 264;
pub const BATCH_HEADER_BYTES: usize = 104;
pub const JOURNAL_HEADER_BYTES: usize = 160;
pub const MAX_OPERATIONS: usize = 256;
pub const MAX_BATCH_BYTES: usize = BATCH_HEADER_BYTES + MAX_OPERATIONS * PUT_BYTES;
pub const MAX_JOURNAL_BYTES: usize = JOURNAL_HEADER_BYTES + MAX_OPERATIONS * RECEIPT_BYTES;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
pub const MAX_TIMESTAMP_MS: u64 = 8_640_000_000_000_000;
const OPERATION_DOMAIN: &[u8] = b"aicharts:usage-operation:v1\0";
const BATCH_DOMAIN: &[u8] = b"aicharts:usage-batch:v1\0";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Binding {
    pub account_id: Id,
    pub namespace_version: u16,
    pub device_id: Digest,
    pub recovery_generation: Digest,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum Action {
    Put = 1,
    Tombstone = 2,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OperationKind {
    Put { frame: [u8; FRAME_BYTES] },
    Tombstone,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Operation {
    pub binding: Binding,
    pub sequence: u64,
    pub occurrence_id: Id,
    pub expected_head: Digest,
    pub kind: OperationKind,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Descriptor {
    pub binding: Binding,
    pub sequence: u64,
    pub occurrence_id: Id,
    pub expected_head: Digest,
    pub action: Action,
    pub payload_length: u32,
    pub payload_hash: Digest,
}

impl Operation {
    /// Construct the descriptor without granting validity or admission authority.
    pub fn descriptor(&self) -> Descriptor {
        let (action, payload_length, payload_hash) = match &self.kind {
            OperationKind::Put { frame } => (
                Action::Put,
                FRAME_BYTES as u32,
                Sha256::digest(frame).into(),
            ),
            OperationKind::Tombstone => (Action::Tombstone, 0, [0; 32]),
        };
        Descriptor {
            binding: self.binding,
            sequence: self.sequence,
            occurrence_id: self.occurrence_id,
            expected_head: self.expected_head,
            action,
            payload_length,
            payload_hash,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Batch {
    pub binding: Binding,
    pub operations: Vec<Operation>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum Outcome {
    Inserted = 1,
    Replaced = 2,
    Tombstoned = 3,
    Duplicate = 4,
    PredecessorConflict = 5,
    BatchAborted = 6,
    DeviceRevoked = 7,
    SubjectDeleted = 8,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Receipt {
    pub descriptor: Descriptor,
    pub operation_hash: Digest,
    pub head_operation_hash: Digest,
    pub account_journal_revision: u64,
    pub committed_at_ms: u64,
    pub outcome: Outcome,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum JournalStatus {
    Accepted = 1,
    Rejected = 2,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Journal {
    pub binding: Binding,
    pub first_sequence: u64,
    pub batch_hash: Digest,
    pub account_journal_revision: u64,
    pub committed_at_ms: u64,
    pub status: JournalStatus,
    pub receipts: Vec<Receipt>,
}

/// Bounded codes contain no input bytes, identifiers, or field values.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Error {
    InvalidLength,
    InvalidMagic,
    UnsupportedVersion,
    ReservedField,
    InvalidBinding,
    InvalidSequence,
    InvalidDescriptor,
    InvalidFrame,
    InvalidDigest,
    InvalidOutcome,
    InvalidJournal,
    MemberMismatch,
    RecordLimit,
    DuplicateOccurrence,
}

impl Error {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidLength => "admission_invalid_length",
            Self::InvalidMagic => "admission_invalid_magic",
            Self::UnsupportedVersion => "admission_unsupported_version",
            Self::ReservedField => "admission_reserved_field",
            Self::InvalidBinding => "admission_invalid_binding",
            Self::InvalidSequence => "admission_invalid_sequence",
            Self::InvalidDescriptor => "admission_invalid_descriptor",
            Self::InvalidFrame => "admission_invalid_frame",
            Self::InvalidDigest => "admission_invalid_digest",
            Self::InvalidOutcome => "admission_invalid_outcome",
            Self::InvalidJournal => "admission_invalid_journal",
            Self::MemberMismatch => "admission_member_mismatch",
            Self::RecordLimit => "admission_record_limit",
            Self::DuplicateOccurrence => "admission_duplicate_occurrence",
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}
impl std::error::Error for Error {}

fn binding(value: &Binding) -> Result<(), Error> {
    if value.namespace_version != 1
        || value.account_id == [0; 16]
        || value.device_id == [0; 32]
        || value.recovery_generation == [0; 32]
    {
        return Err(Error::InvalidBinding);
    }
    Ok(())
}

fn positive_safe(value: u64) -> bool {
    (1..=MAX_SAFE_INTEGER).contains(&value)
}

fn sequence_range(first: u64, count: usize) -> Result<(), Error> {
    if !(1..=MAX_OPERATIONS).contains(&count) {
        return Err(Error::RecordLimit);
    }
    if !positive_safe(first) || first > MAX_SAFE_INTEGER - (count as u64 - 1) {
        return Err(Error::InvalidSequence);
    }
    Ok(())
}

fn descriptor(value: &Descriptor) -> Result<(), Error> {
    binding(&value.binding)?;
    if !positive_safe(value.sequence) {
        return Err(Error::InvalidSequence);
    }
    if value.occurrence_id == [0; 16] {
        return Err(Error::InvalidDescriptor);
    }
    match value.action {
        Action::Put
            if value.payload_length == FRAME_BYTES as u32 && value.payload_hash != [0; 32] =>
        {
            Ok(())
        }
        Action::Tombstone if value.payload_length == 0 && value.payload_hash == [0; 32] => Ok(()),
        _ => Err(Error::InvalidDescriptor),
    }
}

fn validate_operation(value: &Operation, policy: &Policy<'_>) -> Result<Descriptor, Error> {
    let description = value.descriptor();
    descriptor(&description)?;
    if let OperationKind::Put { frame } = &value.kind {
        let decoded = crate::decode(frame, policy).map_err(|_| Error::InvalidFrame)?;
        if decoded.usage.len() != 1
            || !decoded.prompts.is_empty()
            || !decoded.intervals.is_empty()
            || decoded.usage[0].id != value.occurrence_id
            || crate::encode(&decoded, policy).map_err(|_| Error::InvalidFrame)? != frame.as_slice()
        {
            return Err(Error::InvalidFrame);
        }
    }
    Ok(description)
}

fn prefix(out: &mut Vec<u8>, magic: &[u8; 4]) {
    out.extend_from_slice(magic);
    out.extend_from_slice(&1_u16.to_le_bytes());
    out.extend_from_slice(&0_u16.to_le_bytes());
}

fn binding_bytes(out: &mut Vec<u8>, value: &Binding) {
    out.extend_from_slice(&value.account_id);
    out.extend_from_slice(&value.device_id);
    out.extend_from_slice(&value.recovery_generation);
}

fn descriptor_bytes(value: &Descriptor, magic: &[u8; 4], outcome: u8) -> Vec<u8> {
    let mut out = Vec::with_capacity(DESCRIPTOR_BYTES);
    prefix(&mut out, magic);
    out.extend_from_slice(&value.binding.namespace_version.to_le_bytes());
    out.push(value.action as u8);
    out.push(outcome);
    out.extend_from_slice(&value.payload_length.to_le_bytes());
    binding_bytes(&mut out, &value.binding);
    out.extend_from_slice(&value.sequence.to_le_bytes());
    out.extend_from_slice(&value.occurrence_id);
    out.extend_from_slice(&value.expected_head);
    out.extend_from_slice(&value.payload_hash);
    out
}

pub fn encode_operation(value: &Operation, policy: &Policy<'_>) -> Result<Vec<u8>, Error> {
    let description = validate_operation(value, policy)?;
    let mut out = descriptor_bytes(&description, b"AICO", 0);
    if let OperationKind::Put { frame } = &value.kind {
        out.extend_from_slice(frame);
    }
    Ok(out)
}

struct Reader<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, length: usize) -> Result<&'a [u8], Error> {
        let end = self
            .position
            .checked_add(length)
            .ok_or(Error::InvalidLength)?;
        let value = self
            .bytes
            .get(self.position..end)
            .ok_or(Error::InvalidLength)?;
        self.position = end;
        Ok(value)
    }
    fn array<const N: usize>(&mut self) -> Result<[u8; N], Error> {
        self.take(N)?.try_into().map_err(|_| Error::InvalidLength)
    }
    fn u8(&mut self) -> Result<u8, Error> {
        Ok(self.array::<1>()?[0])
    }
    fn u16(&mut self) -> Result<u16, Error> {
        Ok(u16::from_le_bytes(self.array()?))
    }
    fn u32(&mut self) -> Result<u32, Error> {
        Ok(u32::from_le_bytes(self.array()?))
    }
    fn u64(&mut self) -> Result<u64, Error> {
        Ok(u64::from_le_bytes(self.array()?))
    }
    fn zeros(&mut self, count: usize) -> Result<(), Error> {
        if self.take(count)?.iter().any(|byte| *byte != 0) {
            return Err(Error::ReservedField);
        }
        Ok(())
    }
    fn prefix(&mut self, magic: &[u8; 4]) -> Result<(), Error> {
        if &self.array::<4>()? != magic {
            return Err(Error::InvalidMagic);
        }
        if self.u16()? != 1 {
            return Err(Error::UnsupportedVersion);
        }
        self.zeros(2)
    }
    fn binding(&mut self, namespace_version: u16) -> Result<Binding, Error> {
        let value = Binding {
            namespace_version,
            account_id: self.array()?,
            device_id: self.array()?,
            recovery_generation: self.array()?,
        };
        binding(&value)?;
        Ok(value)
    }
    fn descriptor(&mut self, magic: &[u8; 4]) -> Result<(Descriptor, u8), Error> {
        self.prefix(magic)?;
        let namespace = self.u16()?;
        let action = match self.u8()? {
            1 => Action::Put,
            2 => Action::Tombstone,
            _ => return Err(Error::InvalidDescriptor),
        };
        let outcome = self.u8()?;
        let payload_length = self.u32()?;
        let value = Descriptor {
            binding: self.binding(namespace)?,
            sequence: self.u64()?,
            occurrence_id: self.array()?,
            expected_head: self.array()?,
            action,
            payload_length,
            payload_hash: self.array()?,
        };
        descriptor(&value)?;
        Ok((value, outcome))
    }
}

pub fn decode_operation(bytes: &[u8], policy: &Policy<'_>) -> Result<Operation, Error> {
    if bytes.len() != DESCRIPTOR_BYTES && bytes.len() != PUT_BYTES {
        return Err(Error::InvalidLength);
    }
    let mut reader = Reader { bytes, position: 0 };
    let (description, reserved) = reader.descriptor(b"AICO")?;
    if reserved != 0 {
        return Err(Error::ReservedField);
    }
    if bytes.len() != DESCRIPTOR_BYTES + description.payload_length as usize {
        return Err(Error::InvalidLength);
    }
    let kind = match description.action {
        Action::Put => OperationKind::Put {
            frame: reader.array()?,
        },
        Action::Tombstone => OperationKind::Tombstone,
    };
    let value = Operation {
        binding: description.binding,
        sequence: description.sequence,
        occurrence_id: description.occurrence_id,
        expected_head: description.expected_head,
        kind,
    };
    if validate_operation(&value, policy)? != description {
        return Err(Error::InvalidDigest);
    }
    Ok(value)
}

fn digest(domain: &[u8], bytes: &[u8]) -> Digest {
    let mut hash = Sha256::new();
    hash.update(domain);
    hash.update(bytes);
    hash.finalize().into()
}

pub fn operation_digest(value: &Operation, policy: &Policy<'_>) -> Result<Digest, Error> {
    Ok(digest(OPERATION_DOMAIN, &encode_operation(value, policy)?))
}

fn batch_header(
    magic: &[u8; 4],
    value: &Binding,
    first: u64,
    count: usize,
    member_bytes: usize,
) -> Vec<u8> {
    let mut out = Vec::with_capacity(BATCH_HEADER_BYTES);
    prefix(&mut out, magic);
    out.extend_from_slice(&value.namespace_version.to_le_bytes());
    out.extend_from_slice(&(count as u16).to_le_bytes());
    out.extend_from_slice(&(member_bytes as u32).to_le_bytes());
    binding_bytes(&mut out, value);
    out.extend_from_slice(&first.to_le_bytes());
    out
}

pub fn encode_batch(value: &Batch, policy: &Policy<'_>) -> Result<Vec<u8>, Error> {
    binding(&value.binding)?;
    let first = value.operations.first().ok_or(Error::RecordLimit)?.sequence;
    sequence_range(first, value.operations.len())?;
    let mut occurrences = BTreeSet::new();
    let mut members = Vec::with_capacity(value.operations.len() * PUT_BYTES);
    for (index, operation) in value.operations.iter().enumerate() {
        if operation.binding != value.binding || operation.sequence != first + index as u64 {
            return Err(Error::MemberMismatch);
        }
        if !occurrences.insert(operation.occurrence_id) {
            return Err(Error::DuplicateOccurrence);
        }
        members.extend_from_slice(&encode_operation(operation, policy)?);
    }
    let mut out = batch_header(
        b"AICB",
        &value.binding,
        first,
        value.operations.len(),
        members.len(),
    );
    out.extend_from_slice(&members);
    Ok(out)
}

fn read_batch_header(
    reader: &mut Reader<'_>,
    magic: &[u8; 4],
) -> Result<(Binding, u64, usize, usize), Error> {
    reader.prefix(magic)?;
    let namespace = reader.u16()?;
    let count = usize::from(reader.u16()?);
    let member_bytes = reader.u32()? as usize;
    let value = reader.binding(namespace)?;
    let first = reader.u64()?;
    sequence_range(first, count)?;
    Ok((value, first, count, member_bytes))
}

pub fn decode_batch(bytes: &[u8], policy: &Policy<'_>) -> Result<Batch, Error> {
    if !(BATCH_HEADER_BYTES..=MAX_BATCH_BYTES).contains(&bytes.len()) {
        return Err(Error::InvalidLength);
    }
    let mut reader = Reader { bytes, position: 0 };
    let (binding, first, count, member_bytes) = read_batch_header(&mut reader, b"AICB")?;
    if member_bytes != bytes.len() - BATCH_HEADER_BYTES
        || member_bytes < count * DESCRIPTOR_BYTES
        || member_bytes > count * PUT_BYTES
    {
        return Err(Error::InvalidLength);
    }
    let mut operations = Vec::with_capacity(count);
    let mut occurrences = BTreeSet::new();
    for index in 0..count {
        let remaining = bytes.get(reader.position..).ok_or(Error::InvalidLength)?;
        let length_bytes: [u8; 4] = remaining
            .get(12..16)
            .ok_or(Error::InvalidLength)?
            .try_into()
            .map_err(|_| Error::InvalidLength)?;
        let payload_length = u32::from_le_bytes(length_bytes);
        if payload_length != 0 && payload_length != FRAME_BYTES as u32 {
            return Err(Error::InvalidDescriptor);
        }
        let operation = decode_operation(
            reader.take(DESCRIPTOR_BYTES + payload_length as usize)?,
            policy,
        )?;
        if operation.binding != binding || operation.sequence != first + index as u64 {
            return Err(Error::MemberMismatch);
        }
        if !occurrences.insert(operation.occurrence_id) {
            return Err(Error::DuplicateOccurrence);
        }
        operations.push(operation);
    }
    if reader.position != bytes.len() {
        return Err(Error::InvalidLength);
    }
    Ok(Batch {
        binding,
        operations,
    })
}

pub fn batch_digest(value: &Batch, policy: &Policy<'_>) -> Result<Digest, Error> {
    Ok(digest(BATCH_DOMAIN, &encode_batch(value, policy)?))
}

fn validate_receipt(value: &Receipt) -> Result<(), Error> {
    descriptor(&value.descriptor)?;
    if value.operation_hash == [0; 32] {
        return Err(Error::InvalidDigest);
    }
    if !positive_safe(value.account_journal_revision) || value.committed_at_ms > MAX_TIMESTAMP_MS {
        return Err(Error::InvalidJournal);
    }
    let head = value.head_operation_hash;
    let predecessor = value.descriptor.expected_head;
    let action = value.descriptor.action;
    let valid = match value.outcome {
        Outcome::Inserted => {
            action == Action::Put && predecessor == [0; 32] && head == value.operation_hash
        }
        Outcome::Replaced => {
            action == Action::Put && predecessor != [0; 32] && head == value.operation_hash
        }
        Outcome::Tombstoned => {
            action == Action::Tombstone && predecessor != [0; 32] && head == value.operation_hash
        }
        Outcome::Duplicate => action == Action::Put && head != [0; 32],
        Outcome::DeviceRevoked => head == [0; 32],
        Outcome::SubjectDeleted => head != [0; 32],
        Outcome::PredecessorConflict | Outcome::BatchAborted => true,
    };
    if !valid {
        return Err(Error::InvalidOutcome);
    }
    Ok(())
}

pub fn encode_receipt(value: &Receipt) -> Result<Vec<u8>, Error> {
    validate_receipt(value)?;
    let mut out = descriptor_bytes(&value.descriptor, b"AICR", value.outcome as u8);
    out.extend_from_slice(&value.operation_hash);
    out.extend_from_slice(&value.head_operation_hash);
    out.extend_from_slice(&value.account_journal_revision.to_le_bytes());
    out.extend_from_slice(&value.committed_at_ms.to_le_bytes());
    Ok(out)
}

pub fn decode_receipt(bytes: &[u8]) -> Result<Receipt, Error> {
    if bytes.len() != RECEIPT_BYTES {
        return Err(Error::InvalidLength);
    }
    let mut reader = Reader { bytes, position: 0 };
    let (descriptor, outcome) = reader.descriptor(b"AICR")?;
    let outcome = match outcome {
        1 => Outcome::Inserted,
        2 => Outcome::Replaced,
        3 => Outcome::Tombstoned,
        4 => Outcome::Duplicate,
        5 => Outcome::PredecessorConflict,
        6 => Outcome::BatchAborted,
        7 => Outcome::DeviceRevoked,
        8 => Outcome::SubjectDeleted,
        _ => return Err(Error::InvalidOutcome),
    };
    let value = Receipt {
        descriptor,
        outcome,
        operation_hash: reader.array()?,
        head_operation_hash: reader.array()?,
        account_journal_revision: reader.u64()?,
        committed_at_ms: reader.u64()?,
    };
    validate_receipt(&value)?;
    Ok(value)
}

fn validate_journal(value: &Journal) -> Result<(), Error> {
    binding(&value.binding)?;
    sequence_range(value.first_sequence, value.receipts.len())?;
    if value.batch_hash == [0; 32] {
        return Err(Error::InvalidDigest);
    }
    if !positive_safe(value.account_journal_revision) || value.committed_at_ms > MAX_TIMESTAMP_MS {
        return Err(Error::InvalidJournal);
    }
    let mut occurrences = BTreeSet::new();
    for (index, receipt) in value.receipts.iter().enumerate() {
        validate_receipt(receipt)?;
        if receipt.descriptor.binding != value.binding
            || receipt.descriptor.sequence != value.first_sequence + index as u64
            || receipt.account_journal_revision != value.account_journal_revision
            || receipt.committed_at_ms != value.committed_at_ms
        {
            return Err(Error::MemberMismatch);
        }
        if !occurrences.insert(receipt.descriptor.occurrence_id) {
            return Err(Error::DuplicateOccurrence);
        }
    }
    let valid = match value.status {
        JournalStatus::Accepted => value.receipts.iter().all(|receipt| {
            matches!(
                receipt.outcome,
                Outcome::Inserted | Outcome::Replaced | Outcome::Tombstoned | Outcome::Duplicate
            )
        }),
        JournalStatus::Rejected => {
            value
                .receipts
                .iter()
                .all(|receipt| receipt.outcome == Outcome::DeviceRevoked)
                || (value.receipts.iter().any(|receipt| {
                    matches!(
                        receipt.outcome,
                        Outcome::PredecessorConflict | Outcome::SubjectDeleted
                    )
                }) && value.receipts.iter().all(|receipt| {
                    matches!(
                        receipt.outcome,
                        Outcome::PredecessorConflict
                            | Outcome::BatchAborted
                            | Outcome::SubjectDeleted
                    )
                }))
        }
    };
    if !valid {
        return Err(Error::InvalidJournal);
    }
    Ok(())
}

pub fn encode_journal(value: &Journal) -> Result<Vec<u8>, Error> {
    validate_journal(value)?;
    let mut out = batch_header(
        b"AICJ",
        &value.binding,
        value.first_sequence,
        value.receipts.len(),
        value.receipts.len() * RECEIPT_BYTES,
    );
    out.extend_from_slice(&value.batch_hash);
    out.extend_from_slice(&value.account_journal_revision.to_le_bytes());
    out.extend_from_slice(&value.committed_at_ms.to_le_bytes());
    out.push(value.status as u8);
    out.extend_from_slice(&[0; 7]);
    for receipt in &value.receipts {
        out.extend_from_slice(&encode_receipt(receipt)?);
    }
    Ok(out)
}

pub fn decode_journal(bytes: &[u8]) -> Result<Journal, Error> {
    if !(JOURNAL_HEADER_BYTES..=MAX_JOURNAL_BYTES).contains(&bytes.len()) {
        return Err(Error::InvalidLength);
    }
    let mut reader = Reader { bytes, position: 0 };
    let (binding, first_sequence, count, member_bytes) = read_batch_header(&mut reader, b"AICJ")?;
    if member_bytes != count * RECEIPT_BYTES || member_bytes != bytes.len() - JOURNAL_HEADER_BYTES {
        return Err(Error::InvalidLength);
    }
    let batch_hash = reader.array()?;
    let account_journal_revision = reader.u64()?;
    let committed_at_ms = reader.u64()?;
    let status = match reader.u8()? {
        1 => JournalStatus::Accepted,
        2 => JournalStatus::Rejected,
        _ => return Err(Error::InvalidJournal),
    };
    reader.zeros(7)?;
    let mut receipts = Vec::with_capacity(count);
    for _ in 0..count {
        receipts.push(decode_receipt(reader.take(RECEIPT_BYTES)?)?);
    }
    let value = Journal {
        binding,
        first_sequence,
        batch_hash,
        account_journal_revision,
        committed_at_ms,
        status,
        receipts,
    };
    validate_journal(&value)?;
    Ok(value)
}

/// Check exact ordered request echoes after independently authenticating custody.
/// Rejected journals consume sequence identity but never acknowledge measurements.
pub fn validate_journal_for_batch(
    journal: &Journal,
    batch: &Batch,
    policy: &Policy<'_>,
) -> Result<(), Error> {
    validate_journal(journal)?;
    let hash = batch_digest(batch, policy)?;
    if journal.binding != batch.binding
        || journal.batch_hash != hash
        || journal.receipts.len() != batch.operations.len()
    {
        return Err(Error::MemberMismatch);
    }
    for (receipt, operation) in journal.receipts.iter().zip(&batch.operations) {
        if receipt.descriptor != operation.descriptor()
            || receipt.operation_hash != operation_digest(operation, policy)?
        {
            return Err(Error::MemberMismatch);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
