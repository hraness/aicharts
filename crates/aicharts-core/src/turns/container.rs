//! Physical-container identity is fixed by its first metadata record. Inherited
//! metadata is validation evidence, never an attribution cursor or another
//! measured thread. Newly supported copied shapes contain no selected records.
use super::{
    keyed_id, schema::HistoryMode, schema::Source, schema::ThreadSource, BTreeMap, Field, Id,
    Payload, ThreadEvidence, TurnCollection, TurnDiagnostic, TurnError,
};

struct Metadata {
    thread: Id,
    session: Option<Id>,
    excluded: bool,
    inherited: bool,
}

fn metadata(payload: &Payload, key: &[u8; 32]) -> Result<Metadata, TurnError> {
    let Field::Value(id) = &payload.id else {
        return Err(TurnError::MalformedRecord);
    };
    let session = match &payload.session_id {
        Field::Missing => None,
        Field::Value(session) => Some(keyed_id(
            key,
            b"codex-turn-thread-v1",
            &[session.0.as_bytes()],
        )),
        Field::Null | Field::Invalid => return Err(TurnError::MalformedRecord),
    };
    if matches!(payload.parent_thread_id, Field::Invalid)
        || matches!(payload.forked_from_id, Field::Invalid)
        || matches!(payload.thread_source, Field::Invalid)
        || payload.source == Some(Source::Invalid)
    {
        return Err(TurnError::MalformedRecord);
    }
    if matches!(
        payload.history_mode,
        Field::Invalid | Field::Null | Field::Value(HistoryMode::Unknown)
    ) {
        return Err(TurnError::UnsupportedHistory);
    }
    let inherited = matches!(payload.forked_from_id, Field::Value(_))
        || payload.forked_from_ordinal_exclusive.is_some()
        || payload.subagent_history_start_ordinal.is_some()
        || payload.history_base.is_some();
    let excluded = inherited
        || matches!(payload.parent_thread_id, Field::Value(_))
        || payload.source == Some(Source::Excluded)
        || payload.thread_source == Field::Value(ThreadSource::Excluded);
    Ok(Metadata {
        thread: keyed_id(key, b"codex-turn-thread-v1", &[id.0.as_bytes()]),
        session,
        excluded,
        inherited,
    })
}

fn merge_session(current: &mut Option<Id>, incoming: Option<Id>) -> Result<(), TurnError> {
    if let Some(incoming) = incoming {
        if current.is_some_and(|old| old != incoming) {
            return Err(TurnError::MetadataSessionConflict);
        }
        *current = Some(incoming);
    }
    Ok(())
}

impl ThreadEvidence {
    pub(super) fn merge(&mut self, incoming: &Self) -> Result<(), TurnError> {
        merge_session(&mut self.session, incoming.session)?;
        self.excluded |= incoming.excluded;
        self.unknown_session |= incoming.unknown_session;
        self.shared_session_shape |= incoming.shared_session_shape;
        self.inherited_history |= incoming.inherited_history;
        self.has_selected_observations |= incoming.has_selected_observations;
        Ok(())
    }

    pub(super) fn validate_ownership(&self) -> Result<(), TurnError> {
        if self.shared_session_shape && self.inherited_history && self.has_selected_observations {
            return Err(TurnError::InheritedObservationOwnership);
        }
        Ok(())
    }
}

#[derive(Default)]
pub(super) struct Container {
    canonical: Option<Id>,
    foreign_metadata_seen: bool,
    // At most one entry per physical metadata record, within the unchanged
    // physical-record ceiling. Foreign identities never enter out.threads.
    metadata_sessions: BTreeMap<Id, Option<Id>>,
}

impl Container {
    pub(super) fn metadata(
        &mut self,
        payload: &Payload,
        key: &[u8; 32],
        out: &mut TurnCollection,
    ) -> Result<(), TurnError> {
        let incoming = metadata(payload, key)?;
        merge_session(
            self.metadata_sessions.entry(incoming.thread).or_default(),
            incoming.session,
        )?;
        let shared_session_shape = incoming.session.is_some_and(|id| id != incoming.thread);
        if shared_session_shape && !incoming.excluded {
            return Err(TurnError::SessionTreeMismatch);
        }
        let canonical = *self.canonical.get_or_insert(incoming.thread);
        if incoming.thread == canonical {
            let evidence = out.threads.entry(canonical).or_default();
            evidence.merge(&ThreadEvidence {
                excluded: incoming.excluded,
                unknown_session: incoming.session.is_none(),
                session: incoming.session,
                shared_session_shape,
                inherited_history: incoming.inherited,
                // Even incomplete selected records before the first header
                // prevent a newly supported inherited shape from hiding them.
                has_selected_observations: out.budget.observations != 0,
            })?;
            evidence.validate_ownership()?;
        } else {
            let evidence = out
                .threads
                .get(&canonical)
                .expect("canonical metadata recorded");
            if !evidence.inherited_history {
                return Err(TurnError::ContainerIdentityAmbiguous);
            }
            self.foreign_metadata_seen = true;
            if out.budget.observations != 0 {
                return Err(TurnError::InheritedObservationOwnership);
            }
        }
        Ok(())
    }

    /// Called after charging the combined raw-observation budget, before any
    /// observation can be assigned to a thread. Never switches to a foreign ID.
    pub(super) fn observe(&self, out: &mut TurnCollection) -> Result<Option<Id>, TurnError> {
        if self.foreign_metadata_seen {
            return Err(TurnError::InheritedObservationOwnership);
        }
        if let Some(canonical) = self.canonical {
            let evidence = out
                .threads
                .get_mut(&canonical)
                .expect("canonical metadata recorded");
            evidence.has_selected_observations = true;
            evidence.validate_ownership()?;
        }
        Ok(self.canonical)
    }

    pub(super) fn finish(&self, out: &mut TurnCollection) -> Result<(), TurnError> {
        if let Some(canonical) = self.canonical {
            let evidence = out
                .threads
                .get(&canonical)
                .expect("canonical metadata recorded");
            evidence.validate_ownership()?;
            if self.foreign_metadata_seen
                || (evidence.shared_session_shape && evidence.inherited_history)
            {
                if out.budget.observations != 0 {
                    return Err(TurnError::InheritedObservationOwnership);
                }
                out.diagnostics
                    .insert(TurnDiagnostic::InheritedMetadataOnly);
            }
        }
        Ok(())
    }
}
