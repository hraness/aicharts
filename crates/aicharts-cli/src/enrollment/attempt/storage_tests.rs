//! Synthetic in-memory faults only. No user file, platform backend or vault is
//! constructed. Faults distinguish an effect from loss of its reply.
use super::{
    record::{self, LastFailure, Progress, Record, Token},
    record_tests::{copy, flight_record, initial_record, namespace_flow, TIME},
    storage::{self, Candidate, Storage},
    Error, Result, MAX_RECORD_BYTES, MAX_REVISION,
};
use std::{cell::RefCell, rc::Rc};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Event {
    Lock,
    Read,
    SyncCommitted,
    Stage,
    SyncCandidate,
    Publish,
    SyncDirectory,
    Unlock,
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Effect {
    Before,
    After,
    WrongRead,
    Panic,
}
struct Fault {
    event: Event,
    nth: usize,
    effect: Effect,
}
#[derive(Default)]
struct Disk {
    committed: Option<Vec<u8>>,
    durable: Option<Vec<u8>>,
    candidate: Option<Candidate>,
    candidate_synced: bool,
    committed_synced: bool,
    directory_synced: bool,
    locked: bool,
    events: Vec<Event>,
    fault: Option<Fault>,
    change_after_sync: Option<Vec<u8>>,
    change_after_committed_sync: Option<Vec<u8>>,
}
#[derive(Clone, Default)]
struct Memory(Rc<RefCell<Disk>>);
impl Memory {
    fn hit(&self, event: Event) -> Option<Effect> {
        let mut disk = self.0.borrow_mut();
        disk.events.push(event);
        assert!(disk.events.len() <= 128);
        let nth = disk.events.iter().filter(|seen| **seen == event).count();
        if disk
            .fault
            .as_ref()
            .is_some_and(|fault| fault.event == event && fault.nth == nth)
        {
            disk.fault.take().map(|fault| fault.effect)
        } else {
            None
        }
    }
    fn fault(&self, event: Event, nth: usize, effect: Effect) {
        let mut disk = self.0.borrow_mut();
        disk.events.clear();
        disk.fault = Some(Fault { event, nth, effect });
    }
    fn clear_events(&self) {
        self.0.borrow_mut().events.clear();
    }
    fn bytes(&self) -> Option<Vec<u8>> {
        self.0.borrow().committed.clone()
    }
    fn events(&self) -> Vec<Event> {
        self.0.borrow().events.clone()
    }
    fn count(&self, event: Event) -> usize {
        self.events().iter().filter(|seen| **seen == event).count()
    }
    fn assert_unlocked(&self) {
        assert!(!self.0.borrow().locked);
    }
    fn committed(value: &Record) -> Self {
        let bytes = record::encode(value).unwrap().as_bytes().to_vec();
        Self(Rc::new(RefCell::new(Disk {
            committed: Some(bytes.clone()),
            durable: Some(bytes),
            committed_synced: true,
            directory_synced: true,
            ..Disk::default()
        })))
    }
    fn restart(&self, keep_visible: bool) -> Self {
        let mut disk = self.0.borrow_mut();
        if !keep_visible {
            disk.committed = disk.durable.clone();
        }
        disk.locked = false;
        disk.committed_synced = false;
        disk.directory_synced = false;
        disk.fault = None;
        disk.events.clear();
        drop(disk);
        self.clone()
    }
}
impl Storage for Memory {
    fn lock(&mut self) -> Result<()> {
        if self.hit(Event::Lock).is_some() {
            return Err(Error::StorageUnavailable);
        }
        let mut disk = self.0.borrow_mut();
        if disk.locked {
            return Err(Error::Busy);
        }
        disk.locked = true;
        Ok(())
    }
    fn unlock(&mut self) {
        self.hit(Event::Unlock);
        let mut disk = self.0.borrow_mut();
        assert!(disk.locked);
        disk.locked = false;
    }
    fn read_committed(&mut self, max_bytes: usize) -> Result<Option<Vec<u8>>> {
        assert!(self.0.borrow().locked);
        assert_eq!(max_bytes, MAX_RECORD_BYTES);
        match self.hit(Event::Read) {
            Some(Effect::WrongRead) => Ok(Some(b"SYNTHETIC_PRIVATE_CANARY".to_vec())),
            Some(Effect::Panic) => panic!("synthetic process interruption"),
            Some(_) => Err(Error::StorageUnavailable),
            None => Ok(self.bytes()),
        }
    }
    fn sync_committed(&mut self) -> Result<()> {
        assert!(self.0.borrow().locked);
        let fault = self.hit(Event::SyncCommitted);
        if fault == Some(Effect::Before) {
            return Err(Error::StorageUnavailable);
        }
        let mut disk = self.0.borrow_mut();
        if disk.committed.is_none() {
            return Err(Error::Missing);
        }
        if let Some(changed) = disk.change_after_committed_sync.take() {
            disk.committed = Some(changed);
        }
        disk.committed_synced = true;
        if fault.is_some() {
            Err(Error::StorageUnavailable)
        } else {
            Ok(())
        }
    }
    fn stage(&mut self, candidate: &Candidate) -> Result<()> {
        assert!(self.0.borrow().locked);
        assert!(candidate.bytes.as_bytes().len() <= MAX_RECORD_BYTES);
        assert!(
            record::token(&record::decode(candidate.bytes.as_bytes()).unwrap()).unwrap()
                == candidate.next
        );
        let fault = self.hit(Event::Stage);
        if fault == Some(Effect::Before) {
            return Err(Error::StorageUnavailable);
        }
        let mut disk = self.0.borrow_mut();
        if disk.candidate.as_ref().is_some_and(|old| old != candidate) {
            return Err(Error::RecoveryRequired);
        }
        disk.candidate = Some(candidate.clone());
        disk.candidate_synced = false;
        if fault.is_some() {
            Err(Error::StorageUnavailable)
        } else {
            Ok(())
        }
    }
    fn sync_candidate(&mut self) -> Result<()> {
        assert!(self.0.borrow().locked);
        let fault = self.hit(Event::SyncCandidate);
        if fault == Some(Effect::Before) {
            return Err(Error::StorageUnavailable);
        }
        let mut disk = self.0.borrow_mut();
        assert!(disk.candidate.is_some());
        disk.candidate_synced = true;
        if let Some(changed) = disk.change_after_sync.take() {
            disk.committed = Some(changed);
        }
        if fault.is_some() {
            Err(Error::StorageUnavailable)
        } else {
            Ok(())
        }
    }
    fn publish(&mut self, candidate: &Candidate) -> Result<()> {
        assert!(self.0.borrow().locked);
        let fault = self.hit(Event::Publish);
        if fault == Some(Effect::Before) {
            return Err(Error::StorageUnavailable);
        }
        let mut disk = self.0.borrow_mut();
        if disk.candidate.as_ref() != Some(candidate) || !disk.candidate_synced {
            return Err(Error::RecoveryRequired);
        }
        let token = disk
            .committed
            .as_deref()
            .map(record::decode)
            .transpose()?
            .map(|value| record::token(&value))
            .transpose()?;
        if token != candidate.expected {
            return Err(Error::StaleSnapshot);
        }
        disk.committed = Some(candidate.bytes.as_bytes().to_vec());
        disk.committed_synced = true;
        disk.directory_synced = false;
        disk.candidate = None;
        if fault.is_some() {
            Err(Error::StorageUnavailable)
        } else {
            Ok(())
        }
    }
    fn sync_directory(&mut self) -> Result<()> {
        assert!(self.0.borrow().locked);
        let fault = self.hit(Event::SyncDirectory);
        if fault == Some(Effect::Before) {
            return Err(Error::StorageUnavailable);
        }
        let mut disk = self.0.borrow_mut();
        assert!(disk.committed_synced);
        disk.directory_synced = true;
        disk.durable = disk.committed.clone();
        if fault.is_some() {
            Err(Error::StorageUnavailable)
        } else {
            Ok(())
        }
    }
}

fn successor(value: &Record) -> Record {
    let mut next = copy(value);
    next.revision += 1;
    next.clock_floor_ms += 1;
    next
}
fn token(value: &Record) -> Token {
    record::token(value).unwrap()
}

#[test]
fn initialization_and_cas_publish_one_exact_stage_then_return_durable_readback() {
    let initial = initial_record();
    let mut memory = Memory::default();
    let first = storage::initialize(&mut memory, &initial).unwrap();
    assert!(first.record() == &initial && first.token() == token(&initial));
    assert_eq!(
        memory.events(),
        [
            Event::Lock,
            Event::Read,
            Event::Stage,
            Event::SyncCandidate,
            Event::Read,
            Event::Publish,
            Event::SyncDirectory,
            Event::Read,
            Event::Unlock
        ]
    );
    assert_eq!(
        memory.bytes().as_deref(),
        Some(record::encode(&initial).unwrap().as_bytes())
    );
    assert!(memory.0.borrow().candidate.is_none() && memory.0.borrow().directory_synced);
    memory.clear_events();
    let mut next = successor(&initial);
    next.progress = Progress::PairingPrepared;
    let committed = storage::compare_and_publish(&mut memory, first.token(), &next).unwrap();
    assert!(committed.record() == &next && committed.token() == token(&next));
    assert_eq!(memory.count(Event::Publish), 1);
    memory.assert_unlocked();
    assert_eq!(
        memory.bytes().as_deref(),
        Some(record::encode(&next).unwrap().as_bytes())
    );
}

#[test]
fn initialization_never_adopts_existing_committed_state_or_a_different_stage() {
    let initial = initial_record();
    let mut memory = Memory::committed(&initial);
    assert_eq!(
        storage::initialize(&mut memory, &initial).err(),
        Some(Error::Conflict)
    );
    assert_eq!(memory.count(Event::Stage), 0);
    assert_eq!(memory.count(Event::Publish), 0);
    let mut empty = Memory::default();
    empty.fault(Event::SyncCandidate, 1, Effect::Before);
    assert_eq!(
        storage::initialize(&mut empty, &initial).err(),
        Some(Error::StorageUnavailable)
    );
    let original_stage = empty.0.borrow().candidate.clone();
    let mut changed = initial_record();
    changed.clock_floor_ms += 1;
    empty.clear_events();
    assert_eq!(
        storage::initialize(&mut empty, &changed).err(),
        Some(Error::RecoveryRequired)
    );
    assert!(empty.0.borrow().candidate == original_stage);
    assert_eq!(empty.count(Event::Publish), 0);
    assert!(empty.bytes().is_none());
    empty.assert_unlocked();
}

#[test]
fn inspection_is_observational_and_explicit_durable_read_reestablishes_both_syncs() {
    let initial = initial_record();
    let memory = Memory::committed(&initial);
    let mut restart = memory.restart(true);
    let observed = storage::inspect(&mut restart).unwrap();
    assert!(observed.record() == &initial && observed.token() == token(&initial));
    assert_eq!(restart.events(), [Event::Lock, Event::Read, Event::Unlock]);
    assert!(!restart.0.borrow().committed_synced && !restart.0.borrow().directory_synced);
    restart.clear_events();
    let durable = storage::read_durable(&mut restart, token(&initial)).unwrap();
    assert!(durable.record() == &initial && durable.token() == token(&initial));
    assert_eq!(
        restart.events(),
        [
            Event::Lock,
            Event::Read,
            Event::SyncCommitted,
            Event::SyncDirectory,
            Event::Read,
            Event::Unlock
        ]
    );
    assert!(restart.0.borrow().committed_synced && restart.0.borrow().directory_synced);
    assert_eq!(restart.count(Event::Stage), 0);
    assert_eq!(restart.count(Event::Publish), 0);
}

#[test]
fn invalid_records_and_revision_exhaustion_refuse_before_any_storage_effect() {
    let mut memory = Memory::default();
    let mut invalid = initial_record();
    invalid.installation_id = [0; 32];
    assert_eq!(
        storage::initialize(&mut memory, &invalid).err(),
        Some(Error::InvalidRecord)
    );
    assert!(memory.events().is_empty());
    let original = initial_record();
    let mut next = successor(&original);
    next.revision += 1;
    assert_eq!(
        storage::compare_and_publish(&mut memory, token(&original), &next).err(),
        Some(Error::InvalidSuccessor)
    );
    assert!(memory.events().is_empty());
    let mut exhausted = initial_record();
    exhausted.revision = MAX_REVISION;
    let mut beyond = copy(&exhausted);
    beyond.revision += 1;
    assert_eq!(
        storage::compare_and_publish(&mut memory, token(&exhausted), &beyond).err(),
        Some(Error::Limit)
    );
    assert!(memory.events().is_empty());
}

#[test]
fn predecessor_tokens_bind_revision_and_digest_and_are_checked_after_staging() {
    let original = initial_record();
    let next = successor(&original);
    let mut other = initial_record();
    other.clock_floor_ms += 2;
    let mut stale = Memory::committed(&other);
    assert_eq!(
        storage::compare_and_publish(&mut stale, token(&original), &next).err(),
        Some(Error::StaleSnapshot)
    );
    assert_eq!(stale.count(Event::Stage), 0);
    let mut changed_revision = copy(&original);
    changed_revision.revision += 1;
    let mut stale = Memory::committed(&changed_revision);
    assert_eq!(
        storage::compare_and_publish(&mut stale, token(&original), &next).err(),
        Some(Error::StaleSnapshot)
    );
    assert_eq!(stale.count(Event::Stage), 0);
    let mut raced = Memory::committed(&original);
    let changed = record::encode(&other).unwrap();
    raced.0.borrow_mut().change_after_sync = Some(changed.as_bytes().to_vec());
    assert_eq!(
        storage::compare_and_publish(&mut raced, token(&original), &next).err(),
        Some(Error::StaleSnapshot)
    );
    assert_eq!(raced.count(Event::Stage), 1);
    assert_eq!(raced.count(Event::Publish), 0);
    assert!(raced.0.borrow().candidate.is_some());
    raced.assert_unlocked();
    assert_eq!(raced.bytes().as_deref(), Some(changed.as_bytes()));
}

#[test]
fn every_prepublication_fault_preserves_committed_bytes_and_retains_any_created_stage() {
    for (event, nth, effect, staged) in [
        (Event::Lock, 1, Effect::Before, false),
        (Event::Read, 1, Effect::Before, false),
        (Event::Stage, 1, Effect::Before, false),
        (Event::Stage, 1, Effect::After, true),
        (Event::SyncCandidate, 1, Effect::Before, true),
        (Event::SyncCandidate, 1, Effect::After, true),
        (Event::Read, 2, Effect::Before, true),
    ] {
        let original = initial_record();
        let next = successor(&original);
        let mut memory = Memory::committed(&original);
        let before = memory.bytes();
        memory.fault(event, nth, effect);
        assert_eq!(
            storage::compare_and_publish(&mut memory, token(&original), &next).err(),
            Some(Error::StorageUnavailable)
        );
        assert_eq!(memory.bytes(), before);
        assert_eq!(memory.count(Event::Publish), 0);
        assert_eq!(memory.0.borrow().candidate.is_some(), staged);
        if let Some(candidate) = &memory.0.borrow().candidate {
            assert!(candidate.expected == Some(token(&original)) && candidate.next == token(&next));
            assert_eq!(
                candidate.bytes.as_bytes(),
                record::encode(&next).unwrap().as_bytes()
            );
        }
        memory.assert_unlocked();
        assert_eq!(
            memory.count(Event::Unlock),
            usize::from(event != Event::Lock)
        );
    }
}

#[test]
fn all_failures_from_publication_dispatch_through_readback_are_outcome_unknown() {
    for (event, nth, effect, effect_happened) in [
        (Event::Publish, 1, Effect::Before, false),
        (Event::Publish, 1, Effect::After, true),
        (Event::SyncDirectory, 1, Effect::Before, true),
        (Event::SyncDirectory, 1, Effect::After, true),
        (Event::Read, 3, Effect::Before, true),
        (Event::Read, 3, Effect::WrongRead, true),
    ] {
        let original = initial_record();
        let next = successor(&original);
        let mut memory = Memory::committed(&original);
        memory.fault(event, nth, effect);
        assert_eq!(
            storage::compare_and_publish(&mut memory, token(&original), &next).err(),
            Some(Error::OutcomeUnknown)
        );
        assert_eq!(memory.count(Event::Publish), 1);
        memory.assert_unlocked();
        let expected = if effect_happened { &next } else { &original };
        assert_eq!(
            memory.bytes().as_deref(),
            Some(record::encode(expected).unwrap().as_bytes())
        );
        assert_eq!(memory.0.borrow().candidate.is_some(), !effect_happened);
    }
}

#[test]
fn ambiguous_publish_restart_requires_exact_explicit_reconciliation_and_no_stage_adoption() {
    for keep_visible in [true, false] {
        let original = initial_record();
        let next = successor(&original);
        let mut memory = Memory::committed(&original);
        memory.fault(Event::SyncDirectory, 1, Effect::Before);
        assert_eq!(
            storage::compare_and_publish(&mut memory, token(&original), &next).err(),
            Some(Error::OutcomeUnknown)
        );
        let mut restart = memory.restart(keep_visible);
        let observed = storage::inspect(&mut restart).unwrap();
        assert!(observed.record() == if keep_visible { &next } else { &original });
        assert!(!restart.0.borrow().directory_synced);
        restart.clear_events();
        if keep_visible {
            assert_eq!(
                storage::compare_and_publish(&mut restart, token(&original), &next).err(),
                Some(Error::StaleSnapshot)
            );
            assert_eq!(restart.count(Event::Stage), 0);
            restart.clear_events();
            assert!(storage::read_durable(&mut restart, token(&next)).is_ok());
        } else {
            assert_eq!(
                storage::read_durable(&mut restart, token(&next)).err(),
                Some(Error::StaleSnapshot)
            );
        }
        assert_eq!(restart.count(Event::Publish), 0);
        restart.assert_unlocked();
    }
    let initial = initial_record();
    let mut memory = Memory::default();
    memory.fault(Event::Publish, 1, Effect::Before);
    assert_eq!(
        storage::initialize(&mut memory, &initial).err(),
        Some(Error::OutcomeUnknown)
    );
    let stage = memory.0.borrow().candidate.clone();
    let mut restart = memory.restart(true);
    assert_eq!(storage::inspect(&mut restart).err(), Some(Error::Missing));
    assert_eq!(
        storage::read_durable(&mut restart, token(&initial)).err(),
        Some(Error::Missing)
    );
    assert!(restart.0.borrow().candidate == stage);
    assert_eq!(restart.count(Event::Publish), 0);
}

#[test]
fn durable_read_faults_and_changed_committed_tokens_never_return_durability_evidence() {
    for (event, nth, effect) in [
        (Event::Read, 1, Effect::Before),
        (Event::SyncCommitted, 1, Effect::Before),
        (Event::SyncCommitted, 1, Effect::After),
        (Event::SyncDirectory, 1, Effect::Before),
        (Event::SyncDirectory, 1, Effect::After),
        (Event::Read, 2, Effect::Before),
    ] {
        let original = initial_record();
        let mut memory = Memory::committed(&original);
        memory.fault(event, nth, effect);
        assert_eq!(
            storage::read_durable(&mut memory, token(&original)).err(),
            Some(Error::StorageUnavailable)
        );
        assert_eq!(memory.count(Event::Stage), 0);
        assert_eq!(memory.count(Event::Publish), 0);
        memory.assert_unlocked();
    }
    let original = initial_record();
    let mut other = initial_record();
    other.clock_floor_ms += 1;
    let mut memory = Memory::committed(&original);
    memory.0.borrow_mut().change_after_committed_sync =
        Some(record::encode(&other).unwrap().as_bytes().to_vec());
    assert_eq!(
        storage::read_durable(&mut memory, token(&original)).err(),
        Some(Error::StaleSnapshot)
    );
    assert_eq!(memory.count(Event::Publish), 0);
    memory.assert_unlocked();
}

#[test]
fn corrupted_or_oversized_committed_bytes_do_not_authorize_repair_or_stage_replacement() {
    let original = initial_record();
    let next = successor(&original);
    for bytes in [
        b"SYNTHETIC_PRIVATE_CANARY".to_vec(),
        vec![b' '; MAX_RECORD_BYTES + 1],
    ] {
        let mut memory = Memory::default();
        memory.0.borrow_mut().committed = Some(bytes.clone());
        assert!(storage::inspect(&mut memory).is_err());
        assert!(storage::read_durable(&mut memory, token(&original)).is_err());
        assert!(storage::compare_and_publish(&mut memory, token(&original), &next).is_err());
        assert_eq!(memory.count(Event::Stage), 0);
        assert_eq!(memory.count(Event::Publish), 0);
        assert_eq!(memory.bytes(), Some(bytes));
        memory.assert_unlocked();
    }
}

#[test]
fn explicit_identical_stage_retry_keeps_original_candidate_and_never_remints_a_flight() {
    let mut original = flight_record();
    original.revision -= 1;
    original.flight = None;
    original.flights_started = 0;
    let next = flight_record();
    let mut memory = Memory::committed(&original);
    memory.fault(Event::SyncCandidate, 1, Effect::Before);
    assert_eq!(
        storage::compare_and_publish(&mut memory, token(&original), &next).err(),
        Some(Error::StorageUnavailable)
    );
    let retained = memory.0.borrow().candidate.clone().unwrap();
    memory.clear_events();
    let mut changed = copy(&next);
    changed.last_failure = Some(LastFailure::Transport);
    assert_eq!(
        storage::compare_and_publish(&mut memory, token(&original), &changed).err(),
        Some(Error::RecoveryRequired)
    );
    assert!(memory.0.borrow().candidate.as_ref() == Some(&retained));
    assert_eq!(memory.count(Event::Publish), 0);
    memory.clear_events();
    let durable = storage::compare_and_publish(&mut memory, token(&original), &next).unwrap();
    assert!(durable.record() == &next && durable.record().flight == next.flight);
    assert_eq!(memory.count(Event::Publish), 1);
    assert_eq!(
        durable.record().flight.as_ref().unwrap().prepared_at_ms,
        TIME
    );
}

#[test]
fn lock_refusal_and_unwinding_do_not_release_another_owner_or_publish() {
    let initial = initial_record();
    let mut memory = Memory::committed(&initial);
    memory.0.borrow_mut().locked = true;
    assert_eq!(storage::inspect(&mut memory).err(), Some(Error::Busy));
    assert_eq!(memory.count(Event::Unlock), 0);
    assert!(memory.0.borrow().locked);
    memory.0.borrow_mut().locked = false;
    memory.fault(Event::Read, 1, Effect::Panic);
    let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        storage::inspect(&mut memory)
    }));
    assert!(panic.is_err());
    memory.assert_unlocked();
    assert_eq!(memory.count(Event::Unlock), 1);
    assert_eq!(memory.count(Event::Publish), 0);
}

#[test]
fn absent_initialization_faults_and_intervening_creation_never_adopt_an_unrelated_record() {
    for (event, nth, effect, unknown, published) in [
        (Event::Read, 1, Effect::Before, false, false),
        (Event::Stage, 1, Effect::After, false, false),
        (Event::SyncCandidate, 1, Effect::Before, false, false),
        (Event::Read, 2, Effect::Before, false, false),
        (Event::Publish, 1, Effect::Before, true, false),
        (Event::Publish, 1, Effect::After, true, true),
        (Event::SyncDirectory, 1, Effect::Before, true, true),
        (Event::Read, 3, Effect::WrongRead, true, true),
    ] {
        let initial = initial_record();
        let mut memory = Memory::default();
        memory.fault(event, nth, effect);
        assert_eq!(
            storage::initialize(&mut memory, &initial).err(),
            Some(if unknown {
                Error::OutcomeUnknown
            } else {
                Error::StorageUnavailable
            })
        );
        assert_eq!(memory.bytes().is_some(), published);
        assert_eq!(memory.count(Event::Publish), usize::from(unknown));
        memory.assert_unlocked();
    }
    let initial = initial_record();
    let mut memory = Memory::default();
    let mut other = initial_record();
    other.clock_floor_ms += 1;
    let other_bytes = record::encode(&other).unwrap();
    memory.0.borrow_mut().change_after_sync = Some(other_bytes.as_bytes().to_vec());
    assert_eq!(
        storage::initialize(&mut memory, &initial).err(),
        Some(Error::Conflict)
    );
    assert_eq!(memory.count(Event::Publish), 0);
    assert_eq!(memory.bytes().as_deref(), Some(other_bytes.as_bytes()));
    assert!(memory.0.borrow().candidate.is_some());
    memory.assert_unlocked();
}

#[test]
fn namespace_pin_publication_is_durable_before_local_custody_progress_can_retire_its_flight() {
    let flow = namespace_flow();
    let mut memory = Memory::committed(&flow[0]);
    for pair in flow.windows(2) {
        memory.clear_events();
        let durable = storage::compare_and_publish(&mut memory, token(&pair[0]), &pair[1]).unwrap();
        assert!(durable.record() == &pair[1] && durable.token() == token(&pair[1]));
        assert_eq!(memory.count(Event::Publish), 1);
        assert_eq!(
            memory.0.borrow().durable.as_deref(),
            Some(record::encode(&pair[1]).unwrap().as_bytes())
        );
    }
    assert!(storage::inspect(&mut memory)
        .unwrap()
        .record()
        .flight
        .is_none());
    for event in [Event::Publish, Event::SyncDirectory] {
        let mut memory = Memory::committed(&flow[2]);
        memory.fault(
            event,
            1,
            if event == Event::Publish {
                Effect::After
            } else {
                Effect::Before
            },
        );
        assert_eq!(
            storage::compare_and_publish(&mut memory, token(&flow[2]), &flow[3]).err(),
            Some(Error::OutcomeUnknown)
        );
        let mut restart = memory.restart(true);
        let visible = storage::inspect(&mut restart).unwrap();
        assert!(
            visible.record().namespace == flow[3].namespace
                && visible.record().flight == flow[2].flight
        );
        assert_eq!(restart.count(Event::Publish), 0);
        let reconciled = storage::read_durable(&mut restart, token(&flow[3])).unwrap();
        assert!(reconciled.record() == &flow[3]);
        let prepared =
            storage::compare_and_publish(&mut restart, reconciled.token(), &flow[4]).unwrap();
        assert!(prepared.record().flight == flow[2].flight);
        assert_eq!(
            prepared.record().namespace.as_ref().unwrap().accepted_at_ms,
            TIME + 5_000
        );
    }
}
