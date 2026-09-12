use super::*;
use std::io::{self, BufRead, Cursor, Read};

const KEY: [u8; 32] = [9; 32];
const META: &str = "{\"type\":\"session_meta\",\"payload\":{\"id\":\"thread\"}}\n";
const START: &str = "{\"type\":\"event_msg\",\"timestamp\":\"1970-01-01T00:00:00.001Z\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"turn\",\"root_turn_id\":\"turn\"}}\n";

#[test]
fn zero_byte_budget_is_real_eof_only() {
    let limits = TurnReadLimits::new(0, MAX_LINES, MAX_OBSERVATIONS).unwrap();
    assert!(parse_codex_turns_with_limits(Cursor::new(b""), &KEY, limits).is_ok());
    assert_eq!(
        parse_codex_turns_with_limits(Cursor::new(b"\n"), &KEY, limits).err(),
        Some(TurnError::ByteLimit)
    );
}

#[test]
fn zero_physical_budget_cannot_consume_a_row() {
    let limits = TurnReadLimits::new(MAX_SOURCE_BYTES, 0, MAX_OBSERVATIONS).unwrap();
    let mut reader = Cursor::new(b"\n");
    assert_eq!(
        parse_codex_turns_with_limits(&mut reader, &KEY, limits).err(),
        Some(TurnError::RecordLimit)
    );
    assert_eq!(reader.position(), 0);
    assert!(parse_codex_turns_with_limits(Cursor::new(b""), &KEY, limits).is_ok());
}

#[test]
fn lifecycle_budget_refuses_first_excess_record_not_the_rest_of_a_file() {
    let limits = TurnReadLimits::new(MAX_SOURCE_BYTES, MAX_LINES, 0).unwrap();
    let text = format!("{META}{START}{START}");
    let mut reader = Cursor::new(text.as_bytes());
    assert_eq!(
        parse_codex_turns_with_limits(&mut reader, &KEY, limits).err(),
        Some(TurnError::ObservationLimit)
    );
    assert_eq!(reader.position(), (META.len() + START.len()) as u64);
}

#[test]
fn exact_and_max_limits_preserve_full_profile_output() {
    let text = format!("{META}{START}");
    let exact = TurnReadLimits::new(text.len() as u64, 2, 1).unwrap();
    let a = parse_codex_turns_with_limits(Cursor::new(&text), &KEY, exact).unwrap();
    let b = parse_codex_turns(Cursor::new(&text), &KEY).unwrap();
    assert_eq!(a.daily_summary(), b.daily_summary());
    assert_eq!(
        TurnReadLimits::new(MAX_SOURCE_BYTES, MAX_LINES, MAX_OBSERVATIONS),
        Ok(TurnReadLimits::full())
    );
}

struct Failing;
impl Read for Failing {
    fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
        panic!("invalid limits must precede read")
    }
}
impl BufRead for Failing {
    fn fill_buf(&mut self) -> io::Result<&[u8]> {
        panic!("invalid limits must precede read")
    }
    fn consume(&mut self, _: usize) {
        panic!("invalid limits must precede read")
    }
}

#[test]
fn invalid_limits_fail_before_reader_or_evidence_allocation() {
    for (bytes, lines, lifecycle) in [
        (MAX_SOURCE_BYTES + 1, 0, 0),
        (0, MAX_LINES + 1, 0),
        (0, 0, MAX_OBSERVATIONS + 1),
        (u64::MAX, u64::MAX, u64::MAX),
    ] {
        assert_eq!(
            TurnReadLimits::new(bytes, lines, lifecycle),
            Err(TurnError::InvalidLimits)
        );
        // Module-private construction exercises the defensive parser entry check.
        assert_eq!(
            parse_codex_turns_with_limits(
                Failing,
                &KEY,
                TurnReadLimits {
                    bytes,
                    physical_records: lines,
                    raw_observations: lifecycle
                }
            )
            .err(),
            Some(TurnError::InvalidLimits)
        );
    }
}
