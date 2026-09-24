use vstd::prelude::*;
verus! {
#[derive(PartialEq, Eq)]
pub enum Error {
    Overflow,
    Underflow,
    Limit,
    InvalidPartition,
    MissingReasoning,
    MissingCacheTtl,
    MissingRate,
    ZeroDenominator,
    OwnerConflict,
    PopulationMismatch,
    MissingEvidence,
}
pub const fn checked_add(left: u128, right: u128) -> (result: Result<u128, Error>) 
 ensures match result { Ok(v) => v as int == left as int + right as int, Err(e) => e == Error::Overflow && left as int + right as int > u128::MAX as int },
{
    match left.checked_add(right) {
        Some(value) => Ok(value),
        None => Err(Error::Overflow),
    }
}
pub const fn checked_add_bounded(left: u128, right: u128, limit: u128) -> (result: Result<u128, Error>) 
 ensures match result { Ok(v) => v as int == left as int + right as int && v <= limit, Err(_) => left as int + right as int > u128::MAX as int || left as int + right as int > limit as int },
{
    match checked_add(left, right) {
        Ok(value) if value <= limit => Ok(value),
        Ok(_) => Err(Error::Limit),
        Err(error) => Err(error),
    }
}
pub const fn checked_replace(
    total: u128,
    previous: u128,
    replacement: u128,
) -> (result: Result<u128, Error>) 
 ensures match result { Ok(v) => previous <= total && v as int == total as int - previous as int + replacement as int, Err(_) => previous > total || total as int - previous as int + replacement as int > u128::MAX as int },
{
    match total.checked_sub(previous) {
        Some(remainder) => checked_add(remainder, replacement),
        None => Err(Error::Underflow),
    }
}
pub fn merge_owner(
    left: [u8; 16],
    right: [u8; 16],
    allow_unknown_enrichment: bool,
) -> (result: Result<[u8; 16], Error>) 
 ensures match result { Ok(v) => (left == right && v == left) || (allow_unknown_enrichment && ((left == [0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8] && v == right) || (right == [0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8] && v == left))), Err(e) => e == Error::OwnerConflict && left != right && (!allow_unknown_enrichment || (left != [0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8] && right != [0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8])) },
{
    if left == right {
        Ok(left)
    } else if allow_unknown_enrichment && left == [0; 16] {
        Ok(right)
    } else if allow_unknown_enrichment && right == [0; 16] {
        Ok(left)
    } else {
        Err(Error::OwnerConflict)
    }
}
pub struct InclusiveOutput { total: u128, reasoning: Option<u128> }
impl InclusiveOutput {
pub closed spec fn view(self) -> (u128, Option<u128>) { (self.total, self.reasoning) }
    pub const fn new(total: u128, reasoning: Option<u128>) -> (result: Result<Self, Error>) 
 ensures match result { Ok(v) => v.view().0 == total && v.view().1 == reasoning && (match reasoning {Some(r) => r <= total, None => true}), Err(e) => e == Error::InvalidPartition && (match reasoning {Some(r) => r > total, None => false}), },
{
        match reasoning {
            Some(value) if value > total => Err(Error::InvalidPartition),
            _ => Ok(Self { total, reasoning }),
        }
    }
    pub const fn disjoint(self) -> (result: Result<[u128; 2], Error>) 
 requires match self.view().1 {Some(r) => r <= self.view().0, None => true},
 ensures match result { Ok(v) => match self.view().1 {Some(r) => v[1] == r && v[0] as int + v[1] as int == self.view().0 as int, None => false}, Err(e) => e == Error::MissingReasoning && self.view().1.is_none(), },
{
        match self.reasoning {
            Some(reasoning) => Ok([self.total - reasoning, reasoning]),
            None => Err(Error::MissingReasoning),
        }
    }
}
}
