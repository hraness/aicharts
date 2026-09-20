//! Descriptor-pinned APFS checkpoint with a stable advisory lock. A valid staged
//! successor is recoverable; partial/corrupt stages refuse, never get deleted.
use super::{Checkpoint, MAX_BYTES};
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
const CURRENT: &str = "stats-sync-v2.current";
const NEXT: &str = "stats-sync-v2.pending";
const LOCK: &str = "stats-sync-v2.lock";
const CAP: u64 = (MAX_BYTES + 16 * 1024) as u64;
const INVALID: &str = "stats_sync_checkpoint_recovery_required";
const IO: &str = "stats_sync_checkpoint_unavailable";
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
struct Envelope {
    schema_version: u8,
    previous: Option<String>,
    payload: Checkpoint,
    mac: String,
}
fn authenticator(
    key: &[u8; 32],
    previous: Option<&str>,
    payload: &Checkpoint,
) -> Result<Hmac<Sha256>, &'static str> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).map_err(|_| INVALID)?;
    mac.update(b"aicharts:stats-sync-v2:checkpoint\0");
    mac.update(previous.unwrap_or("").as_bytes());
    mac.update(b"\0");
    mac.update(&serde_json::to_vec(payload).map_err(|_| INVALID)?);
    Ok(mac)
}
fn decode(bytes: &[u8], key: &[u8; 32]) -> Result<Envelope, &'static str> {
    let envelope: Envelope = serde_json::from_slice(bytes).map_err(|_| INVALID)?;
    if envelope.schema_version != 1
        || !super::is_hex(&envelope.mac, 64)
        || envelope
            .previous
            .as_ref()
            .is_some_and(|v| !super::is_hex(v, 64))
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
    envelope.payload.validate()?;
    Ok(envelope)
}
pub(super) struct Disk {
    root: OwnedFd,
    root_id: (i32, u64),
    edges: Vec<Edge>,
    lock: OwnedFd,
    lock_id: (i32, u64),
    uid: u32,
    key: [u8; 32],
    current: Option<String>,
    loaded: bool,
}
impl Disk {
    pub(super) fn open(path: &Path, key: &[u8; 32]) -> Result<Self, &'static str> {
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
        let lock = fs::openat(
            directory,
            LOCK,
            flags() | OFlags::RDWR | OFlags::CREATE,
            Mode::from_raw_mode(0o600),
        )
        .map_err(|_| IO)?;
        let observed = stat(&lock, uid, true, false)?;
        if observed.st_size != 0 || observed.st_dev != stat(directory, uid, true, true)?.st_dev {
            return Err(INVALID);
        }
        fs::flock(&lock, FlockOperation::NonBlockingLockExclusive).map_err(|error| {
            if error == Errno::WOULDBLOCK {
                "stats_sync_busy"
            } else {
                IO
            }
        })?;
        let disk = Self {
            root,
            root_id,
            edges,
            lock,
            lock_id: ident(&observed),
            uid,
            key: *key,
            current: None,
            loaded: false,
        };
        disk.revalidate()?;
        fs::fsync(disk.directory()).map_err(|_| IO)?;
        fs::fcntl_fullfsync(&disk.lock).map_err(|_| IO)?;
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
        fs::fsync(self.directory()).map_err(|_| IO)?;
        fs::fcntl_fullfsync(&self.lock).map_err(|_| IO)?;
        self.revalidate()
    }
    pub(super) fn read(&mut self) -> Result<Option<Checkpoint>, &'static str> {
        let mut current = self.read_name(CURRENT)?;
        if let Some(pending) = self.read_name(NEXT)? {
            if pending.previous.as_deref() != current.as_ref().map(|c| c.mac.as_str()) {
                return Err(INVALID);
            }
            self.publish(&pending.mac, pending.previous.as_deref())?;
            current = Some(pending);
        }
        self.current = current.as_ref().map(|value| value.mac.clone());
        self.loaded = true;
        Ok(current.map(|value| value.payload))
    }
    pub(super) fn write(&mut self, value: &Checkpoint) -> Result<(), &'static str> {
        value.validate()?;
        if !self.loaded
            || self.read_name(CURRENT)?.map(|v| v.mac) != self.current
            || self.read_name(NEXT)?.is_some()
        {
            return Err(INVALID);
        }
        let mac = super::hex(
            &authenticator(&self.key, self.current.as_deref(), value)?
                .finalize()
                .into_bytes(),
        );
        let next = Envelope {
            schema_version: 1,
            previous: self.current.clone(),
            payload: value.clone(),
            mac: mac.clone(),
        };
        let bytes = serde_json::to_vec(&next).map_err(|_| INVALID)?;
        if bytes.len() as u64 > CAP {
            return Err("stats_sync_limit");
        }
        let fd = fs::openat(
            self.directory(),
            NEXT,
            flags() | OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL,
            Mode::from_raw_mode(0o600),
        )
        .map_err(|_| IO)?;
        stat(&fd, self.uid, true, false)?;
        let mut file = File::from(fd);
        file.write_all(&bytes).map_err(|_| IO)?;
        let fd: OwnedFd = file.into();
        fs::fsync(&fd).map_err(|_| IO)?;
        fs::fcntl_fullfsync(&fd).map_err(|_| IO)?;
        if self.read_name(NEXT)?.map(|v| v.mac) != Some(mac.clone()) {
            return Err(INVALID);
        }
        fs::fsync(self.directory()).map_err(|_| IO)?;
        fs::fcntl_fullfsync(&self.lock).map_err(|_| IO)?;
        self.publish(&mac, self.current.as_deref())?;
        if self.read_name(CURRENT)?.map(|v| v.mac) != Some(mac.clone()) {
            return Err(INVALID);
        }
        self.current = Some(mac);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs as diskfs,
        os::unix::fs::PermissionsExt,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    const KEY: [u8; 32] = [0xa4; 32];
    struct Scratch(PathBuf);
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = diskfs::remove_dir_all(&self.0);
        }
    }
    fn scratch() -> Scratch {
        let parent = diskfs::canonicalize(std::env::temp_dir()).unwrap();
        let path = parent.join(format!(
            "aicharts-stats-sync-{}-{}",
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        ));
        diskfs::create_dir(&path).unwrap();
        diskfs::set_permissions(&path, diskfs::Permissions::from_mode(0o700)).unwrap();
        Scratch(path)
    }
    fn checkpoint() -> Checkpoint {
        let upload = super::super::tests::upload();
        Checkpoint {
            schema_version: 1,
            account_id: upload.account_id.clone(),
            device_id: upload.device_id.clone(),
            generation: upload.generation.clone(),
            last_sequence: 0,
            last_revision: 0,
            flight: Some(upload),
            receipt: None,
        }
    }
    fn stage(path: &Path, previous: Option<String>, payload: &Checkpoint, key: &[u8; 32]) {
        let mac = super::super::hex(
            &authenticator(key, previous.as_deref(), payload)
                .unwrap()
                .finalize()
                .into_bytes(),
        );
        let envelope = Envelope {
            schema_version: 1,
            previous,
            payload: payload.clone(),
            mac,
        };
        let file = path.join(NEXT);
        diskfs::write(&file, serde_json::to_vec(&envelope).unwrap()).unwrap();
        diskfs::set_permissions(file, diskfs::Permissions::from_mode(0o600)).unwrap();
    }
    #[test]
    fn real_apfs_checkpoint_restarts_exactly_and_wrong_key_refuses() {
        let path = scratch();
        let value = checkpoint();
        let mut disk = Disk::open(&path.0, &KEY).unwrap();
        assert_eq!(disk.read().unwrap(), None);
        disk.write(&value).unwrap();
        assert!(Disk::open(&path.0, &KEY).is_err());
        drop(disk);
        let mut disk = Disk::open(&path.0, &KEY).unwrap();
        assert_eq!(disk.read().unwrap(), Some(value));
        drop(disk);
        let mut disk = Disk::open(&path.0, &[0xb7; 32]).unwrap();
        assert!(disk.read().is_err());
    }
    #[test]
    fn valid_staged_intent_recovers_but_foreign_predecessor_never_overwrites_current() {
        let path = scratch();
        let value = checkpoint();
        stage(&path.0, None, &value, &KEY);
        let mut disk = Disk::open(&path.0, &KEY).unwrap();
        assert_eq!(disk.read().unwrap(), Some(value.clone()));
        assert!(!path.0.join(NEXT).exists());
        drop(disk);
        stage(&path.0, Some("11".repeat(32)), &value, &KEY);
        let before = diskfs::read(path.0.join(CURRENT)).unwrap();
        let mut disk = Disk::open(&path.0, &KEY).unwrap();
        assert!(disk.read().is_err());
        assert_eq!(diskfs::read(path.0.join(CURRENT)).unwrap(), before);
    }
    #[test]
    fn partial_stage_is_retained_and_path_replacement_or_hardlink_refuses() {
        let path = scratch();
        let mut disk = Disk::open(&path.0, &KEY).unwrap();
        disk.read().unwrap();
        disk.write(&checkpoint()).unwrap();
        drop(disk);
        let pending = path.0.join(NEXT);
        diskfs::write(&pending, b"{").unwrap();
        diskfs::set_permissions(&pending, diskfs::Permissions::from_mode(0o600)).unwrap();
        let mut disk = Disk::open(&path.0, &KEY).unwrap();
        assert!(disk.read().is_err());
        assert_eq!(diskfs::read(&pending).unwrap(), b"{");
        drop(disk);
        diskfs::remove_file(pending).unwrap();
        diskfs::hard_link(path.0.join(CURRENT), path.0.join("alias")).unwrap();
        let mut disk = Disk::open(&path.0, &KEY).unwrap();
        assert!(disk.read().is_err());
    }
    #[test]
    fn checkpoint_symlink_and_replaced_lock_are_rejected() {
        let path = scratch();
        let mut disk = Disk::open(&path.0, &KEY).unwrap();
        disk.read().unwrap();
        diskfs::rename(path.0.join(LOCK), path.0.join("old.lock")).unwrap();
        diskfs::write(path.0.join(LOCK), []).unwrap();
        diskfs::set_permissions(path.0.join(LOCK), diskfs::Permissions::from_mode(0o600)).unwrap();
        assert!(disk.revalidate().is_err());
        drop(disk);
        std::os::unix::fs::symlink("old.lock", path.0.join(CURRENT)).unwrap();
        let mut disk = Disk::open(&path.0, &KEY).unwrap();
        assert!(disk.read().is_err());
    }
    #[test]
    fn lost_exchange_reply_restarts_exact_flight_and_only_matching_receipt_settles() {
        let path = scratch();
        let mut value = checkpoint();
        let expected = super::super::encoded(value.flight.as_ref().unwrap()).unwrap();
        let mut disk = Disk::open(&path.0, &KEY).unwrap();
        disk.read().unwrap();
        disk.write(&value).unwrap();
        let before = diskfs::read(path.0.join(CURRENT)).unwrap();
        assert_eq!(
            super::super::exchange_retained(
                &mut value,
                &mut disk,
                |flight| {
                    assert_eq!(super::super::encoded(flight).unwrap(), expected);
                    Err("stats_sync_exchange_uncertain")
                },
                || Ok(1_800_000_000_000)
            ),
            Err("stats_sync_exchange_uncertain")
        );
        assert_eq!(diskfs::read(path.0.join(CURRENT)).unwrap(), before);
        drop(disk);
        let mut disk = Disk::open(&path.0, &KEY).unwrap();
        let mut resumed = disk.read().unwrap().unwrap();
        let receipt = super::super::exchange_retained(
            &mut resumed,
            &mut disk,
            |flight| {
                assert_eq!(super::super::encoded(flight).unwrap(), expected);
                Ok(super::super::Receipt {
                    schema_version: 2,
                    operation_id: flight.operation_id.clone(),
                    body_hash: super::super::body_hash(flight).unwrap(),
                    sequence: flight.sequence,
                    revision: flight.expected_revision + 1,
                    committed_at_ms: 1_800_000_000_000,
                    client: flight.report.sources[0].client.clone(),
                    first_utc_day: flight.report.first_utc_day,
                    day_count: flight.report.day_count,
                })
            },
            || Ok(1_800_000_000_000),
        )
        .unwrap();
        drop(disk);
        let mut disk = Disk::open(&path.0, &KEY).unwrap();
        let settled = disk.read().unwrap().unwrap();
        assert!(settled.flight.is_none());
        assert_eq!(settled.receipt, Some(receipt));
    }
    #[test]
    fn publication_rechecks_expected_authenticated_stage() {
        let path = scratch();
        let value = checkpoint();
        let disk = Disk::open(&path.0, &KEY).unwrap();
        stage(&path.0, None, &value, &KEY);
        let expected = disk.read_name(NEXT).unwrap().unwrap().mac;
        let mut replacement = value.clone();
        replacement.flight.as_mut().unwrap().operation_id = "88".repeat(32);
        stage(&path.0, None, &replacement, &KEY);
        assert_eq!(disk.publish(&expected, None), Err(INVALID));
        assert!(!path.0.join(CURRENT).exists());
        assert_eq!(disk.read_name(NEXT).unwrap().unwrap().payload, replacement);
    }
    #[test]
    fn abandonment_uncertainty_preserves_flight_and_valid_fence_preserves_published_progress() {
        let path = scratch();
        let mut value = checkpoint();
        let original = value.flight.as_ref().unwrap().clone();
        let receipt = super::super::Receipt {
            schema_version: 2,
            operation_id: original.operation_id.clone(),
            body_hash: super::super::body_hash(&original).unwrap(),
            sequence: 1,
            revision: 1,
            committed_at_ms: 1_800_000_000_000,
            client: original.report.sources[0].client.clone(),
            first_utc_day: original.report.first_utc_day,
            day_count: original.report.day_count,
        };
        value.last_sequence = 1;
        value.last_revision = 1;
        value.receipt = Some(receipt.clone());
        let flight = value.flight.as_mut().unwrap();
        flight.sequence = 2;
        flight.expected_revision = 1;
        flight.operation_id = "88".repeat(32);
        let mut disk = Disk::open(&path.0, &KEY).unwrap();
        disk.read().unwrap();
        disk.write(&value).unwrap();
        let before = diskfs::read(path.0.join(CURRENT)).unwrap();
        assert_eq!(
            super::super::abandon_retained(
                &mut value,
                &mut disk,
                |_| Err("stats_sync_exchange_uncertain"),
                || Ok(1_800_000_000_000)
            ),
            Err("stats_sync_exchange_uncertain")
        );
        assert_eq!(diskfs::read(path.0.join(CURRENT)).unwrap(), before);
        assert_eq!(
            super::super::abandon_retained(
                &mut value,
                &mut disk,
                |flight| Ok(super::super::Abandonment::Abandoned {
                    schema_version: 2,
                    operation_id: flight.operation_id.clone(),
                    body_hash: "00".repeat(32),
                    sequence: flight.sequence,
                    expected_revision: flight.expected_revision,
                    fenced_at_revision: 2,
                }),
                || Ok(1_800_000_000_000)
            ),
            Err("stats_sync_invalid_abandonment_proof")
        );
        assert_eq!(diskfs::read(path.0.join(CURRENT)).unwrap(), before);
        super::super::abandon_retained(
            &mut value,
            &mut disk,
            |flight| {
                Ok(super::super::Abandonment::Abandoned {
                    schema_version: 2,
                    operation_id: flight.operation_id.clone(),
                    body_hash: super::super::body_hash(flight).unwrap(),
                    sequence: flight.sequence,
                    expected_revision: flight.expected_revision,
                    fenced_at_revision: 2,
                })
            },
            || Ok(1_800_000_000_000),
        )
        .unwrap();
        drop(disk);
        let mut disk = Disk::open(&path.0, &KEY).unwrap();
        let recovered = disk.read().unwrap().unwrap();
        assert!(recovered.flight.is_none());
        assert_eq!(recovered.last_sequence, 1);
        assert_eq!(recovered.last_revision, 1);
        assert_eq!(recovered.receipt, Some(receipt));
    }
    #[test]
    fn abandonment_of_an_already_committed_flight_settles_its_receipt() {
        let path = scratch();
        let mut value = checkpoint();
        let mut disk = Disk::open(&path.0, &KEY).unwrap();
        disk.read().unwrap();
        disk.write(&value).unwrap();
        let result = super::super::abandon_retained(
            &mut value,
            &mut disk,
            |flight| {
                Ok(super::super::Abandonment::Committed {
                    schema_version: 2,
                    receipt: super::super::Receipt {
                        schema_version: 2,
                        operation_id: flight.operation_id.clone(),
                        body_hash: super::super::body_hash(flight).unwrap(),
                        sequence: flight.sequence,
                        revision: flight.expected_revision + 1,
                        committed_at_ms: 1_800_000_000_000,
                        client: flight.report.sources[0].client.clone(),
                        first_utc_day: flight.report.first_utc_day,
                        day_count: flight.report.day_count,
                    },
                })
            },
            || Ok(1_800_000_000_000),
        )
        .unwrap();
        assert!(value.flight.is_none());
        assert_eq!(value.last_sequence, 1);
        assert_eq!(value.receipt, result);
    }
}
