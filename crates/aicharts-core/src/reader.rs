//! A bounded view of one physical JSONL line. No transcript line is copied.

use serde::de::DeserializeOwned;
use std::io::{self, BufRead, Read};

use crate::Error;

pub const MAX_LINE_BYTES: usize = 1_048_576;
pub const MAX_DEPTH: usize = 64;

struct Line<'a, R> {
    source: &'a mut R,
    bytes: usize,
    depth: usize,
    quoted: bool,
    escaped: bool,
    ended: bool,
    non_whitespace: bool,
    fault: Option<Error>,
}

impl<R: BufRead> Read for Line<'_, R> {
    fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
        if target.is_empty() || self.ended {
            return Ok(0);
        }
        let available = self.source.fill_buf().map_err(|_| {
            self.fault = Some(Error::ReadFailed);
            io::Error::other("read_failed")
        })?;
        if available.is_empty() {
            self.ended = true;
            return Ok(0);
        }
        let mut count = 0;
        for &byte in available.iter().take(target.len()) {
            self.bytes += 1;
            if self.bytes > MAX_LINE_BYTES {
                self.fault = Some(Error::LineTooLarge);
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
                            self.fault = Some(Error::TooDeep);
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
                break;
            }
        }
        self.source.consume(count);
        if let Some(fault) = self.fault {
            return Err(io::Error::other(fault.code()));
        }
        Ok(count)
    }
}

pub(crate) fn next_record<R: BufRead, T: DeserializeOwned>(
    reader: &mut R,
) -> Result<Option<Option<T>>, Error> {
    if reader.fill_buf().map_err(|_| Error::ReadFailed)?.is_empty() {
        return Ok(None);
    }
    let mut line = Line {
        source: reader,
        bytes: 0,
        depth: 0,
        quoted: false,
        escaped: false,
        ended: false,
        non_whitespace: false,
        fault: None,
    };
    let mut decoder = serde_json::Deserializer::from_reader(&mut line);
    let parsed = T::deserialize(&mut decoder).and_then(|value| decoder.end().map(|_| value));
    if let Some(fault) = line.fault {
        return Err(fault);
    }
    if !line.non_whitespace {
        return Ok(Some(None));
    }
    parsed
        .map(|value| Some(Some(value)))
        .map_err(|_| Error::MalformedRecord)
}
