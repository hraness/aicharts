//! Bounded completed-prefix replay. No source discovery, persistence or output.
//! The caller owns stable file/path checks and the ledger's atomic admission.

use std::fs::File;
use std::io::{self, BufReader, Read, Seek, SeekFrom};

use aicharts_core::{parse_reader, Collection};
use aicharts_ledger::CompletePrefix;
use aicharts_protocol::Provider;
use hmac::{Hmac, Mac};
use sha2::Sha256;

const DOMAIN: &[u8] = b"aicharts-local-source-prefix-v1\0";
const BUFFER_BYTES: usize = 16 * 1024;
type Digest = Hmac<Sha256>;

/// Replays exactly the last LF-terminated prefix within observed_bytes. Both MACs
/// cover bytes read beneath BufReader, so parser prefetch is hashed only once.
/// The checkpoint key never substitutes for the separately supplied occurrence key.
pub(super) fn collect_prefix(
    file: &mut File,
    source_id: &[u8; 32],
    checkpoint_key: &[u8; 32],
    occurrence_key: &[u8; 32],
    observed_bytes: u64,
    previous: Option<CompletePrefix>,
    provider: Provider,
) -> Result<(Collection, CompletePrefix), &'static str> {
    collect_reader(
        file,
        source_id,
        checkpoint_key,
        occurrence_key,
        observed_bytes,
        previous,
        provider,
    )
}

fn begin(key: &[u8; 32], source_id: &[u8; 32], bytes: u64) -> Digest {
    let mut mac = Digest::new_from_slice(key).expect("HMAC accepts every key length");
    mac.update(DOMAIN);
    mac.update(source_id);
    mac.update(&bytes.to_le_bytes());
    mac
}

fn completed_bytes<R: Read + Seek>(reader: &mut R, observed: u64) -> Result<u64, &'static str> {
    let mut buffer = [0; BUFFER_BYTES];
    let mut end = observed;
    while end != 0 {
        let start = end.saturating_sub(BUFFER_BYTES as u64);
        let length = (end - start) as usize;
        reader
            .seek(SeekFrom::Start(start))
            .map_err(|_| "source_read_failed")?;
        reader
            .read_exact(&mut buffer[..length])
            .map_err(|_| "source_read_failed")?;
        if let Some(offset) = buffer[..length].iter().rposition(|byte| *byte == b'\n') {
            return Ok(start + offset as u64 + 1);
        }
        end = start;
    }
    Ok(0)
}

struct Replay<'a, R> {
    reader: &'a mut R,
    complete: u64,
    read: u64,
    new_mac: Digest,
    old_mac: Option<Digest>,
    old_bytes: u64,
    old_boundary: Option<u8>,
    last: Option<u8>,
    read_failed: bool,
}

impl<R: Read> Read for Replay<'_, R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let length = (self.complete - self.read).min(buffer.len() as u64) as usize;
        if length == 0 {
            return Ok(0);
        }
        let count = self.reader.read(&mut buffer[..length]).inspect_err(|_| {
            self.read_failed = true;
        })?;
        let bytes = &buffer[..count];
        self.new_mac.update(bytes);
        if let Some(mac) = &mut self.old_mac {
            let old_count = self.old_bytes.saturating_sub(self.read).min(count as u64) as usize;
            mac.update(&bytes[..old_count]);
            if self.read < self.old_bytes && self.read + count as u64 >= self.old_bytes {
                self.old_boundary = Some(bytes[old_count - 1]);
            }
        }
        self.read += count as u64;
        if let Some(last) = bytes.last() {
            self.last = Some(*last);
        }
        Ok(count)
    }
}

fn collect_reader<R: Read + Seek>(
    reader: &mut R,
    source_id: &[u8; 32],
    checkpoint_key: &[u8; 32],
    occurrence_key: &[u8; 32],
    observed_bytes: u64,
    previous: Option<CompletePrefix>,
    provider: Provider,
) -> Result<(Collection, CompletePrefix), &'static str> {
    if source_id == &[0; 32] || previous.is_some_and(|prefix| prefix.profile != 1) {
        return Err("source_prefix_invalid");
    }
    if checkpoint_key == &[0; 32] || occurrence_key == &[0; 32] {
        return Err("invalid_key_file");
    }
    if observed_bytes > crate::MAX_SOURCE_BYTES {
        return Err("source_byte_limit");
    }
    if previous.is_some_and(|prefix| prefix.bytes > observed_bytes) {
        return Err("source_history_changed");
    }
    let complete = completed_bytes(reader, observed_bytes)?;
    if previous.is_some_and(|prefix| prefix.bytes > complete) {
        return Err("source_history_changed");
    }
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|_| "source_read_failed")?;
    let mut replay = Replay {
        reader,
        complete,
        read: 0,
        new_mac: begin(checkpoint_key, source_id, complete),
        old_mac: previous.map(|prefix| begin(checkpoint_key, source_id, prefix.bytes)),
        old_bytes: previous.map_or(0, |prefix| prefix.bytes),
        old_boundary: None,
        last: None,
        read_failed: false,
    };
    let parsed = parse_reader(
        BufReader::with_capacity(BUFFER_BYTES, &mut replay),
        provider,
        occurrence_key,
    );
    if replay.read_failed {
        return Err("source_read_failed");
    }
    let collection = parsed.map_err(|_| "source_parse_failed")?;
    if replay.read != complete || (complete != 0 && replay.last != Some(b'\n')) {
        return Err("source_changed_during_scan");
    }
    if let Some(previous) = previous {
        if (previous.bytes != 0 && replay.old_boundary != Some(b'\n'))
            || replay
                .old_mac
                .take()
                .ok_or("source_prefix_invalid")?
                .verify_slice(&previous.mac)
                .is_err()
        {
            return Err("source_history_changed");
        }
    }
    Ok((
        collection,
        CompletePrefix {
            profile: 1,
            bytes: complete,
            mac: replay.new_mac.finalize().into_bytes().into(),
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const SOURCE: [u8; 32] = [3; 32];
    const CHECKPOINT: [u8; 32] = [5; 32];
    const OCCURRENCE: [u8; 32] = [7; 32];
    const PRIVATE: &str = "PRIVATE_PREFIX_CANARY_d6f82";

    fn source(output: u64) -> Vec<u8> {
        (serde_json::json!({"type":"assistant","requestId":"request_a","sessionId":"session_a","timestamp":"2026-09-10T10:00:00Z",
            "cwd":PRIVATE,"message":{"id":"message_a","content":[{"type":"text","text":PRIVATE}],
                "usage":{"input_tokens":100,"output_tokens":output,"cache_read_input_tokens":50,"cache_creation_input_tokens":0}}}).to_string()+"\n").into_bytes()
    }

    fn expected(bytes: &[u8], key: &[u8; 32], source_id: &[u8; 32]) -> CompletePrefix {
        // Independent concatenation freezes domain, field order and LE length.
        let mut preimage = b"aicharts-local-source-prefix-v1\0".to_vec();
        preimage.extend_from_slice(source_id);
        preimage.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
        preimage.extend_from_slice(bytes);
        let mut mac = Digest::new_from_slice(key).unwrap();
        mac.update(&preimage);
        CompletePrefix {
            profile: 1,
            bytes: bytes.len() as u64,
            mac: mac.finalize().into_bytes().into(),
        }
    }

    fn collect(
        bytes: &[u8],
        previous: Option<CompletePrefix>,
    ) -> Result<(Collection, CompletePrefix), &'static str> {
        collect_reader(
            &mut Cursor::new(bytes),
            &SOURCE,
            &CHECKPOINT,
            &OCCURRENCE,
            bytes.len() as u64,
            previous,
            Provider::ClaudeCode,
        )
    }

    fn frames(collection: &Collection) -> Vec<Vec<u8>> {
        let registry = aicharts_protocol::Registry {
            revision: 1,
            models: vec![],
        };
        let policy = aicharts_protocol::Policy {
            first_day: 0,
            last_day: u32::MAX,
            registry: &registry,
        };
        collection
            .batches
            .iter()
            .map(|batch| aicharts_protocol::encode(batch, &policy).unwrap())
            .collect()
    }

    #[test]
    fn exact_mac_layout_and_complete_replay_preserve_numeric_projection() {
        let bytes = source(20);
        let (collection, witness) = collect(&bytes, None).unwrap();
        assert_eq!(witness, expected(&bytes, &CHECKPOINT, &SOURCE));
        let direct = parse_reader(Cursor::new(&bytes), Provider::ClaudeCode, &OCCURRENCE).unwrap();
        assert_eq!(frames(&collection), frames(&direct));
        assert_eq!(collection.lines_read, 1);
        assert!(!format!("{collection:?}").contains(PRIVATE));
    }

    #[test]
    fn partial_json_utf8_escape_and_valid_unterminated_record_are_never_parsed() {
        let prefix = source(20);
        for tail in [
            b"{".as_slice(),
            b"\xff\xfe",
            br#"{"text":"unterminated\"#,
            &source(30)[..source(30).len() - 1],
        ] {
            let mut bytes = prefix.clone();
            bytes.extend_from_slice(tail);
            let (collection, witness) =
                collect(&bytes, Some(expected(&prefix, &CHECKPOINT, &SOURCE))).unwrap();
            assert_eq!(witness, expected(&prefix, &CHECKPOINT, &SOURCE));
            assert_eq!(collection.batches[0].usage[0].tokens.output, 20);
            assert_eq!(collection.lines_read, 1);
        }
    }

    #[test]
    fn no_newline_is_keyed_empty_prefix_and_does_not_validate_partial_record() {
        for bytes in [
            vec![],
            b"not JSON".to_vec(),
            vec![b'x'; BUFFER_BYTES * 3 + 1],
        ] {
            let (collection, witness) = collect(&bytes, None).unwrap();
            assert!(collection.batches.is_empty());
            assert_eq!(collection.lines_read, 0);
            assert_eq!(witness, expected(&[], &CHECKPOINT, &SOURCE));
            assert_eq!(collect(&bytes, Some(witness)).unwrap().1, witness);
        }
    }

    #[test]
    fn finishing_tail_replays_prior_records_and_new_streaming_revision() {
        let prefix = source(20);
        let previous = expected(&prefix, &CHECKPOINT, &SOURCE);
        let mut bytes = prefix;
        bytes.extend_from_slice(&source(30));
        let (collection, witness) = collect(&bytes, Some(previous)).unwrap();
        assert_eq!(collection.lines_read, 2);
        assert_eq!(collection.batches[0].usage.len(), 1);
        assert_eq!(collection.batches[0].usage[0].tokens.output, 30);
        assert_eq!(witness, expected(&bytes, &CHECKPOINT, &SOURCE));
    }

    #[test]
    fn old_prefix_edit_is_rejected_even_when_it_changes_only_ignored_text() {
        let bytes = source(20);
        let previous = expected(&bytes, &CHECKPOINT, &SOURCE);
        let edited = String::from_utf8(bytes.clone())
            .unwrap()
            .replace(PRIVATE, "PRIVATE_PREFIX_CANARY_d6f83")
            .into_bytes();
        assert_eq!(edited.len(), bytes.len());
        assert_eq!(
            frames(&collect(&edited, None).unwrap().0),
            frames(&collect(&bytes, None).unwrap().0)
        );
        assert_eq!(
            collect(&edited, Some(previous)).err(),
            Some("source_history_changed")
        );
    }

    #[test]
    fn old_boundary_must_be_complete_and_cannot_shrink_or_change_binding() {
        let bytes = source(20);
        let previous = expected(&bytes, &CHECKPOINT, &SOURCE);
        assert_eq!(
            collect(&bytes[..bytes.len() - 1], Some(previous)).err(),
            Some("source_history_changed")
        );
        let old_not_line = expected(&bytes[..10], &CHECKPOINT, &SOURCE);
        assert_eq!(
            collect(&bytes, Some(old_not_line)).err(),
            Some("source_history_changed")
        );
        for bad in [
            CompletePrefix {
                mac: [0; 32],
                ..previous
            },
            expected(&bytes, &OCCURRENCE, &SOURCE),
            expected(&bytes, &CHECKPOINT, &[4; 32]),
        ] {
            assert_eq!(
                collect(&bytes, Some(bad)).err(),
                Some("source_history_changed")
            );
        }
    }

    #[test]
    fn occurrence_key_changes_ids_without_changing_checkpoint_mac() {
        let bytes = source(20);
        let (old, old_prefix) = collect(&bytes, None).unwrap();
        let (new, new_prefix) = collect_reader(
            &mut Cursor::new(&bytes),
            &SOURCE,
            &CHECKPOINT,
            &[8; 32],
            bytes.len() as u64,
            None,
            Provider::ClaudeCode,
        )
        .unwrap();
        assert_eq!(old_prefix, new_prefix);
        assert_ne!(old.batches[0].usage[0].id, new.batches[0].usage[0].id);
        assert_eq!(
            old.batches[0].usage[0].tokens,
            new.batches[0].usage[0].tokens
        );
    }

    struct Chunks {
        source: Cursor<Vec<u8>>,
        chunk: usize,
        bytes_read: u64,
        seeks: Vec<u64>,
    }
    impl Read for Chunks {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            let length = buffer.len().min(self.chunk);
            let read = self.source.read(&mut buffer[..length])?;
            self.bytes_read += read as u64;
            Ok(read)
        }
    }
    impl Seek for Chunks {
        fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
            let result = self.source.seek(position)?;
            self.seeks.push(result);
            Ok(result)
        }
    }

    #[test]
    fn chunking_prefetch_and_reverse_window_boundaries_preserve_exact_digest() {
        for tail in [
            0,
            1,
            BUFFER_BYTES - 1,
            BUFFER_BYTES,
            BUFFER_BYTES + 1,
            2 * BUFFER_BYTES + 3,
        ] {
            for chunk in [1, 7, 1024, BUFFER_BYTES] {
                let prefix = source(20);
                let mut bytes = prefix.clone();
                bytes.extend(std::iter::repeat_n(b'x', tail));
                let observed = bytes.len() as u64;
                let mut input = Chunks {
                    source: Cursor::new(bytes),
                    chunk,
                    bytes_read: 0,
                    seeks: vec![],
                };
                let (_, actual) = collect_reader(
                    &mut input,
                    &SOURCE,
                    &CHECKPOINT,
                    &OCCURRENCE,
                    observed,
                    Some(expected(&prefix, &CHECKPOINT, &SOURCE)),
                    Provider::ClaudeCode,
                )
                .unwrap();
                assert_eq!(actual, expected(&prefix, &CHECKPOINT, &SOURCE));
                // Reverse discovery reads no more than the observed file once;
                // replay reads exactly the completed prefix, without tail bytes.
                assert!(input.bytes_read <= observed + prefix.len() as u64);
                assert_eq!(input.source.position(), prefix.len() as u64);
            }
        }
    }

    #[test]
    fn observed_size_bounds_ignore_later_bytes_and_fail_closed_on_short_reads() {
        let prefix = source(20);
        let mut bytes = prefix.clone();
        bytes.extend_from_slice(b"PRIVATE later bytes\n");
        let (collection, witness) = collect_reader(
            &mut Cursor::new(bytes),
            &SOURCE,
            &CHECKPOINT,
            &OCCURRENCE,
            prefix.len() as u64,
            None,
            Provider::ClaudeCode,
        )
        .unwrap();
        assert_eq!(collection.lines_read, 1);
        assert_eq!(witness, expected(&prefix, &CHECKPOINT, &SOURCE));
        assert_eq!(
            collect_reader(
                &mut Cursor::new(&prefix),
                &SOURCE,
                &CHECKPOINT,
                &OCCURRENCE,
                prefix.len() as u64 + 1,
                None,
                Provider::ClaudeCode
            )
            .err(),
            Some("source_read_failed")
        );
    }

    #[test]
    fn invalid_inputs_refuse_before_any_source_io() {
        struct NoIo;
        impl Read for NoIo {
            fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
                panic!("must not read");
            }
        }
        impl Seek for NoIo {
            fn seek(&mut self, _: SeekFrom) -> io::Result<u64> {
                panic!("must not seek");
            }
        }
        assert_eq!(
            collect_reader(
                &mut NoIo,
                &SOURCE,
                &CHECKPOINT,
                &OCCURRENCE,
                crate::MAX_SOURCE_BYTES + 1,
                None,
                Provider::Codex
            )
            .err(),
            Some("source_byte_limit")
        );
        assert_eq!(
            collect_reader(
                &mut NoIo,
                &[0; 32],
                &CHECKPOINT,
                &OCCURRENCE,
                0,
                None,
                Provider::Codex
            )
            .err(),
            Some("source_prefix_invalid")
        );
        assert_eq!(
            collect_reader(
                &mut NoIo,
                &SOURCE,
                &[0; 32],
                &OCCURRENCE,
                0,
                None,
                Provider::Codex
            )
            .err(),
            Some("invalid_key_file")
        );
        assert_eq!(
            collect_reader(
                &mut NoIo,
                &SOURCE,
                &CHECKPOINT,
                &[0; 32],
                0,
                None,
                Provider::Codex
            )
            .err(),
            Some("invalid_key_file")
        );
        assert_eq!(
            collect_reader(
                &mut NoIo,
                &SOURCE,
                &CHECKPOINT,
                &OCCURRENCE,
                0,
                Some(CompletePrefix {
                    profile: 2,
                    bytes: 0,
                    mac: [0; 32]
                }),
                Provider::Codex
            )
            .err(),
            Some("source_prefix_invalid")
        );
        assert_eq!(
            collect_reader(
                &mut NoIo,
                &SOURCE,
                &CHECKPOINT,
                &OCCURRENCE,
                0,
                Some(CompletePrefix {
                    profile: 1,
                    bytes: 1,
                    mac: [0; 32]
                }),
                Provider::Codex
            )
            .err(),
            Some("source_history_changed")
        );
    }

    #[test]
    fn complete_malformed_or_oversized_lines_keep_parser_errors_fixed() {
        for bytes in [
            b"PRIVATE invalid JSON\n".to_vec(),
            [vec![b' '; aicharts_core::MAX_LINE_BYTES], vec![b'\n']].concat(),
        ] {
            assert_eq!(collect(&bytes, None).err(), Some("source_parse_failed"));
        }
    }

    #[test]
    fn late_codex_fork_replays_and_excludes_previously_parsed_usage() {
        let mut bytes=concat!(
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"session_a\"}}\n",
            "{\"type\":\"event_msg\",\"timestamp\":\"2026-09-10T10:00:00Z\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":10,\"cached_input_tokens\":0,\"output_tokens\":2,\"reasoning_output_tokens\":0},\"last_token_usage\":{\"input_tokens\":10,\"cached_input_tokens\":0,\"output_tokens\":2,\"reasoning_output_tokens\":0}}}}\n"
        ).as_bytes().to_vec();
        let (initial, previous) = collect_reader(
            &mut Cursor::new(&bytes),
            &SOURCE,
            &CHECKPOINT,
            &OCCURRENCE,
            bytes.len() as u64,
            None,
            Provider::Codex,
        )
        .unwrap();
        assert_eq!(initial.batches.len(), 1);
        assert_eq!(initial.batches[0].usage.len(), 1);
        assert_eq!(initial.batches[0].usage[0].tokens.output, 2);
        bytes.extend_from_slice(b"{\"type\":\"session_meta\",\"payload\":{\"id\":\"session_a\",\"forked_from_id\":\"parent_a\"}}\n");
        let (collection, _) = collect_reader(
            &mut Cursor::new(&bytes),
            &SOURCE,
            &CHECKPOINT,
            &OCCURRENCE,
            bytes.len() as u64,
            Some(previous),
            Provider::Codex,
        )
        .unwrap();
        assert_eq!(collection.lines_read, 3);
        assert!(collection.batches.is_empty());
        assert!(collection
            .warnings
            .contains(&aicharts_core::Warning::CodexForkUnsupported));
    }

    struct MutateBeforeReplay {
        source: Cursor<Vec<u8>>,
        replacement: Vec<u8>,
        seeks: usize,
    }
    impl Read for MutateBeforeReplay {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            self.source.read(buffer)
        }
    }
    impl Seek for MutateBeforeReplay {
        fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
            self.seeks += 1;
            if self.seeks == 2 {
                self.source = Cursor::new(self.replacement.clone());
            }
            self.source.seek(position)
        }
    }

    #[test]
    fn replay_cannot_certify_a_newly_unterminated_or_shorter_prefix() {
        let bytes = source(20);
        for replacement in [
            [bytes[..bytes.len() - 1].to_vec(), vec![b' ']].concat(),
            vec![],
        ] {
            let mut input = MutateBeforeReplay {
                source: Cursor::new(bytes.clone()),
                replacement,
                seeks: 0,
            };
            assert_eq!(
                collect_reader(
                    &mut input,
                    &SOURCE,
                    &CHECKPOINT,
                    &OCCURRENCE,
                    bytes.len() as u64,
                    None,
                    Provider::ClaudeCode
                )
                .err(),
                Some("source_changed_during_scan")
            );
        }
    }

    #[test]
    fn replay_mac_covers_changed_bytes_supplied_to_parser_not_discovery_pass() {
        let bytes = source(20);
        let replacement = source(30);
        assert_eq!(bytes.len(), replacement.len());
        let mut input = MutateBeforeReplay {
            source: Cursor::new(bytes.clone()),
            replacement: replacement.clone(),
            seeks: 0,
        };
        let (collection, witness) = collect_reader(
            &mut input,
            &SOURCE,
            &CHECKPOINT,
            &OCCURRENCE,
            bytes.len() as u64,
            None,
            Provider::ClaudeCode,
        )
        .unwrap();
        assert_eq!(collection.batches[0].usage[0].tokens.output, 30);
        assert_eq!(witness, expected(&replacement, &CHECKPOINT, &SOURCE));
        assert_ne!(witness, expected(&bytes, &CHECKPOINT, &SOURCE));
        let mut input = MutateBeforeReplay {
            source: Cursor::new(bytes.clone()),
            replacement,
            seeks: 0,
        };
        assert_eq!(
            collect_reader(
                &mut input,
                &SOURCE,
                &CHECKPOINT,
                &OCCURRENCE,
                bytes.len() as u64,
                Some(expected(&bytes, &CHECKPOINT, &SOURCE)),
                Provider::ClaudeCode
            )
            .err(),
            Some("source_history_changed")
        );
    }

    #[test]
    fn seek_and_replay_io_failures_never_echo_underlying_error_text() {
        struct Fails {
            source: Cursor<Vec<u8>>,
            seeks: usize,
            fail_seek: bool,
        }
        impl Seek for Fails {
            fn seek(&mut self, p: SeekFrom) -> io::Result<u64> {
                self.seeks += 1;
                if self.fail_seek {
                    Err(io::Error::other(PRIVATE))
                } else {
                    self.source.seek(p)
                }
            }
        }
        impl Read for Fails {
            fn read(&mut self, b: &mut [u8]) -> io::Result<usize> {
                if self.seeks >= 2 {
                    Err(io::Error::other(PRIVATE))
                } else {
                    self.source.read(b)
                }
            }
        }
        for fail_seek in [false, true] {
            let bytes = source(20);
            let observed = bytes.len() as u64;
            let mut input = Fails {
                source: Cursor::new(bytes),
                seeks: 0,
                fail_seek,
            };
            assert_eq!(
                collect_reader(
                    &mut input,
                    &SOURCE,
                    &CHECKPOINT,
                    &OCCURRENCE,
                    observed,
                    None,
                    Provider::ClaudeCode
                )
                .err(),
                Some("source_read_failed")
            );
        }
    }
}
