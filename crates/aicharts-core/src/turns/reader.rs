//! Completed-LF view derived from the reviewed usage reader. The legacy reader
//! stays unchanged: its EOF contract differs from this lifecycle profile.

use super::TurnError;
use crate::{MAX_DEPTH, MAX_LINE_BYTES};
use serde::de::DeserializeOwned;
use std::io::{self, BufRead, Read};

pub(super) enum Record<T> {
    End,
    Complete(Option<T>),
    Partial,
}

pub(super) struct Budget<R> {
    source: R,
    pub bytes: u64,
    limit: u64,
    exceeded: bool,
}

impl<R> Budget<R> {
    pub fn new(source: R, limit: u64) -> Self {
        Self {
            source,
            bytes: 0,
            limit,
            exceeded: false,
        }
    }
}

impl<R: BufRead> Read for Budget<R> {
    fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
        if target.is_empty() {
            return Ok(0);
        }
        let available = self.fill_buf()?;
        let count = target.len().min(available.len());
        target[..count].copy_from_slice(&available[..count]);
        self.consume(count);
        Ok(count)
    }
}

impl<R: BufRead> BufRead for Budget<R> {
    fn fill_buf(&mut self) -> io::Result<&[u8]> {
        let available = self.source.fill_buf()?;
        let remaining = (self.limit - self.bytes) as usize;
        if remaining == 0 && !available.is_empty() {
            self.exceeded = true;
            return Err(io::Error::other("turn_byte_limit"));
        }
        Ok(&available[..available.len().min(remaining)])
    }

    fn consume(&mut self, amount: usize) {
        self.bytes += amount as u64;
        self.source.consume(amount);
    }
}

struct Line<'a, R> {
    source: &'a mut R,
    bytes: usize,
    depth: usize,
    quoted: bool,
    escaped: bool,
    ended: bool,
    lf: bool,
    non_whitespace: bool,
    fault: Option<TurnError>,
}

impl<R: BufRead> Read for Line<'_, R> {
    fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
        if target.is_empty() || self.ended {
            return Ok(0);
        }
        if let Some(fault) = self.fault {
            return Err(io::Error::other(fault.code()));
        }
        let available = self.source.fill_buf().map_err(|_| {
            self.fault = Some(TurnError::ReadFailed);
            io::Error::other("turn_read_failed")
        })?;
        if available.is_empty() {
            self.ended = true;
            return Ok(0);
        }
        let mut count = 0;
        for &byte in available.iter().take(target.len()) {
            self.bytes += 1;
            if self.bytes > MAX_LINE_BYTES {
                self.fault = Some(TurnError::LineTooLarge);
                break;
            }
            if !byte.is_ascii_whitespace() {
                self.non_whitespace = true;
            }
            if self.quoted {
                if self.escaped {
                    self.escaped = false;
                } else if byte == b'\\' {
                    self.escaped = true;
                } else if byte == b'"' {
                    self.quoted = false;
                }
            } else {
                match byte {
                    b'"' => self.quoted = true,
                    b'{' | b'[' => {
                        self.depth += 1;
                        if self.depth > MAX_DEPTH {
                            self.fault = Some(TurnError::TooDeep);
                            break;
                        }
                    }
                    b'}' | b']' => self.depth = self.depth.saturating_sub(1),
                    _ => {}
                }
            }
            target[count] = byte;
            count += 1;
            if byte == b'\n' {
                self.ended = true;
                self.lf = true;
                break;
            }
        }
        self.source.consume(count);
        match self.fault {
            Some(fault) => Err(io::Error::other(fault.code())),
            None => Ok(count),
        }
    }
}

pub(super) fn next<R: BufRead, T: DeserializeOwned>(
    reader: &mut Budget<R>,
) -> Result<Record<T>, TurnError> {
    let result = next_inner(reader);
    if reader.exceeded {
        Err(TurnError::ByteLimit)
    } else {
        result
    }
}

pub(super) fn has_bytes<R: BufRead>(reader: &mut Budget<R>) -> Result<bool, TurnError> {
    let available = reader.fill_buf().map(|bytes| !bytes.is_empty());
    match available {
        Ok(available) => Ok(available),
        Err(_) if reader.exceeded => Err(TurnError::ByteLimit),
        Err(_) => Err(TurnError::ReadFailed),
    }
}

fn next_inner<R: BufRead, T: DeserializeOwned>(reader: &mut R) -> Result<Record<T>, TurnError> {
    if reader
        .fill_buf()
        .map_err(|_| TurnError::ReadFailed)?
        .is_empty()
    {
        return Ok(Record::End);
    }
    let mut line = Line {
        source: reader,
        bytes: 0,
        depth: 0,
        quoted: false,
        escaped: false,
        ended: false,
        lf: false,
        non_whitespace: false,
        fault: None,
    };
    let mut decoder = serde_json::Deserializer::from_reader(&mut line);
    let parsed = T::deserialize(&mut decoder).and_then(|value| decoder.end().map(|_| value));
    // Malformed partial tails are deferred too. Drain only this bounded physical
    // line before deciding whether the parse failure belongs to a completed LF.
    let mut discard = [0; 1024];
    while !line.ended && line.fault.is_none() {
        if line.read(&mut discard).is_err() {
            break;
        }
    }
    if let Some(fault) = line.fault {
        return Err(fault);
    }
    if !line.lf {
        return Ok(Record::Partial);
    }
    if !line.non_whitespace {
        return Ok(Record::Complete(None));
    }
    parsed
        .map(|value| Record::Complete(Some(value)))
        .map_err(|_| TurnError::MalformedRecord)
}
