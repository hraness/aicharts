use crate::Error;

/// Owner zero means unknown in the current wire profile. This predicate does
/// not compare other context: the caller must first check provider, account,
/// evidence, model, authorization mode and context tier.
pub fn merge_owner(
    left: [u8; 16],
    right: [u8; 16],
    allow_unknown_enrichment: bool,
) -> Result<[u8; 16], Error> {
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Dominance {
    Equal,
    Left,
    Right,
    Conflict,
}

/// Compare existing complete revisions, without manufacturing a new vector.
/// Current occurrence reduction selects the right payload for Equal/Right and
/// the left for Left; timestamps are handled separately by its caller. This
/// partial comparison does not establish an associative merge over histories.
pub fn component_dominance<const N: usize>(left: [u64; N], right: [u64; N]) -> Dominance {
    let mut left_greater = false;
    let mut right_greater = false;
    for (left, right) in left.into_iter().zip(right) {
        left_greater |= left > right;
        right_greater |= right > left;
    }
    match (left_greater, right_greater) {
        (false, false) => Dominance::Equal,
        (true, false) => Dominance::Left,
        (false, true) => Dominance::Right,
        (true, true) => Dominance::Conflict,
    }
}
