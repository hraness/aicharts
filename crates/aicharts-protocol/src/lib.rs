//! Bounded, canonical, content-free usage measurement framing.
//!
//! A valid packet is self-reported measurement data, not evidence of authenticity.
//! This crate does not access files or the network and does not accept model names,
//! arbitrary metadata, or client-supplied prices.

#![forbid(unsafe_code)]

pub mod admission;

use std::fmt;

pub type Id = [u8; 16];

pub const DAY_MS: u32 = 86_400_000;
pub const MAX_RECORDS: usize = 4_096;
pub const MAX_TOKEN_COUNTER: u64 = 1_000_000_000_000;
pub const MAX_CLOCK_UNCERTAINTY_MS: u32 = 60_000;
pub const HEADER_BYTES: usize = 24;
pub const USAGE_BYTES: usize = 112;
pub const PROMPT_BYTES: usize = 56;
pub const INTERVAL_BYTES: usize = 48;
pub const MAX_PACKET_BYTES: usize =
    HEADER_BYTES + MAX_RECORDS * (USAGE_BYTES + PROMPT_BYTES + INTERVAL_BYTES);

macro_rules! wire_enum {
    ($name:ident { $($variant:ident = $value:literal),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash)]
        #[repr(u8)]
        pub enum $name {
            $($variant = $value),+
        }

        impl TryFrom<u8> for $name {
            type Error = Error;

            fn try_from(value: u8) -> Result<Self, Self::Error> {
                match value {
                    $($value => Ok(Self::$variant),)+
                    _ => Err(Error::UnsupportedValue),
                }
            }
        }
    };
}

wire_enum!(Provider { Codex = 1, ClaudeCode = 2 });
wire_enum!(AuthMode { Unknown = 0, Subscription = 1, Api = 2 });
wire_enum!(Origin { Unknown = 0, Human = 1, Automation = 2 });
wire_enum!(IntervalKind { AgentWork = 1, ApiRequest = 2 });
wire_enum!(Evidence { Imported = 1, Live = 2 });

impl Evidence {
    fn from_flags(flags: u16) -> Result<Self, Error> {
        match flags {
            1 => Ok(Self::Imported),
            2 => Ok(Self::Live),
            _ => Err(Error::InvalidEvidence),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Tokens {
    pub input_uncached: u64,
    pub cache_read: u64,
    pub cache_write_5m: u64,
    pub cache_write_1h: u64,
    pub output: u64,
    pub reasoning_output: u64,
}

impl Tokens {
    /// Sum disjoint token categories, validating counter and reasoning bounds.
    /// Zero is a valid arithmetic result, but an all-zero usage record is invalid.
    pub fn total(&self) -> Result<u64, Error> {
        if self
            .counters()
            .iter()
            .any(|value| *value > MAX_TOKEN_COUNTER)
            || self.reasoning_output > self.output
        {
            return Err(Error::InvalidTokens);
        }
        self.counters()[..5].iter().try_fold(0_u64, |sum, value| {
            sum.checked_add(*value).ok_or(Error::InvalidTokens)
        })
    }

    fn counters(&self) -> [u64; 6] {
        [
            self.input_uncached,
            self.cache_read,
            self.cache_write_5m,
            self.cache_write_1h,
            self.output,
            self.reasoning_output,
        ]
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Usage {
    pub id: Id,
    pub execution_id: Id,
    pub account_id: Id,
    pub offset_ms: u32,
    pub provider: Provider,
    pub auth_mode: AuthMode,
    pub evidence: Evidence,
    pub model_id: u32,
    pub context_tier: u16,
    pub tokens: Tokens,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Prompt {
    pub id: Id,
    pub execution_id: Id,
    pub account_id: Id,
    pub offset_ms: u32,
    pub provider: Provider,
    pub origin: Origin,
    pub evidence: Evidence,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Interval {
    pub execution_id: Id,
    pub account_id: Id,
    pub start_ms: u32,
    pub end_ms: u32,
    pub provider: Provider,
    pub kind: IntervalKind,
    pub evidence: Evidence,
    pub clock_uncertainty_ms: u32,
}

impl Interval {
    fn key(&self) -> (Id, IntervalKind, u32, u32, Id, Provider) {
        (
            self.execution_id,
            self.kind,
            self.start_ms,
            self.end_ms,
            self.account_id,
            self.provider,
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Batch {
    pub utc_day: u32,
    pub registry_revision: u32,
    pub usage: Vec<Usage>,
    pub prompts: Vec<Prompt>,
    pub intervals: Vec<Interval>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Registry {
    pub revision: u32,
    pub models: Vec<(Provider, u32)>,
}

#[derive(Clone, Copy, Debug)]
pub struct Policy<'a> {
    pub first_day: u32,
    pub last_day: u32,
    pub registry: &'a Registry,
}

/// Fixed error codes never contain input bytes, identifiers, or field values.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Error {
    InvalidPolicy,
    InvalidLength,
    InvalidMagic,
    UnsupportedVersion,
    ReservedField,
    RecordLimit,
    EmptyBatch,
    DayOutOfRange,
    RegistryMismatch,
    UnknownModel,
    UnsupportedValue,
    InvalidEvidence,
    InvalidId,
    InvalidOffset,
    InvalidInterval,
    InvalidClockUncertainty,
    InvalidTokens,
    NonCanonicalOrder,
}

impl Error {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidPolicy => "invalid_policy",
            Self::InvalidLength => "invalid_length",
            Self::InvalidMagic => "invalid_magic",
            Self::UnsupportedVersion => "unsupported_version",
            Self::ReservedField => "reserved_field",
            Self::RecordLimit => "record_limit",
            Self::EmptyBatch => "empty_batch",
            Self::DayOutOfRange => "day_out_of_range",
            Self::RegistryMismatch => "registry_mismatch",
            Self::UnknownModel => "unknown_model",
            Self::UnsupportedValue => "unsupported_value",
            Self::InvalidEvidence => "invalid_evidence",
            Self::InvalidId => "invalid_id",
            Self::InvalidOffset => "invalid_offset",
            Self::InvalidInterval => "invalid_interval",
            Self::InvalidClockUncertainty => "invalid_clock_uncertainty",
            Self::InvalidTokens => "invalid_tokens",
            Self::NonCanonicalOrder => "non_canonical_order",
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

impl std::error::Error for Error {}

fn packet_size(usage: usize, prompts: usize, intervals: usize) -> Result<usize, Error> {
    if [usage, prompts, intervals]
        .iter()
        .any(|count| *count > MAX_RECORDS)
    {
        return Err(Error::RecordLimit);
    }
    if usage + prompts + intervals == 0 {
        return Err(Error::EmptyBatch);
    }
    // Counts have already been bounded, including on 32-bit platforms.
    Ok(HEADER_BYTES + usage * USAGE_BYTES + prompts * PROMPT_BYTES + intervals * INTERVAL_BYTES)
}

fn validate_policy(policy: &Policy<'_>) -> Result<(), Error> {
    if policy.first_day > policy.last_day {
        return Err(Error::InvalidPolicy);
    }
    Ok(())
}

fn validate(batch: &Batch, policy: &Policy<'_>) -> Result<usize, Error> {
    validate_policy(policy)?;
    let size = packet_size(
        batch.usage.len(),
        batch.prompts.len(),
        batch.intervals.len(),
    )?;
    if !(policy.first_day..=policy.last_day).contains(&batch.utc_day) {
        return Err(Error::DayOutOfRange);
    }
    if batch.registry_revision != policy.registry.revision {
        return Err(Error::RegistryMismatch);
    }
    for record in &batch.usage {
        if record.id == [0; 16] {
            return Err(Error::InvalidId);
        }
        if record.offset_ms >= DAY_MS {
            return Err(Error::InvalidOffset);
        }
        if record.context_tier != 0 {
            return Err(Error::UnsupportedValue);
        }
        if record.model_id != 0
            && !policy
                .registry
                .models
                .contains(&(record.provider, record.model_id))
        {
            return Err(Error::UnknownModel);
        }
        if record.tokens.total()? == 0
            || (record.provider == Provider::Codex
                && (record.tokens.cache_write_5m != 0 || record.tokens.cache_write_1h != 0))
        {
            return Err(Error::InvalidTokens);
        }
    }
    if batch.usage.windows(2).any(|pair| pair[0].id >= pair[1].id) {
        return Err(Error::NonCanonicalOrder);
    }
    for record in &batch.prompts {
        if record.id == [0; 16] {
            return Err(Error::InvalidId);
        }
        if record.offset_ms >= DAY_MS {
            return Err(Error::InvalidOffset);
        }
    }
    if batch
        .prompts
        .windows(2)
        .any(|pair| pair[0].id >= pair[1].id)
    {
        return Err(Error::NonCanonicalOrder);
    }
    for record in &batch.intervals {
        if record.execution_id == [0; 16] {
            return Err(Error::InvalidId);
        }
        if record.start_ms >= record.end_ms || record.end_ms > DAY_MS {
            return Err(Error::InvalidInterval);
        }
        if record.clock_uncertainty_ms > MAX_CLOCK_UNCERTAINTY_MS {
            return Err(Error::InvalidClockUncertainty);
        }
    }
    if batch
        .intervals
        .windows(2)
        .any(|pair| pair[0].key() >= pair[1].key())
    {
        return Err(Error::NonCanonicalOrder);
    }
    Ok(size)
}

/// Encode validated data without sorting, deduplicating, or correcting it.
pub fn encode(batch: &Batch, policy: &Policy<'_>) -> Result<Vec<u8>, Error> {
    let size = validate(batch, policy)?;
    let mut out = Vec::with_capacity(size);
    out.extend_from_slice(b"AICU");
    out.extend_from_slice(&1_u16.to_le_bytes());
    out.extend_from_slice(&0_u16.to_le_bytes());
    out.extend_from_slice(&batch.utc_day.to_le_bytes());
    out.extend_from_slice(&(batch.usage.len() as u16).to_le_bytes());
    out.extend_from_slice(&(batch.prompts.len() as u16).to_le_bytes());
    out.extend_from_slice(&(batch.intervals.len() as u16).to_le_bytes());
    out.extend_from_slice(&0_u16.to_le_bytes());
    out.extend_from_slice(&batch.registry_revision.to_le_bytes());
    for record in &batch.usage {
        out.extend_from_slice(&record.id);
        out.extend_from_slice(&record.execution_id);
        out.extend_from_slice(&record.account_id);
        out.extend_from_slice(&record.offset_ms.to_le_bytes());
        out.push(record.provider as u8);
        out.push(record.auth_mode as u8);
        out.extend_from_slice(&(record.evidence as u16).to_le_bytes());
        out.extend_from_slice(&record.model_id.to_le_bytes());
        out.extend_from_slice(&record.context_tier.to_le_bytes());
        out.extend_from_slice(&0_u16.to_le_bytes());
        for count in record.tokens.counters() {
            out.extend_from_slice(&count.to_le_bytes());
        }
    }
    for record in &batch.prompts {
        out.extend_from_slice(&record.id);
        out.extend_from_slice(&record.execution_id);
        out.extend_from_slice(&record.account_id);
        out.extend_from_slice(&record.offset_ms.to_le_bytes());
        out.push(record.provider as u8);
        out.push(record.origin as u8);
        out.extend_from_slice(&(record.evidence as u16).to_le_bytes());
    }
    for record in &batch.intervals {
        out.extend_from_slice(&record.execution_id);
        out.extend_from_slice(&record.account_id);
        out.extend_from_slice(&record.start_ms.to_le_bytes());
        out.extend_from_slice(&record.end_ms.to_le_bytes());
        out.push(record.provider as u8);
        out.push(record.kind as u8);
        out.extend_from_slice(&(record.evidence as u16).to_le_bytes());
        out.extend_from_slice(&record.clock_uncertainty_ms.to_le_bytes());
    }
    debug_assert_eq!(out.len(), size);
    Ok(out)
}

struct Reader<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl Reader<'_> {
    fn bytes<const N: usize>(&mut self) -> Result<[u8; N], Error> {
        let end = self.position.checked_add(N).ok_or(Error::InvalidLength)?;
        let source = self
            .bytes
            .get(self.position..end)
            .ok_or(Error::InvalidLength)?;
        let mut result = [0; N];
        result.copy_from_slice(source);
        self.position = end;
        Ok(result)
    }

    fn u8(&mut self) -> Result<u8, Error> {
        Ok(self.bytes::<1>()?[0])
    }

    fn u16(&mut self) -> Result<u16, Error> {
        Ok(u16::from_le_bytes(self.bytes()?))
    }

    fn u32(&mut self) -> Result<u32, Error> {
        Ok(u32::from_le_bytes(self.bytes()?))
    }

    fn u64(&mut self) -> Result<u64, Error> {
        Ok(u64::from_le_bytes(self.bytes()?))
    }

    fn reserved(&mut self) -> Result<(), Error> {
        if self.u16()? != 0 {
            return Err(Error::ReservedField);
        }
        Ok(())
    }
}

/// Decode a fully buffered, uncompressed packet under an explicit day/registry policy.
/// Framing and all record counts are checked before record allocation.
pub fn decode(bytes: &[u8], policy: &Policy<'_>) -> Result<Batch, Error> {
    validate_policy(policy)?;
    if !(HEADER_BYTES..=MAX_PACKET_BYTES).contains(&bytes.len()) {
        return Err(Error::InvalidLength);
    }
    let mut reader = Reader { bytes, position: 0 };
    if &reader.bytes::<4>()? != b"AICU" {
        return Err(Error::InvalidMagic);
    }
    if reader.u16()? != 1 {
        return Err(Error::UnsupportedVersion);
    }
    reader.reserved()?;
    let utc_day = reader.u32()?;
    let usage_count = usize::from(reader.u16()?);
    let prompt_count = usize::from(reader.u16()?);
    let interval_count = usize::from(reader.u16()?);
    reader.reserved()?;
    let registry_revision = reader.u32()?;
    let size = packet_size(usage_count, prompt_count, interval_count)?;
    if size != bytes.len() {
        return Err(Error::InvalidLength);
    }
    if !(policy.first_day..=policy.last_day).contains(&utc_day) {
        return Err(Error::DayOutOfRange);
    }
    if registry_revision != policy.registry.revision {
        return Err(Error::RegistryMismatch);
    }
    let mut batch = Batch {
        utc_day,
        registry_revision,
        usage: Vec::with_capacity(usage_count),
        prompts: Vec::with_capacity(prompt_count),
        intervals: Vec::with_capacity(interval_count),
    };
    for _ in 0..usage_count {
        let id = reader.bytes()?;
        let execution_id = reader.bytes()?;
        let account_id = reader.bytes()?;
        let offset_ms = reader.u32()?;
        let provider = Provider::try_from(reader.u8()?)?;
        let auth_mode = AuthMode::try_from(reader.u8()?)?;
        let evidence = Evidence::from_flags(reader.u16()?)?;
        let model_id = reader.u32()?;
        let context_tier = reader.u16()?;
        reader.reserved()?;
        let tokens = Tokens {
            input_uncached: reader.u64()?,
            cache_read: reader.u64()?,
            cache_write_5m: reader.u64()?,
            cache_write_1h: reader.u64()?,
            output: reader.u64()?,
            reasoning_output: reader.u64()?,
        };
        batch.usage.push(Usage {
            id,
            execution_id,
            account_id,
            offset_ms,
            provider,
            auth_mode,
            evidence,
            model_id,
            context_tier,
            tokens,
        });
    }
    for _ in 0..prompt_count {
        batch.prompts.push(Prompt {
            id: reader.bytes()?,
            execution_id: reader.bytes()?,
            account_id: reader.bytes()?,
            offset_ms: reader.u32()?,
            provider: Provider::try_from(reader.u8()?)?,
            origin: Origin::try_from(reader.u8()?)?,
            evidence: Evidence::from_flags(reader.u16()?)?,
        });
    }
    for _ in 0..interval_count {
        batch.intervals.push(Interval {
            execution_id: reader.bytes()?,
            account_id: reader.bytes()?,
            start_ms: reader.u32()?,
            end_ms: reader.u32()?,
            provider: Provider::try_from(reader.u8()?)?,
            kind: IntervalKind::try_from(reader.u8()?)?,
            evidence: Evidence::from_flags(reader.u16()?)?,
            clock_uncertainty_ms: reader.u32()?,
        });
    }
    validate(&batch, policy)?;
    debug_assert_eq!(reader.position, bytes.len());
    Ok(batch)
}

#[cfg(test)]
mod tests;
