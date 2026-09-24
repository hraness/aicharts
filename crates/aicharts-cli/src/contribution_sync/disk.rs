//! Descriptor-pinned APFS checkpoint with a stable advisory lock. A valid staged
//! successor is recoverable; partial/corrupt stages refuse, never get deleted.
use super::{Binding, Checkpoint, LegacyCheckpoint, MAX_CHECKPOINT_BYTES};
use aicharts_platform_acl::{require_deny_only_acl, require_no_acl};
use hmac::{Hmac, Mac};
use rustix::{
    fd::{AsFd, OwnedFd},
    fs::{self, AtFlags, FileType, FlockOperation, Mode, OFlags, Stat},
    io::Errno,
};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::{
    ffi::OsString,
    fs::File,
    io::{Read, Write},
    os::unix::ffi::OsStrExt,
    path::Path,
};
const CURRENT: &str = "contribution-sync-v3.current";
const NEXT: &str = "contribution-sync-v3.pending";
const LOCK: &str = "contribution-sync-v3.lock";
const CAP: u64 = MAX_CHECKPOINT_BYTES as u64;
const INVALID: &str = "contribution_sync_checkpoint_recovery_required";
const IO: &str = "contribution_sync_checkpoint_unavailable";
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Step {
    StageCreated,
    StageWritten,
    StageSynced,
    StageRenamed,
    DirectorySynced,
    CurrentReadBack,
}
fn flags() -> OFlags {
    OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK
}
fn ident(stat: &Stat) -> (i32, u64) {
    (stat.st_dev, stat.st_ino)
}
fn stat(fd: &OwnedFd, uid: u32, private: bool, directory: bool) -> Result<Stat, &'static str> {
    let value = fs::fstat(fd).map_err(|_| IO)?;
    let kind = if directory {
        FileType::Directory
    } else {
        FileType::RegularFile
    };
    if FileType::from_raw_mode(value.st_mode) != kind
        || value.st_nlink == 0
        || (!directory && (value.st_nlink != 1 || value.st_size < 0))
        || (private
            && (value.st_uid != uid
                || value.st_mode & 0o7777 != if directory { 0o700 } else { 0o600 }))
        || (!private && ((value.st_uid != 0 && value.st_uid != uid) || value.st_mode & 0o022 != 0))
    {
        return Err(INVALID);
    }
    if private {
        require_no_acl(fd.as_fd()).map_err(|_| INVALID)?;
    } else {
        require_deny_only_acl(fd.as_fd()).map_err(|_| INVALID)?;
    }
    let volume = fs::fstatfs(fd).map_err(|_| IO)?;
    let name: Vec<u8> = volume
        .f_fstypename
        .iter()
        .take_while(|b| **b != 0)
        .map(|b| *b as u8)
        .collect();
    if name != b"apfs"
        || volume.f_flags & 0x1000 == 0
        || volume.f_flags & 0x20_0000 != 0
        || (private && volume.f_flags & 1 != 0)
    {
        return Err(INVALID);
    }
    Ok(value)
}
struct Edge {
    fd: OwnedFd,
    name: OsString,
    id: (i32, u64),
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope<T = Checkpoint> {
    schema_version: u8,
    previous: Option<String>,
    payload: T,
    mac: String,
}
fn authenticator<T: Serialize>(
    key: &[u8; 32],
    previous: Option<&str>,
    payload: &T,
) -> Result<Hmac<Sha256>, &'static str> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).map_err(|_| INVALID)?;
    mac.update(b"aicharts:contribution-sync-v3:checkpoint\0");
    mac.update(previous.unwrap_or("").as_bytes());
    mac.update(b"\0");
    mac.update(&serde_json::to_vec(payload).map_err(|_| INVALID)?);
    Ok(mac)
}
fn decode_typed<T: Serialize + serde::de::DeserializeOwned>(
    bytes: &[u8],
    key: &[u8; 32],
) -> Result<Envelope<T>, &'static str> {
    let envelope: Envelope<T> = serde_json::from_slice(bytes).map_err(|_| INVALID)?;
    if envelope.schema_version != 1
        || !hexadecimal(&envelope.mac)
        || envelope.previous.as_ref().is_some_and(|v| !hexadecimal(v))
    {
        return Err(INVALID);
    }
    let mut expected = [0u8; 32];
    for (i, pair) in envelope.mac.as_bytes().chunks_exact(2).enumerate() {
        expected[i] = u8::from_str_radix(std::str::from_utf8(pair).map_err(|_| INVALID)?, 16)
            .map_err(|_| INVALID)?;
    }
    authenticator(key, envelope.previous.as_deref(), &envelope.payload)?
        .verify_slice(&expected)
        .map_err(|_| INVALID)?;
    if serde_json::to_vec(&envelope).map_err(|_| INVALID)? != bytes {
        return Err(INVALID);
    }
    Ok(envelope)
}
fn decode(bytes: &[u8], key: &[u8; 32]) -> Result<Envelope, &'static str> {
    // The discriminator only selects a decoder. The typed pass below rejects
    // duplicates/unknown fields, verifies the original MAC and exact canonical
    // bytes before any schema-1 representation is converted in memory.
    let raw: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| INVALID)?;
    let envelope = match raw
        .get("payload")
        .and_then(|p| p.get("schemaVersion"))
        .and_then(serde_json::Value::as_u64)
    {
        Some(1) => {
            let old: Envelope<LegacyCheckpoint> = decode_typed(bytes, key)?;
            Envelope {
                schema_version: old.schema_version,
                previous: old.previous,
                payload: old.payload.into_current()?,
                mac: old.mac,
            }
        }
        Some(2) => decode_typed(bytes, key)?,
        _ => return Err(INVALID),
    };
    envelope.payload.validate()?;
    Ok(envelope)
}
pub(super) struct Disk {
    #[cfg(test)]
    failure: Option<Step>,
    writable: bool,
    root: OwnedFd,
    root_id: (i32, u64),
    edges: Vec<Edge>,
    lock: OwnedFd,
    lock_id: (i32, u64),
    uid: u32,
    key: [u8; 32],
    current: Option<String>,
    loaded: bool,
    checkpoint: Option<Checkpoint>,
}
impl Disk {
    fn step(&self, step: Step) -> Result<(), &'static str> {
        #[cfg(test)]
        if self.failure == Some(step) {
            return Err(IO);
        }
        let _ = step;
        Ok(())
    }
    #[cfg(test)]
    pub(super) fn fail_at(&mut self, step: Step) {
        self.failure = Some(step);
    }
    pub(super) fn create(path: &Path, key: &[u8; 32]) -> Result<Self, &'static str> {
        Self::open(path, key, true, true)
    }
    pub(super) fn writer(path: &Path, key: &[u8; 32]) -> Result<Self, &'static str> {
        Self::open(path, key, true, false)
    }
    pub(super) fn reader(path: &Path, key: &[u8; 32]) -> Result<Self, &'static str> {
        Self::open(path, key, false, false)
    }
    fn open(
        path: &Path,
        key: &[u8; 32],
        writable: bool,
        create: bool,
    ) -> Result<Self, &'static str> {
        if key == &[0; 32] {
            return Err(INVALID);
        }
        let bytes = path.as_os_str().as_bytes();
        if bytes.len() < 2 || bytes.len() > 1023 || bytes[0] != b'/' || bytes.contains(&0) {
            return Err(INVALID);
        }
        let names: Vec<_> = bytes[1..].split(|b| *b == b'/').collect();
        if names.len() > 64
            || names
                .iter()
                .any(|n| n.is_empty() || n.len() > 255 || *n == b"." || *n == b"..")
        {
            return Err(INVALID);
        }
        let uid = rustix::process::geteuid().as_raw();
        if uid != rustix::process::getuid().as_raw() {
            return Err(INVALID);
        }
        let root = fs::open(
            "/",
            flags() | OFlags::RDONLY | OFlags::DIRECTORY,
            Mode::empty(),
        )
        .map_err(|_| IO)?;
        let root_id = ident(&stat(&root, uid, false, true)?);
        let mut edges: Vec<Edge> = Vec::new();
        for (index, name) in names.iter().enumerate() {
            let name = std::ffi::OsStr::from_bytes(name).to_owned();
            let parent = edges.last().map_or(&root, |e| &e.fd);
            let fd = fs::openat(
                parent,
                &name,
                flags() | OFlags::RDONLY | OFlags::DIRECTORY,
                Mode::empty(),
            )
            .map_err(|_| IO)?;
            let found = stat(&fd, uid, index + 1 == names.len(), true)?;
            if ident(&found)
                != ident(&fs::statat(parent, &name, AtFlags::SYMLINK_NOFOLLOW).map_err(|_| IO)?)
            {
                return Err(INVALID);
            }
            edges.push(Edge {
                fd,
                name,
                id: ident(&found),
            });
        }
        let directory = &edges.last().ok_or(INVALID)?.fd;
        if create {
            for name in [CURRENT, NEXT, LOCK] {
                match fs::statat(directory, name, AtFlags::SYMLINK_NOFOLLOW) {
                    Err(Errno::NOENT) => {}
                    _ => return Err(INVALID),
                }
            }
        }
        let access = if writable {
            OFlags::RDWR
        } else {
            OFlags::RDONLY
        };
        let creation = if create {
            OFlags::CREATE | OFlags::EXCL
        } else {
            OFlags::empty()
        };
        let lock = fs::openat(
            directory,
            LOCK,
            flags() | access | creation,
            Mode::from_raw_mode(0o600),
        )
        .map_err(|_| IO)?;
        let observed = stat(&lock, uid, true, false)?;
        if observed.st_size != 0 || observed.st_dev != stat(directory, uid, true, true)?.st_dev {
            return Err(INVALID);
        }
        fs::flock(
            &lock,
            if writable {
                FlockOperation::NonBlockingLockExclusive
            } else {
                FlockOperation::NonBlockingLockShared
            },
        )
        .map_err(|error| {
            if error == Errno::WOULDBLOCK {
                "contribution_sync_busy"
            } else {
                IO
            }
        })?;
        let disk = Self {
            #[cfg(test)]
            failure: None,
            writable,
            root,
            root_id,
            edges,
            lock,
            lock_id: ident(&observed),
            uid,
            key: *key,
            current: None,
            loaded: create,
            checkpoint: None,
        };
        disk.revalidate()?;
        if create {
            fs::fsync(disk.directory()).map_err(|_| IO)?;
            fs::fcntl_fullfsync(&disk.lock).map_err(|_| IO)?;
        }
        Ok(disk)
    }
    fn directory(&self) -> &OwnedFd {
        &self.edges.last().expect("nonempty checked anchor").fd
    }
    pub(super) fn revalidate(&self) -> Result<(), &'static str> {
        if rustix::process::geteuid().as_raw() != self.uid
            || rustix::process::getuid().as_raw() != self.uid
            || ident(&stat(&self.root, self.uid, false, true)?) != self.root_id
        {
            return Err(INVALID);
        }
        let mut parent = &self.root;
        for (index, edge) in self.edges.iter().enumerate() {
            if ident(&stat(
                &edge.fd,
                self.uid,
                index + 1 == self.edges.len(),
                true,
            )?) != edge.id
                || ident(
                    &fs::statat(parent, &edge.name, AtFlags::SYMLINK_NOFOLLOW).map_err(|_| IO)?,
                ) != edge.id
            {
                return Err(INVALID);
            }
            parent = &edge.fd;
        }
        let observed = stat(&self.lock, self.uid, true, false)?;
        if ident(&observed) != self.lock_id
            || observed.st_size != 0
            || ident(
                &fs::statat(self.directory(), LOCK, AtFlags::SYMLINK_NOFOLLOW).map_err(|_| IO)?,
            ) != self.lock_id
        {
            return Err(INVALID);
        }
        Ok(())
    }
    fn load_name(&self, name: &str) -> Result<Option<(Envelope, OwnedFd, Stat)>, &'static str> {
        self.revalidate()?;
        let fd = match fs::openat(
            self.directory(),
            name,
            flags() | OFlags::RDONLY,
            Mode::empty(),
        ) {
            Ok(fd) => fd,
            Err(Errno::NOENT) => return Ok(None),
            Err(_) => return Err(IO),
        };
        let before = stat(&fd, self.uid, true, false)?;
        if before.st_size == 0 || before.st_size as u64 > CAP {
            return Err(INVALID);
        }
        let mut bytes = Vec::with_capacity(before.st_size as usize);
        let mut file = File::from(fd);
        (&mut file)
            .take(CAP + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| IO)?;
        let fd: OwnedFd = file.into();
        let after = stat(&fd, self.uid, true, false)?;
        if bytes.len() as i64 != before.st_size
            || before.st_size != after.st_size
            || before.st_mtime != after.st_mtime
            || before.st_mtime_nsec != after.st_mtime_nsec
            || before.st_ctime != after.st_ctime
            || before.st_ctime_nsec != after.st_ctime_nsec
            || ident(&before) != ident(&after)
            || ident(&after)
                != ident(
                    &fs::statat(self.directory(), name, AtFlags::SYMLINK_NOFOLLOW)
                        .map_err(|_| IO)?,
                )
        {
            return Err(INVALID);
        }
        self.revalidate()?;
        Ok(Some((decode(&bytes, &self.key)?, fd, after)))
    }
    fn read_name(&self, name: &str) -> Result<Option<Envelope>, &'static str> {
        Ok(self.load_name(name)?.map(|(envelope, _, _)| envelope))
    }
    fn publish(&self, expected_mac: &str, previous: Option<&str>) -> Result<(), &'static str> {
        if !self.writable {
            return Err(INVALID);
        }
        self.revalidate()?;
        let (envelope, fd, observed) = self.load_name(NEXT)?.ok_or(INVALID)?;
        if envelope.mac != expected_mac
            || envelope.previous.as_deref() != previous
            || self.read_name(CURRENT)?.as_ref().map(|v| v.mac.as_str()) != previous
        {
            return Err(INVALID);
        }
        fs::fsync(&fd).map_err(|_| IO)?;
        fs::fcntl_fullfsync(&fd).map_err(|_| IO)?;
        self.revalidate()?;
        let after = stat(&fd, self.uid, true, false)?;
        let named =
            fs::statat(self.directory(), NEXT, AtFlags::SYMLINK_NOFOLLOW).map_err(|_| IO)?;
        let same = |a: &Stat, b: &Stat| {
            ident(a) == ident(b)
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
        };
        if !same(&observed, &after) || !same(&after, &named) {
            return Err(INVALID);
        }
        // The stable advisory lock serializes cooperating writers. This is an
        // identity-checked publish, not a content-CAS against hostile same-user
        // writes after the final check.
        fs::renameat(self.directory(), NEXT, self.directory(), CURRENT).map_err(|_| IO)?;
        self.step(Step::StageRenamed)?;
        fs::fsync(self.directory()).map_err(|_| IO)?;
        fs::fcntl_fullfsync(&self.lock).map_err(|_| IO)?;
        self.step(Step::DirectorySynced)?;
        self.revalidate()
    }
    #[cfg(test)]
    pub(super) fn inspect(&self, binding: &Binding) -> Result<Option<Checkpoint>, &'static str> {
        binding.validate()?;
        let current = self.inspect_local()?;
        if current
            .as_ref()
            .is_some_and(|value| &value.binding != binding)
        {
            return Err(INVALID);
        }
        Ok(current)
    }
    pub(super) fn inspect_local(&self) -> Result<Option<Checkpoint>, &'static str> {
        let current = self.read_name(CURRENT)?;
        if self.read_name(NEXT)?.is_some() {
            return Err(INVALID);
        }
        Ok(current.map(|value| value.payload))
    }
    pub(super) fn recover(
        &mut self,
        binding: &Binding,
    ) -> Result<Option<Checkpoint>, &'static str> {
        if !self.writable {
            return Err(INVALID);
        }
        binding.validate()?;
        let mut current = self.read_name(CURRENT)?;
        if current
            .as_ref()
            .is_some_and(|value| &value.payload.binding != binding)
        {
            return Err(INVALID);
        }
        if let Some(pending) = self.read_name(NEXT)? {
            if &pending.payload.binding != binding
                || pending.previous.as_deref() != current.as_ref().map(|c| c.mac.as_str())
            {
                return Err(INVALID);
            }
            pending
                .payload
                .follows(current.as_ref().map(|value| &value.payload))?;
            self.publish(&pending.mac, pending.previous.as_deref())?;
            let observed = self.read_name(CURRENT)?.ok_or(INVALID)?;
            if observed.mac != pending.mac || observed.payload != pending.payload {
                return Err(INVALID);
            }
            current = Some(observed);
        }
        // An earlier caller may have lost the result after rename but before
        // directory durability. Only explicit writer recovery re-establishes
        // durability; merely observing intact bytes never grants a send.
        if let Some(expected) = &current {
            let (observed, fd, _) = self.load_name(CURRENT)?.ok_or(INVALID)?;
            if observed.mac != expected.mac || observed.payload != expected.payload {
                return Err(INVALID);
            }
            fs::fsync(&fd).map_err(|_| IO)?;
            fs::fcntl_fullfsync(&fd).map_err(|_| IO)?;
            fs::fsync(self.directory()).map_err(|_| IO)?;
            fs::fcntl_fullfsync(&self.lock).map_err(|_| IO)?;
            self.revalidate()?;
            let verified = self.read_name(CURRENT)?.ok_or(INVALID)?;
            if verified.mac != expected.mac || verified.payload != expected.payload {
                return Err(INVALID);
            }
        }
        self.current = current.as_ref().map(|value| value.mac.clone());
        self.checkpoint = current.as_ref().map(|value| value.payload.clone());
        self.loaded = true;
        Ok(current.map(|value| value.payload))
    }
    pub(super) fn matches(&self, checkpoint: &Checkpoint) -> Result<(), &'static str> {
        self.revalidate()?;
        let current = self.read_name(CURRENT)?.ok_or(INVALID)?;
        if !self.loaded
            || self.read_name(NEXT)?.is_some()
            || Some(&current.mac) != self.current.as_ref()
            || &current.payload != checkpoint
            || self.checkpoint.as_ref() != Some(checkpoint)
        {
            return Err(INVALID);
        }
        Ok(())
    }
    pub(super) fn write(&mut self, value: &Checkpoint) -> Result<(), &'static str> {
        value.follows(self.checkpoint.as_ref())?;
        if !self.writable
            || !self.loaded
            || self.read_name(CURRENT)?.map(|v| v.mac) != self.current
            || self.read_name(NEXT)?.is_some()
        {
            return Err(INVALID);
        }
        let mac = hex(&authenticator(&self.key, self.current.as_deref(), value)?
            .finalize()
            .into_bytes());
        let next = Envelope {
            schema_version: 1,
            previous: self.current.clone(),
            payload: value.clone(),
            mac: mac.clone(),
        };
        let bytes = serde_json::to_vec(&next).map_err(|_| INVALID)?;
        if bytes.len() as u64 > CAP {
            return Err("contribution_sync_limit");
        }
        let fd = fs::openat(
            self.directory(),
            NEXT,
            flags() | OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL,
            Mode::from_raw_mode(0o600),
        )
        .map_err(|_| IO)?;
        stat(&fd, self.uid, true, false)?;
        self.step(Step::StageCreated)?;
        let mut file = File::from(fd);
        file.write_all(&bytes).map_err(|_| IO)?;
        self.step(Step::StageWritten)?;
        let fd: OwnedFd = file.into();
        fs::fsync(&fd).map_err(|_| IO)?;
        fs::fcntl_fullfsync(&fd).map_err(|_| IO)?;
        self.step(Step::StageSynced)?;
        if self.read_name(NEXT)?.map(|v| v.mac) != Some(mac.clone()) {
            return Err(INVALID);
        }
        fs::fsync(self.directory()).map_err(|_| IO)?;
        fs::fcntl_fullfsync(&self.lock).map_err(|_| IO)?;
        self.publish(&mac, self.current.as_deref())?;
        if self.read_name(CURRENT)?.map(|v| v.mac) != Some(mac.clone()) {
            return Err(INVALID);
        }
        self.step(Step::CurrentReadBack)?;
        self.current = Some(mac);
        self.checkpoint = Some(value.clone());
        Ok(())
    }
}

fn hexadecimal(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(output, "{byte:02x}");
    }
    output
}
#[cfg(test)]
mod tests;
