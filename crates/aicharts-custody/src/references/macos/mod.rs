//! Descriptor-only private persistence. The caller supplies the trusted anchor;
//! this module neither discovers paths nor activates the public store facade.
mod anchor;
mod envelope;
#[cfg(test)]
mod tests;

use super::{
    codec,
    engine::{Candidate, Storage},
    Error, Result,
};
use aicharts_platform_acl::require_no_acl;
use rustix::{
    fd::{AsFd, OwnedFd},
    fs::{self, AtFlags, FileType, FlockOperation, Mode, OFlags, Stat},
    io::{self, Errno, FdFlags},
};

const DIRECTORY: &str = "references-v1";
const LOCK: &str = "references.lock";
const CURRENT: &str = "references.current";
const PENDING: &str = "references.pending";
const MAX_IO_CALLS: usize = 128;
const MAX_INTERRUPTS: usize = 8;
// Darwin SDK sys/mount.h. Reject remote/non-native and ignored ownership mounts.
const MNT_RDONLY: u32 = 0x0000_0001;
const MNT_LOCAL: u32 = 0x0000_1000;
const MNT_IGNORE_OWNERSHIP: u32 = 0x0020_0000;

#[derive(Clone, Copy, PartialEq, Eq)]
struct Identity {
    device: i32,
    inode: u64,
}
impl Identity {
    fn of(stat: &Stat) -> Self {
        Self {
            device: stat.st_dev,
            inode: stat.st_ino,
        }
    }
}

struct Stored {
    fd: OwnedFd,
    identity: Identity,
    observation: Stat,
    candidate: Candidate,
    bytes: Vec<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Locked,
    Read,
    ReadCurrent,
    ReadPending,
    BeforeStage,
    StageCreated,
    StageWritten,
    BeforeCandidateSync,
    CandidateFileSynced,
    CandidateDirectorySynced,
    CandidateFullySynced,
    BeforeCommittedSync,
    CommittedFileSynced,
    CommittedFullySynced,
    BeforePublish,
    RenameDispatch,
    Published,
    BeforeDirectorySync,
    DirectorySynced,
    AnchorSynced,
    DirectoryFullySynced,
}

pub(super) struct MacStorage {
    anchor_chain: Option<anchor::TrustedAnchor>,
    anchor: OwnedFd,
    directory: OwnedFd,
    anchor_identity: Identity,
    directory_identity: Identity,
    lock_identity: Identity,
    uid: u32,
    active_lock: Option<OwnedFd>,
    staged: Option<Stored>,
    durable_current: Option<Stored>,
    fresh: bool,
    #[cfg(test)]
    hook: Option<Box<dyn FnMut(Phase) -> Result<()>>>,
}

struct LockAttempt<'a> {
    storage: &'a mut MacStorage,
    armed: bool,
}
impl Drop for LockAttempt<'_> {
    fn drop(&mut self) {
        if self.armed {
            self.storage.unlock();
        }
    }
}

fn unavailable(_: Errno) -> Error {
    Error::StorageUnavailable
}
fn flags() -> OFlags {
    OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK
}
fn stat_name(parent: &OwnedFd, name: &str) -> Result<Option<Stat>> {
    match fs::statat(parent, name, AtFlags::SYMLINK_NOFOLLOW) {
        Ok(value) => Ok(Some(value)),
        Err(Errno::NOENT) => Ok(None),
        Err(_) => Err(Error::StorageUnavailable),
    }
}
fn filesystem_valid(flags: u32, name: &[u8]) -> bool {
    flags & MNT_LOCAL != 0 && flags & (MNT_RDONLY | MNT_IGNORE_OWNERSHIP) == 0 && name == b"apfs\0"
}
fn check_filesystem(fd: &OwnedFd) -> Result<()> {
    let stat = fs::fstatfs(fd).map_err(unavailable)?;
    let bytes: Vec<u8> = stat.f_fstypename.iter().map(|value| *value as u8).collect();
    let end = bytes
        .iter()
        .position(|byte| *byte == 0)
        .ok_or(Error::RecoveryRequired)?;
    if !filesystem_valid(stat.f_flags, &bytes[..=end]) {
        return Err(Error::RecoveryRequired);
    }
    Ok(())
}
fn role(stat: &Stat, uid: u32, directory: bool) -> Result<()> {
    let (kind, mode) = if directory {
        (FileType::Directory, 0o700)
    } else {
        (FileType::RegularFile, 0o600)
    };
    if FileType::from_raw_mode(stat.st_mode) != kind
        || stat.st_uid != uid
        || stat.st_mode & 0o7777 != mode
        || (directory && stat.st_nlink == 0)
        || (!directory && stat.st_nlink != 1)
        || stat.st_size < 0
    {
        return Err(Error::RecoveryRequired);
    }
    Ok(())
}
fn checked_fd(fd: &OwnedFd, uid: u32, directory: bool) -> Result<Stat> {
    let before = fs::fstat(fd).map_err(unavailable)?;
    role(&before, uid, directory)?;
    require_no_acl(fd.as_fd()).map_err(|_| Error::RecoveryRequired)?;
    check_filesystem(fd)?;
    let after = fs::fstat(fd).map_err(unavailable)?;
    role(&after, uid, directory)?;
    if !same_observation(&before, &after) {
        return Err(Error::RecoveryRequired);
    }
    Ok(after)
}
fn same_observation(a: &Stat, b: &Stat) -> bool {
    Identity::of(a) == Identity::of(b)
        && a.st_mode == b.st_mode
        && a.st_uid == b.st_uid
        && a.st_gid == b.st_gid
        && a.st_nlink == b.st_nlink
        && a.st_size == b.st_size
        && a.st_flags == b.st_flags
        && a.st_mtime == b.st_mtime
        && a.st_mtime_nsec == b.st_mtime_nsec
        && a.st_ctime == b.st_ctime
        && a.st_ctime_nsec == b.st_ctime_nsec
}
fn open_named(
    parent: &OwnedFd,
    name: &str,
    uid: u32,
    directory: bool,
    access: OFlags,
) -> Result<Option<OwnedFd>> {
    let Some(before) = stat_name(parent, name)? else {
        return Ok(None);
    };
    role(&before, uid, directory)?;
    let extra = if directory {
        OFlags::DIRECTORY
    } else {
        OFlags::empty()
    };
    let fd =
        fs::openat(parent, name, flags() | access | extra, Mode::empty()).map_err(unavailable)?;
    let after = checked_fd(&fd, uid, directory)?;
    if !same_observation(&before, &after)
        || after.st_dev != fs::fstat(parent).map_err(unavailable)?.st_dev
    {
        return Err(Error::RecoveryRequired);
    }
    binding(parent, name, &after)?;
    Ok(Some(fd))
}
fn binding(parent: &OwnedFd, name: &str, observed: &Stat) -> Result<()> {
    let named = stat_name(parent, name)?.ok_or(Error::RecoveryRequired)?;
    if !same_observation(observed, &named) {
        return Err(Error::RecoveryRequired);
    }
    Ok(())
}

fn bounded_read(
    mut read: impl FnMut(&mut [u8], u64) -> io::Result<usize>,
    limit: usize,
) -> Result<Vec<u8>> {
    let mut bytes = vec![0; limit + 1];
    let mut offset = 0;
    let mut interruptions = 0;
    for _ in 0..MAX_IO_CALLS {
        match read(&mut bytes[offset..], offset as u64) {
            Ok(0) => {
                bytes.truncate(offset);
                return Ok(bytes);
            }
            Ok(count) if count <= bytes.len() - offset => {
                offset += count;
                if offset > limit {
                    return Err(Error::RecoveryRequired);
                }
            }
            Err(Errno::INTR) if interruptions < MAX_INTERRUPTS => interruptions += 1,
            _ => return Err(Error::StorageUnavailable),
        }
    }
    Err(Error::StorageUnavailable)
}
fn bounded_write(
    mut write: impl FnMut(&[u8], u64) -> io::Result<usize>,
    bytes: &[u8],
) -> Result<()> {
    let mut offset = 0;
    let mut interruptions = 0;
    for _ in 0..MAX_IO_CALLS {
        if offset == bytes.len() {
            return Ok(());
        }
        match write(&bytes[offset..], offset as u64) {
            Ok(count) if count > 0 && count <= bytes.len() - offset => offset += count,
            Err(Errno::INTR) if interruptions < MAX_INTERRUPTS => interruptions += 1,
            _ => return Err(Error::StorageUnavailable),
        }
    }
    if offset == bytes.len() {
        Ok(())
    } else {
        Err(Error::StorageUnavailable)
    }
}

impl MacStorage {
    #[cfg(test)]
    pub(super) fn fail_next_committed_sync(&mut self) {
        let mut fired = false;
        self.hook = Some(Box::new(move |phase| {
            if !fired && phase == Phase::BeforeCommittedSync {
                fired = true;
                Err(Error::StorageUnavailable)
            } else {
                Ok(())
            }
        }));
    }
    #[cfg(test)]
    pub(super) fn validate_anchor(path: &std::path::Path) -> Result<()> {
        anchor::TrustedAnchor::open_existing(path).map(|_| ())
    }
    pub(super) fn create_new_at(anchor: OwnedFd) -> Result<Self> {
        Self::construct(anchor, true, None)
    }
    pub(super) fn open_existing_at(anchor: OwnedFd) -> Result<Self> {
        Self::construct(anchor, false, None)
    }

    pub(super) fn from_path(path: &std::path::Path, create: bool) -> Result<Self> {
        let chain = anchor::TrustedAnchor::open_existing(path)?;
        let descriptor = chain.descriptor()?;
        Self::construct(descriptor, create, Some(chain))
    }

    fn construct(
        anchor: OwnedFd,
        create: bool,
        chain: Option<anchor::TrustedAnchor>,
    ) -> Result<Self> {
        let uid = rustix::process::geteuid().as_raw();
        if rustix::process::getuid().as_raw() != uid {
            return Err(Error::RecoveryRequired);
        }
        let fd_flags = io::fcntl_getfd(&anchor).map_err(unavailable)?;
        io::fcntl_setfd(&anchor, fd_flags | FdFlags::CLOEXEC).map_err(unavailable)?;
        let anchor_stat = checked_fd(&anchor, uid, true)?;
        if let Some(chain) = chain.as_ref() {
            chain.revalidate()?;
        }
        if create {
            fs::mkdirat(&anchor, DIRECTORY, Mode::from_raw_mode(0o700)).map_err(|error| {
                if error == Errno::EXIST {
                    Error::Conflict
                } else {
                    Error::StorageUnavailable
                }
            })?;
        }
        let directory =
            open_named(&anchor, DIRECTORY, uid, true, OFlags::RDONLY)?.ok_or(Error::Missing)?;
        let directory_stat = checked_fd(&directory, uid, true)?;
        if let Some(chain) = chain.as_ref() {
            chain.revalidate()?;
        }
        let lock = if create {
            // The directory is checked before child creation; the empty child is
            // checked before any payload can be written anywhere in this store.
            binding(&anchor, DIRECTORY, &directory_stat)?;
            let fd = fs::openat(
                &directory,
                LOCK,
                flags() | OFlags::RDWR | OFlags::CREATE | OFlags::EXCL,
                Mode::from_raw_mode(0o600),
            )
            .map_err(unavailable)?;
            checked_fd(&fd, uid, false)?;
            fd
        } else {
            open_named(&directory, LOCK, uid, false, OFlags::RDWR)?
                .ok_or(Error::RecoveryRequired)?
        };
        let lock_stat = checked_fd(&lock, uid, false)?;
        if lock_stat.st_size != 0 {
            return Err(Error::RecoveryRequired);
        }
        let mut storage = Self {
            anchor_chain: chain,
            anchor,
            directory,
            anchor_identity: Identity::of(&anchor_stat),
            directory_identity: Identity::of(&directory_stat),
            lock_identity: Identity::of(&lock_stat),
            uid,
            active_lock: None,
            staged: None,
            durable_current: None,
            fresh: create,
            #[cfg(test)]
            hook: None,
        };
        drop(lock);
        storage.lock()?;
        let result = storage.layout().map(|_| ());
        storage.unlock();
        result?;
        Ok(storage)
    }
    fn point(&mut self, _phase: Phase) -> Result<()> {
        #[cfg(test)]
        if let Some(hook) = self.hook.as_mut() {
            hook(_phase)?;
        }
        Ok(())
    }
    fn edges(&self) -> Result<()> {
        if let Some(chain) = self.anchor_chain.as_ref() {
            chain.revalidate()?;
        }
        let anchor = checked_fd(&self.anchor, self.uid, true)?;
        let directory = checked_fd(&self.directory, self.uid, true)?;
        if Identity::of(&anchor) != self.anchor_identity
            || Identity::of(&directory) != self.directory_identity
            || anchor.st_dev != directory.st_dev
        {
            return Err(Error::RecoveryRequired);
        }
        binding(&self.anchor, DIRECTORY, &directory)?;
        if let Some(lock) = self.active_lock.as_ref() {
            let observed = checked_fd(lock, self.uid, false)?;
            if Identity::of(&observed) != self.lock_identity
                || observed.st_size != 0
                || observed.st_dev != directory.st_dev
            {
                return Err(Error::RecoveryRequired);
            }
            binding(&self.directory, LOCK, &observed)?;
        }
        if let Some(chain) = self.anchor_chain.as_ref() {
            chain.revalidate()?;
        }
        Ok(())
    }
    fn locked_edges(&self) -> Result<()> {
        if self.active_lock.is_none() {
            return Err(Error::StorageUnavailable);
        }
        self.edges()
    }
    fn entries(&self) -> Result<()> {
        let mut names = 0u8;
        let mut directory = fs::Dir::read_from(&self.directory).map_err(unavailable)?;
        for _ in 0..8 {
            let Some(entry) = directory.next() else {
                return if names & 1 == 1 {
                    Ok(())
                } else {
                    Err(Error::RecoveryRequired)
                };
            };
            let entry = entry.map_err(unavailable)?;
            let bit = match entry.file_name().to_bytes() {
                b"." | b".." => continue,
                b"references.lock" => 1,
                b"references.current" => 2,
                b"references.pending" => 4,
                _ => return Err(Error::RecoveryRequired),
            };
            if names & bit != 0 {
                return Err(Error::RecoveryRequired);
            }
            names |= bit;
        }
        Err(Error::RecoveryRequired)
    }
    fn read_named(&mut self, name: &str) -> Result<Option<Stored>> {
        self.locked_edges()?;
        let Some(fd) = open_named(&self.directory, name, self.uid, false, OFlags::RDONLY)? else {
            self.locked_edges()?;
            return Ok(None);
        };
        let before = checked_fd(&fd, self.uid, false)?;
        if before.st_size > envelope::MAX_BYTES as i64 {
            return Err(Error::RecoveryRequired);
        }
        let bytes = bounded_read(
            |buffer, offset| io::pread(&fd, buffer, offset),
            envelope::MAX_BYTES,
        )?;
        self.point(Phase::Read)?;
        self.point(if name == CURRENT {
            Phase::ReadCurrent
        } else {
            Phase::ReadPending
        })?;
        let after = checked_fd(&fd, self.uid, false)?;
        if !same_observation(&before, &after) || after.st_size as usize != bytes.len() {
            return Err(Error::RecoveryRequired);
        }
        binding(&self.directory, name, &after)?;
        self.locked_edges()?;
        let candidate = envelope::decode(&bytes)?;
        Ok(Some(Stored {
            fd,
            identity: Identity::of(&after),
            observation: after,
            candidate,
            bytes,
        }))
    }
    fn layout(&mut self) -> Result<(Option<Stored>, Option<Stored>)> {
        self.locked_edges()?;
        self.entries()?;
        let current = self.read_named(CURRENT)?;
        let pending = self.read_named(PENDING)?;
        self.require_durable_identity(current.as_ref())?;
        match (current.as_ref(), pending.as_ref()) {
            (None, None) if !self.fresh => return Err(Error::RecoveryRequired),
            (None, Some(pending)) if pending.candidate.expected.is_some() => {
                return Err(Error::RecoveryRequired)
            }
            (Some(current), Some(pending)) => {
                Self::predecessor(Some(current), &pending.candidate)
                    .map_err(|_| Error::RecoveryRequired)?;
            }
            _ => (),
        }
        if current.is_some() {
            self.fresh = false;
        }
        self.entries()?;
        // Reading the second file is another observation boundary. Keep the
        // first file's metadata/name binding valid until the whole view returns.
        if let Some(value) = current.as_ref() {
            self.validate_observed(CURRENT, value)?;
        }
        if let Some(value) = pending.as_ref() {
            self.validate_observed(PENDING, value)?;
        }
        self.locked_edges()?;
        Ok((current, pending))
    }
    fn predecessor(current: Option<&Stored>, candidate: &Candidate) -> Result<()> {
        match (current, candidate.expected) {
            (None, None) => Ok(()),
            (Some(current), Some(expected)) => {
                let old = codec::decode(&current.candidate.bytes)?;
                let new = codec::decode(&candidate.bytes)?;
                if old.token() != expected {
                    return Err(Error::StaleSnapshot);
                }
                if old.installation != new.installation {
                    return Err(Error::InvalidInstallation);
                }
                Ok(())
            }
            _ => Err(Error::Conflict),
        }
    }
    fn exact_pending(&mut self, staged: &Stored) -> Result<()> {
        let found = self.read_named(PENDING)?.ok_or(Error::RecoveryRequired)?;
        if found.identity != staged.identity || found.bytes != staged.bytes {
            return Err(Error::RecoveryRequired);
        }
        Ok(())
    }
    fn validate_observed(&self, name: &str, value: &Stored) -> Result<()> {
        let now = checked_fd(&value.fd, self.uid, false)?;
        if !same_observation(&value.observation, &now) {
            return Err(Error::RecoveryRequired);
        }
        binding(&self.directory, name, &now)
    }
    fn require_durable_identity(&self, current: Option<&Stored>) -> Result<()> {
        if let Some(pinned) = self.durable_current.as_ref() {
            let current = current.ok_or(Error::RecoveryRequired)?;
            if current.identity != pinned.identity || current.bytes != pinned.bytes {
                return Err(Error::RecoveryRequired);
            }
        }
        Ok(())
    }
    fn durable_identity(&mut self) -> Result<()> {
        if self.durable_current.is_some() {
            let current = self.read_named(CURRENT)?;
            self.require_durable_identity(current.as_ref())?;
        }
        Ok(())
    }
}

impl Storage for MacStorage {
    fn lock(&mut self) -> Result<()> {
        if self.active_lock.is_some() {
            return Err(Error::Busy);
        }
        self.edges()?;
        let fd = open_named(&self.directory, LOCK, self.uid, false, OFlags::RDWR)?
            .ok_or(Error::RecoveryRequired)?;
        let stat = checked_fd(&fd, self.uid, false)?;
        if Identity::of(&stat) != self.lock_identity || stat.st_size != 0 {
            return Err(Error::RecoveryRequired);
        }
        fs::flock(&fd, FlockOperation::NonBlockingLockExclusive).map_err(|error| {
            if error == Errno::WOULDBLOCK {
                Error::Busy
            } else {
                Error::StorageUnavailable
            }
        })?;
        self.active_lock = Some(fd);
        // Engine's Guard does not exist until lock() returns successfully.
        let mut attempt = LockAttempt {
            storage: self,
            armed: true,
        };
        attempt.storage.point(Phase::Locked)?;
        attempt.storage.locked_edges()?;
        attempt.armed = false;
        Ok(())
    }
    fn unlock(&mut self) {
        self.staged = None;
        self.durable_current = None;
        if let Some(fd) = self.active_lock.take() {
            let _ = fs::flock(&fd, FlockOperation::Unlock);
            // This is the only owned reference to this lock description. Closing
            // it also releases custody when an explicit unlock reports failure.
            drop(fd);
        }
    }
    fn read_committed(&mut self, max_bytes: usize) -> Result<Option<Vec<u8>>> {
        let (current, _) = self.layout()?;
        match current {
            Some(value) if value.candidate.bytes.len() > max_bytes => Err(Error::InvalidManifest),
            Some(value) => Ok(Some(value.candidate.bytes)),
            None => Ok(None),
        }
    }
    fn stage(&mut self, candidate: &Candidate) -> Result<()> {
        let bytes = envelope::encode(candidate)?;
        self.point(Phase::BeforeStage)?;
        let (current, pending) = self.layout()?;
        Self::predecessor(current.as_ref(), candidate)?;
        if let Some(pending) = pending {
            if pending.bytes != bytes {
                return Err(Error::RecoveryRequired);
            }
            self.staged = Some(pending);
            return Ok(());
        }
        self.locked_edges()?;
        let fd = fs::openat(
            &self.directory,
            PENDING,
            flags() | OFlags::RDWR | OFlags::CREATE | OFlags::EXCL,
            Mode::from_raw_mode(0o600),
        )
        .map_err(|error| {
            if error == Errno::EXIST {
                Error::RecoveryRequired
            } else {
                Error::StorageUnavailable
            }
        })?;
        let empty = checked_fd(&fd, self.uid, false)?;
        if empty.st_size != 0 {
            return Err(Error::RecoveryRequired);
        }
        binding(&self.directory, PENDING, &empty)?;
        self.point(Phase::StageCreated)?;
        self.locked_edges()?;
        let still_empty = checked_fd(&fd, self.uid, false)?;
        if !same_observation(&empty, &still_empty) {
            return Err(Error::RecoveryRequired);
        }
        binding(&self.directory, PENDING, &still_empty)?;
        bounded_write(|buffer, offset| io::pwrite(&fd, buffer, offset), &bytes)?;
        self.point(Phase::StageWritten)?;
        let staged = self.read_named(PENDING)?.ok_or(Error::RecoveryRequired)?;
        if staged.identity != Identity::of(&empty) || staged.bytes != bytes {
            return Err(Error::RecoveryRequired);
        }
        self.staged = Some(staged);
        Ok(())
    }
    fn sync_candidate(&mut self) -> Result<()> {
        let staged = self.staged.take().ok_or(Error::RecoveryRequired)?;
        self.point(Phase::BeforeCandidateSync)?;
        self.exact_pending(&staged)?;
        fs::fsync(&staged.fd).map_err(unavailable)?;
        self.point(Phase::CandidateFileSynced)?;
        self.locked_edges()?;
        fs::fsync(&self.directory).map_err(unavailable)?;
        self.point(Phase::CandidateDirectorySynced)?;
        io_fullsync(&staged.fd)?;
        self.point(Phase::CandidateFullySynced)?;
        self.exact_pending(&staged)?;
        self.staged = Some(staged);
        Ok(())
    }
    fn sync_committed(&mut self) -> Result<()> {
        self.point(Phase::BeforeCommittedSync)?;
        let current = self.read_named(CURRENT)?.ok_or(Error::Missing)?;
        fs::fsync(&current.fd).map_err(unavailable)?;
        self.point(Phase::CommittedFileSynced)?;
        io_fullsync(&current.fd)?;
        self.point(Phase::CommittedFullySynced)?;
        let after = self.read_named(CURRENT)?.ok_or(Error::RecoveryRequired)?;
        if current.identity != after.identity || current.bytes != after.bytes {
            return Err(Error::RecoveryRequired);
        }
        self.durable_current = Some(current);
        Ok(())
    }
    fn publish(&mut self, candidate: &Candidate) -> Result<()> {
        let staged = self.staged.take().ok_or(Error::RecoveryRequired)?;
        self.point(Phase::BeforePublish)?;
        let (current, pending) = self.layout()?;
        Self::predecessor(current.as_ref(), candidate)?;
        let pending = pending.ok_or(Error::RecoveryRequired)?;
        if staged.candidate != *candidate
            || staged.identity != pending.identity
            || staged.bytes != pending.bytes
        {
            return Err(Error::RecoveryRequired);
        }
        self.locked_edges()?;
        self.point(Phase::RenameDispatch)?;
        if candidate.expected.is_none() {
            fs::renameat_with(
                &self.directory,
                PENDING,
                &self.directory,
                CURRENT,
                fs::RenameFlags::NOREPLACE,
            )
            .map_err(unavailable)?;
        } else {
            fs::renameat(&self.directory, PENDING, &self.directory, CURRENT)
                .map_err(unavailable)?;
        }
        self.fresh = false;
        self.point(Phase::Published)?;
        // Rename legitimately changes ctime and unlinks the former current
        // inode. Establish the new phase by staged identity and exact bytes.
        let current = self.read_named(CURRENT)?.ok_or(Error::RecoveryRequired)?;
        if current.identity != staged.identity
            || current.bytes != staged.bytes
            || stat_name(&self.directory, PENDING)?.is_some()
        {
            return Err(Error::RecoveryRequired);
        }
        self.durable_current = Some(current);
        self.entries()?;
        self.locked_edges()
    }
    fn sync_directory(&mut self) -> Result<()> {
        self.point(Phase::BeforeDirectorySync)?;
        self.locked_edges()?;
        self.durable_identity()?;
        fs::fsync(&self.directory).map_err(unavailable)?;
        self.point(Phase::DirectorySynced)?;
        fs::fsync(&self.anchor).map_err(unavailable)?;
        self.point(Phase::AnchorSynced)?;
        self.locked_edges()?;
        // Apple documents fullfsync as flushing prior fsync work on the same
        // device. The immutable empty lock is checked to be on that device.
        io_fullsync(self.active_lock.as_ref().ok_or(Error::StorageUnavailable)?)?;
        self.point(Phase::DirectoryFullySynced)?;
        self.durable_identity()?;
        self.locked_edges()
    }
}

fn io_fullsync(fd: &OwnedFd) -> Result<()> {
    fs::fcntl_fullfsync(fd).map_err(unavailable)
}
