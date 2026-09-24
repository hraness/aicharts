//! Durable per-epoch revision assignment. The caller persists the ledger bytes
//! (authenticated) beside its native state; this module never touches files.
//! Unchanged facts keep their revision, changed values get a corrective
//! revision, and facts missing from a later export of the same window become
//! explicit retractions. Applying the same export twice changes nothing.

use super::{Fact, Owner, Report};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub const MAX_LEDGER_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 500_000;
const MAX_REVISION: u32 = u32::MAX - 1;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    revision: u32,
    digest: String,
    kind: String,
    provider: String,
    execution_id: String,
    conversation_id: Option<String>,
    lineage: String,
    parent_execution_id: Option<String>,
    at_ms: u64,
    retracted: bool,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Ledger {
    schema_version: u8,
    source_epoch: String,
    source_id: String,
    revision: u32,
    entries: BTreeMap<String, Entry>,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Applied {
    pub added: usize,
    pub corrected: usize,
    pub unchanged: usize,
    pub retracted: usize,
    pub revision: u32,
}

fn intern(value: &str) -> Option<&'static str> {
    [
        "codex",
        "claude_code",
        "devin",
        "root",
        "child",
        "unknown",
        "usage",
        "span",
        "request",
        "turn",
        "tool",
        "context",
        "compaction",
    ]
    .into_iter()
    .find(|known| *known == value)
}
fn digest(fact: &Fact) -> Result<String, &'static str> {
    // Revision-independent identity of the fact's asserted content.
    let body = (fact.kind, &fact.owner, fact.at_ms, &fact.value);
    let bytes = serde_json::to_vec(&body).map_err(|_| "summary_encode_failed")?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

impl Ledger {
    pub fn new(source_epoch: &str, source_id: &str) -> Self {
        Self {
            schema_version: 1,
            source_epoch: source_epoch.to_owned(),
            source_id: source_id.to_owned(),
            revision: 0,
            entries: BTreeMap::new(),
        }
    }
    pub fn source_epoch(&self) -> &str {
        &self.source_epoch
    }
    pub fn revision(&self) -> u32 {
        self.revision
    }
    pub fn len(&self) -> usize {
        self.entries.len()
    }
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
    pub fn encode(&self) -> Result<Vec<u8>, &'static str> {
        let bytes = serde_json::to_vec(self).map_err(|_| "summary_encode_failed")?;
        if bytes.len() > MAX_LEDGER_BYTES {
            return Err("ledger_size_limit");
        }
        Ok(bytes)
    }
    pub fn decode(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.len() > MAX_LEDGER_BYTES {
            return Err("ledger_size_limit");
        }
        let ledger: Self = serde_json::from_slice(bytes).map_err(|_| "invalid_ledger")?;
        if ledger.schema_version != 1
            || ledger.entries.len() > MAX_ENTRIES
            || ledger.revision > MAX_REVISION
            || ledger.entries.values().any(|entry| {
                entry.revision > ledger.revision
                    || entry.revision == 0
                    || intern(&entry.kind).is_none()
                    || intern(&entry.provider).is_none()
                    || intern(&entry.lineage).is_none()
            })
        {
            return Err("invalid_ledger");
        }
        Ok(ledger)
    }

    /// Assign revisions in place and append retractions for this window.
    pub fn apply(&mut self, report: &mut Report) -> Result<Applied, &'static str> {
        if report.provenance.source_id != self.source_id {
            return Err("ledger_source_mismatch");
        }
        let next = self.revision.checked_add(1).ok_or("revision_limit")?;
        if next > MAX_REVISION {
            return Err("revision_limit");
        }
        let mut applied = Applied::default();
        let mut present = std::collections::HashSet::new();
        for fact in &mut report.facts {
            if fact.value.is_none() {
                return Err("invalid_export");
            }
            if !present.insert(fact.id.clone()) {
                return Err("conflicting_fact");
            }
            let digest = digest(fact)?;
            match self.entries.get_mut(&fact.id) {
                Some(entry) if entry.digest == digest && !entry.retracted => {
                    fact.revision = entry.revision;
                    applied.unchanged += 1;
                }
                Some(entry) => {
                    entry.revision = next;
                    entry.digest = digest;
                    entry.retracted = false;
                    entry.at_ms = fact.at_ms;
                    fact.revision = next;
                    applied.corrected += 1;
                }
                None => {
                    if self.entries.len() >= MAX_ENTRIES {
                        return Err("record_limit");
                    }
                    self.entries.insert(
                        fact.id.clone(),
                        Entry {
                            revision: next,
                            digest,
                            kind: fact.kind.to_owned(),
                            provider: fact.owner.provider.to_owned(),
                            execution_id: fact.owner.execution_id.clone(),
                            conversation_id: fact.owner.conversation_id.clone(),
                            lineage: fact.owner.lineage.to_owned(),
                            parent_execution_id: fact.owner.parent_execution_id.clone(),
                            at_ms: fact.at_ms,
                            retracted: false,
                        },
                    );
                    fact.revision = next;
                    applied.added += 1;
                }
            }
        }
        let (start, end) = (report.window.start_ms, report.window.end_ms);
        for (id, entry) in &mut self.entries {
            if entry.retracted || present.contains(id) || entry.at_ms < start || entry.at_ms >= end
            {
                continue;
            }
            entry.retracted = true;
            entry.revision = next;
            report.facts.push(Fact {
                id: id.clone(),
                revision: next,
                provenance: report.provenance.clone(),
                owner: Owner {
                    provider: intern(&entry.provider).ok_or("invalid_ledger")?,
                    account_id: None,
                    execution_id: entry.execution_id.clone(),
                    conversation_id: entry.conversation_id.clone(),
                    lineage: intern(&entry.lineage).ok_or("invalid_ledger")?,
                    parent_execution_id: entry.parent_execution_id.clone(),
                },
                kind: intern(&entry.kind).ok_or("invalid_ledger")?,
                at_ms: entry.at_ms,
                value: None,
            });
            applied.retracted += 1;
        }
        if applied.added + applied.corrected + applied.retracted > 0 {
            self.revision = next;
        }
        applied.revision = self.revision;
        Ok(applied)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rich_facts::{transcript::project_transcripts, ExportOptions};
    use aicharts_protocol::Provider;
    use std::io::Cursor;

    const KEY: [u8; 32] = [9; 32];
    const START: u64 = 1_767_225_600_000;
    const CLAUDE_V1: &str =
        include_str!("../../../../fixtures/usage/rich-claude-transcript-v1.jsonl");
    const CODEX_V1: &str =
        include_str!("../../../../fixtures/usage/rich-codex-transcript-v1.jsonl");

    fn options() -> ExportOptions {
        ExportOptions::new("synthetic_source_v1", START, START + 60_000).unwrap()
    }
    fn export(source: &'static str, provider: Provider) -> Report {
        project_transcripts(vec![(provider, Cursor::new(source))], &KEY, &options())
            .unwrap()
            .0
    }
    fn claude() -> Report {
        export(CLAUDE_V1, Provider::ClaudeCode)
    }
    fn ledger(report: &Report) -> Ledger {
        Ledger::new("synthetic_source_v1", report.source_id())
    }

    #[test]
    fn first_export_assigns_revision_one_and_a_repeat_changes_nothing() {
        let mut first = claude();
        let mut ledger = ledger(&first);
        let applied = ledger.apply(&mut first).unwrap();
        assert_eq!(
            applied,
            Applied {
                added: first.facts.len(),
                corrected: 0,
                unchanged: 0,
                retracted: 0,
                revision: 1
            }
        );
        assert!(first.facts.iter().all(|fact| fact.revision == 1));
        let mut second = claude();
        let again = ledger.apply(&mut second).unwrap();
        assert_eq!(again.unchanged, first.facts.len());
        assert_eq!((again.added, again.corrected, again.retracted), (0, 0, 0));
        assert_eq!(again.revision, 1);
        assert_eq!(ledger.revision(), 1);
        assert!(second.facts.iter().all(|fact| fact.revision == 1));
        assert_eq!(second.to_json().unwrap(), first.to_json().unwrap());
    }

    #[test]
    fn restart_from_encoded_bytes_is_idempotent() {
        let mut first = claude();
        let mut ledger = ledger(&first);
        ledger.apply(&mut first).unwrap();
        let bytes = ledger.encode().unwrap();
        let mut restored = Ledger::decode(&bytes).unwrap();
        assert!(restored == ledger);
        assert_eq!(restored.len(), first.facts.len());
        let mut second = claude();
        let applied = restored.apply(&mut second).unwrap();
        assert_eq!(applied.unchanged, first.facts.len());
        assert_eq!(restored.encode().unwrap(), bytes);
    }

    #[test]
    fn changed_values_get_a_corrective_revision_and_missing_facts_are_retracted() {
        let mut first = claude();
        let mut ledger = ledger(&first);
        ledger.apply(&mut first).unwrap();
        // Rescan with the error request line dropped and one tool result flagged.
        let altered: String = CLAUDE_V1
            .lines()
            .filter(|line| !line.contains("req_synthetic_c"))
            .map(|line| line.replace("\"is_error\":false", "\"is_error\":true"))
            .map(|line| format!("{line}\n"))
            .collect();
        let (mut second, _) = project_transcripts(
            vec![(Provider::ClaudeCode, Cursor::new(altered.as_str()))],
            &KEY,
            &options(),
        )
        .unwrap();
        let applied = ledger.apply(&mut second).unwrap();
        assert_eq!(applied.revision, 2);
        assert_eq!(applied.corrected, 1);
        assert_eq!(applied.retracted, 1);
        assert_eq!(applied.added, 0);
        assert_eq!(applied.unchanged, first.facts.len() - 2);
        let corrected: Vec<&Fact> = second
            .facts
            .iter()
            .filter(|fact| fact.revision == 2 && fact.value.is_some())
            .collect();
        assert_eq!(corrected.len(), 1);
        assert_eq!(
            corrected[0]
                .value
                .as_ref()
                .unwrap()
                .tool()
                .unwrap()
                .outcome(),
            "error"
        );
        let retracted: Vec<&Fact> = second
            .facts
            .iter()
            .filter(|fact| fact.value.is_none())
            .collect();
        assert_eq!(retracted.len(), 1);
        assert_eq!(retracted[0].revision, 2);
        assert_eq!(retracted[0].kind, "request");
        assert_eq!(retracted[0].at_ms, START + 6_000);
        let original = first
            .facts
            .iter()
            .find(|fact| fact.id == retracted[0].id)
            .unwrap();
        assert!(original.owner == retracted[0].owner);
        // Re-applying the altered export is a no-op at revision 2.
        let (mut third, _) = project_transcripts(
            vec![(Provider::ClaudeCode, Cursor::new(altered.as_str()))],
            &KEY,
            &options(),
        )
        .unwrap();
        let again = ledger.apply(&mut third).unwrap();
        assert_eq!((again.added, again.corrected, again.retracted), (0, 0, 0));
        assert_eq!(again.revision, 2);
        assert_eq!(third.facts.len(), second.facts.len() - 1);
        // A reappearing fact after retraction gets a fresh corrective revision.
        let mut fourth = claude();
        let back = ledger.apply(&mut fourth).unwrap();
        assert_eq!(back.revision, 3);
        assert_eq!(back.corrected, 2);
        assert_eq!(ledger.len(), first.facts.len());
    }

    #[test]
    fn retractions_only_cover_the_exported_window() {
        let mut first = claude();
        let mut ledger = ledger(&first);
        ledger.apply(&mut first).unwrap();
        let narrow =
            ExportOptions::new("synthetic_source_v1", START + 7_000, START + 9_000).unwrap();
        let (mut later, _) = project_transcripts(
            vec![(Provider::ClaudeCode, Cursor::new(CLAUDE_V1))],
            &KEY,
            &narrow,
        )
        .unwrap();
        let applied = ledger.apply(&mut later).unwrap();
        assert_eq!(applied.retracted, 0);
        assert_eq!(applied.unchanged, later.facts.len());
        assert_eq!(applied.revision, 1);
    }

    #[test]
    fn ledgers_are_bound_to_one_source_and_reject_retractions_as_input() {
        let mut report = claude();
        let mut other = Ledger::new("synthetic_source_v2", "0123456789abcdef0123456789abcdef");
        assert_eq!(
            other.apply(&mut report).err(),
            Some("ledger_source_mismatch")
        );
        // Different providers under one epoch share the source identity.
        assert_eq!(
            export(CODEX_V1, Provider::Codex).source_id(),
            report.source_id()
        );
        let mut ledger = ledger(&report);
        ledger.apply(&mut report).unwrap();
        let mut altered = claude();
        altered.facts.retain(|fact| fact.kind == "tool");
        let mut replay = altered.clone();
        ledger.apply(&mut replay).unwrap();
        assert!(replay.facts.iter().any(|fact| fact.value.is_none()));
        assert_eq!(ledger.apply(&mut replay).err(), Some("invalid_export"));
        let mut duplicated = claude();
        let dup = duplicated.facts[0].clone();
        duplicated.facts.push(dup);
        assert_eq!(
            ledger.apply(&mut duplicated).err(),
            Some("conflicting_fact")
        );
    }

    #[test]
    fn decoding_rejects_malformed_and_oversized_ledgers() {
        assert_eq!(Ledger::decode(b"{").err(), Some("invalid_ledger"));
        assert_eq!(
            Ledger::decode(&vec![b' '; MAX_LEDGER_BYTES + 1]).err(),
            Some("ledger_size_limit")
        );
        let mut report = claude();
        let mut ledger = ledger(&report);
        ledger.apply(&mut report).unwrap();
        let text = String::from_utf8(ledger.encode().unwrap()).unwrap();
        assert_eq!(
            Ledger::decode(
                text.replace("\"schemaVersion\":1", "\"schemaVersion\":2")
                    .as_bytes()
            )
            .err(),
            Some("invalid_ledger")
        );
        assert_eq!(
            Ledger::decode(
                text.replace("\"revision\":1,", "\"revision\":0,")
                    .as_bytes()
            )
            .err(),
            Some("invalid_ledger")
        );
        assert_eq!(
            Ledger::decode(text.replace("\"claude_code\"", "\"other\"").as_bytes()).err(),
            Some("invalid_ledger")
        );
        assert_eq!(
            Ledger::decode(
                text.replace("\"retracted\":false", "\"retracted\":false,\"x\":1")
                    .as_bytes()
            )
            .err(),
            Some("invalid_ledger")
        );
        let mut nearly = Ledger::new("synthetic_source_v1", report.source_id());
        nearly.revision = MAX_REVISION;
        assert_eq!(nearly.apply(&mut claude()).err(), Some("revision_limit"));
    }
}
