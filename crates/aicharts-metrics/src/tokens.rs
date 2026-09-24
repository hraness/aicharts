use crate::{admit_decimal, checked_add, checked_sum, Error, MAX_WIRE_TOKEN_COUNTER};

/// V1's order is uncached input, cache read, 5m writes, 1h writes,
/// inclusive output, and its reasoning subset. Reasoning is never added twice.
pub fn wire_token_total(counters: [u64; 6]) -> Result<u64, Error> {
    if counters.iter().any(|value| *value > MAX_WIRE_TOKEN_COUNTER) {
        return Err(Error::Limit);
    }
    if counters[5] > counters[4] {
        return Err(Error::InvalidPartition);
    }
    let mut total = 0u64;
    for value in &counters[..5] {
        total = total.checked_add(*value).ok_or(Error::Overflow)?;
    }
    Ok(total)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CacheTtl {
    Unknown,
    Split { five_minute: u128, one_hour: u128 },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CacheWrites {
    total: u128,
    ttl: CacheTtl,
}

impl CacheWrites {
    pub const fn unknown(total: u128) -> Self {
        Self {
            total,
            ttl: CacheTtl::Unknown,
        }
    }

    pub fn with_ttl(total: u128, five_minute: u128, one_hour: u128) -> Result<Self, Error> {
        if checked_add(five_minute, one_hour)? != total {
            return Err(Error::InvalidPartition);
        }
        Ok(Self {
            total,
            ttl: CacheTtl::Split {
                five_minute,
                one_hour,
            },
        })
    }

    pub const fn total(self) -> u128 {
        self.total
    }

    pub const fn ttl(self) -> CacheTtl {
        self.ttl
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InclusiveOutput {
    total: u128,
    reasoning: Option<u128>,
}

impl InclusiveOutput {
    pub const fn new(total: u128, reasoning: Option<u128>) -> Result<Self, Error> {
        match reasoning {
            Some(value) if value > total => Err(Error::InvalidPartition),
            _ => Ok(Self { total, reasoning }),
        }
    }

    pub fn from_disjoint(visible: u128, reasoning: u128) -> Result<Self, Error> {
        Self::new(checked_add(visible, reasoning)?, Some(reasoning))
    }

    pub const fn total(self) -> u128 {
        self.total
    }

    pub const fn reasoning(self) -> Option<u128> {
        self.reasoning
    }

    pub const fn disjoint(self) -> Result<[u128; 2], Error> {
        match self.reasoning {
            Some(reasoning) => Ok([self.total - reasoning, reasoning]),
            None => Err(Error::MissingReasoning),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TokenPartition {
    pub input_uncached: u128,
    pub cache_read: u128,
    pub cache_write: CacheWrites,
    pub output: InclusiveOutput,
}

impl TokenPartition {
    pub fn total(self) -> Result<u128, Error> {
        checked_sum([
            self.input_uncached,
            self.cache_read,
            self.cache_write.total(),
            self.output.total(),
        ])
    }

    /// Callers must supply observation-level reasoning evidence. An unknown
    /// reasoning placeholder may only be zero; a nonzero value is never erased.
    pub fn from_wire(counters: [u64; 6], reasoning_known: bool) -> Result<Self, Error> {
        wire_token_total(counters)?;
        if !reasoning_known && counters[5] != 0 {
            return Err(Error::InvalidPartition);
        }
        let values = counters.map(u128::from);
        Ok(Self {
            input_uncached: values[0],
            cache_read: values[1],
            cache_write: CacheWrites::with_ttl(
                checked_add(values[2], values[3])?,
                values[2],
                values[3],
            )?,
            output: InclusiveOutput::new(values[4], reasoning_known.then_some(values[5]))?,
        })
    }

    /// Detailed v2 buckets declare output/reasoning disjoint. This conversion
    /// does not invent cache TTL or claim the selected population is complete.
    pub fn from_detailed(values: [u128; 5]) -> Result<Self, Error> {
        for value in values {
            admit_decimal(value)?;
        }
        Ok(Self {
            input_uncached: values[0],
            cache_read: values[1],
            cache_write: CacheWrites::unknown(values[2]),
            output: InclusiveOutput::from_disjoint(values[3], values[4])?,
        })
    }

    pub fn to_detailed(self) -> Result<[u128; 5], Error> {
        let [visible, reasoning] = self.output.disjoint()?;
        let values = [
            self.input_uncached,
            self.cache_read,
            self.cache_write.total(),
            visible,
            reasoning,
        ];
        for value in values {
            admit_decimal(value)?;
        }
        Ok(values)
    }

    /// Lossless numeric/TTL/subset conversion only. A caller that needs the v1
    /// zero-plus-warning convention must retain that warning in its own profile
    /// adapter; this function cannot make unknown evidence appear measured.
    pub fn to_wire(self) -> Result<[u64; 6], Error> {
        let CacheTtl::Split {
            five_minute,
            one_hour,
        } = self.cache_write.ttl()
        else {
            return Err(Error::MissingCacheTtl);
        };
        let reasoning = self.output.reasoning().ok_or(Error::MissingReasoning)?;
        let values = [
            self.input_uncached,
            self.cache_read,
            five_minute,
            one_hour,
            self.output.total(),
            reasoning,
        ];
        let mut counters = [0u64; 6];
        for (target, value) in counters.iter_mut().zip(values) {
            *target = u64::try_from(value).map_err(|_| Error::Limit)?;
        }
        wire_token_total(counters)?;
        Ok(counters)
    }
}
