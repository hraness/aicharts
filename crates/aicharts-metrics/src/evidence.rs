use crate::{checked_add, Error, ExactRatio};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Basis {
    Reported,
    Derived,
    Estimated,
}

/// Unknown and unsupported are distinct from a known zero. These variants
/// describe evidence, not source authentication or enumeration completeness.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum QuantityEvidence {
    Known { value: u128, basis: Basis },
    Unknown,
    Unsupported,
}

/// Opaque, caller-established population identity and compatible metric units.
/// Equality is only a consistency predicate, never proof of source identity.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Population {
    pub identity: [u8; 16],
    pub unit: u16,
    pub grain: u16,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ScopedQuantity {
    pub population: Population,
    pub evidence: QuantityEvidence,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MatchedPair {
    pub left: u128,
    pub right: u128,
    pub left_basis: Basis,
    pub right_basis: Basis,
}

pub fn match_quantities(left: ScopedQuantity, right: ScopedQuantity) -> Result<MatchedPair, Error> {
    if left.population != right.population {
        return Err(Error::PopulationMismatch);
    }
    match (left.evidence, right.evidence) {
        (
            QuantityEvidence::Known {
                value: left,
                basis: left_basis,
            },
            QuantityEvidence::Known {
                value: right,
                basis: right_basis,
            },
        ) => Ok(MatchedPair {
            left,
            right,
            left_basis,
            right_basis,
        }),
        _ => Err(Error::MissingEvidence),
    }
}

impl MatchedPair {
    pub const fn ratio(self) -> Result<ExactRatio, Error> {
        ExactRatio::new(self.left, self.right)
    }
}

/// Additive sufficient state for an already-selected compatible population.
/// Exact observed, derived and estimated quantities remain separate, and each
/// known sum keeps its eligible count. A count is never a completeness claim.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct EvidenceTotals {
    pub reported: u128,
    pub reported_records: u128,
    pub derived: u128,
    pub derived_records: u128,
    pub estimated: u128,
    pub estimated_records: u128,
    pub unknown_records: u128,
    pub unsupported_records: u128,
}

impl EvidenceTotals {
    pub fn observe(self, evidence: QuantityEvidence) -> Result<Self, Error> {
        let mut next = self;
        match evidence {
            QuantityEvidence::Known { value, basis } => match basis {
                Basis::Reported => {
                    next.reported = checked_add(next.reported, value)?;
                    next.reported_records = checked_add(next.reported_records, 1)?;
                }
                Basis::Derived => {
                    next.derived = checked_add(next.derived, value)?;
                    next.derived_records = checked_add(next.derived_records, 1)?;
                }
                Basis::Estimated => {
                    next.estimated = checked_add(next.estimated, value)?;
                    next.estimated_records = checked_add(next.estimated_records, 1)?;
                }
            },
            QuantityEvidence::Unknown => {
                next.unknown_records = checked_add(next.unknown_records, 1)?;
            }
            QuantityEvidence::Unsupported => {
                next.unsupported_records = checked_add(next.unsupported_records, 1)?;
            }
        }
        Ok(next)
    }

    pub fn merge(self, other: Self) -> Result<Self, Error> {
        Ok(Self {
            reported: checked_add(self.reported, other.reported)?,
            reported_records: checked_add(self.reported_records, other.reported_records)?,
            derived: checked_add(self.derived, other.derived)?,
            derived_records: checked_add(self.derived_records, other.derived_records)?,
            estimated: checked_add(self.estimated, other.estimated)?,
            estimated_records: checked_add(self.estimated_records, other.estimated_records)?,
            unknown_records: checked_add(self.unknown_records, other.unknown_records)?,
            unsupported_records: checked_add(self.unsupported_records, other.unsupported_records)?,
        })
    }
}
