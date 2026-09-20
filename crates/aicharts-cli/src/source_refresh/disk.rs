//! Small descriptor-bound private cache. All mutations use the opened directory
//! and one stable advisory lock; credentials are read only from explicit paths.
use super::Result;
const CREDENTIAL: &str = "source_refresh_credential_invalid";
#[cfg(target_os = "macos")]
use rustix::fd::AsFd;
use rustix::{
    fd::OwnedFd,
    fs::{self, AtFlags, FileType, FlockOperation, Mode, OFlags, Stat},
    io::Errno,
};
use sha2::{Digest, Sha256};
use std::{cell::RefCell, collections::BTreeMap};
use std::{
    ffi::OsString,
    fs::File,
    io::{Read, Write},
    os::unix::{
        ffi::OsStrExt,
        fs::{MetadataExt, OpenOptionsExt},
    },
    path::{Component, Path},
    time::{Duration, Instant},
};
const INVALID: &str = "source_refresh_cache_invalid";
const IO: &str = "source_refresh_cache_unavailable";
fn flags() -> OFlags {
    OFlags::CLOEXEC | OFlags::NOFOLLOW | OFlags::NONBLOCK
}
#[allow(clippy::unnecessary_cast)]
fn identity(stat: &Stat) -> (u64, u64) {
    (stat.st_dev as u64, stat.st_ino)
}
fn checked(fd: &OwnedFd, directory: bool, private: bool) -> Result<Stat> {
    let stat = fs::fstat(fd).map_err(|_| IO)?;
    let uid = rustix::process::geteuid().as_raw();
    let kind = if directory {
        FileType::Directory
    } else {
        FileType::RegularFile
    };
    if FileType::from_raw_mode(stat.st_mode) != kind
        || (!directory && stat.st_nlink != 1)
        || stat.st_size < 0
        || (private
            && (stat.st_uid != uid
                || stat.st_mode & 0o7777 != if directory { 0o700 } else { 0o600 }))
    {
        return Err(INVALID);
    }
    #[cfg(target_os = "macos")]
    if private {
        aicharts_platform_acl::require_no_acl(fd.as_fd()).map_err(|_| INVALID)?;
    }
    Ok(stat)
}
struct Edge {
    fd: OwnedFd,
    name: OsString,
    id: (u64, u64),
}
pub(crate) struct Cache {
    root: OwnedFd,
    edges: Vec<Edge>,
    lock: OwnedFd,
    lock_id: (u64, u64),
    uid: u32,
    observed: RefCell<BTreeMap<String, Option<Vec<u8>>>>,
}
impl Cache {
    pub(crate) fn open(path: &Path) -> Result<Self> {
        let names = components(path)?;
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
        let mut edges: Vec<Edge> = Vec::new();
        for (index, name) in names.iter().enumerate() {
            let parent = edges.last().map_or(&root, |edge| &edge.fd);
            let fd = match fs::openat(
                parent,
                name,
                flags() | OFlags::RDONLY | OFlags::DIRECTORY,
                Mode::empty(),
            ) {
                Ok(fd) => fd,
                Err(Errno::NOENT) if index + 1 == names.len() => {
                    fs::mkdirat(parent, name, Mode::from_raw_mode(0o700)).map_err(|_| IO)?;
                    fs::openat(
                        parent,
                        name,
                        flags() | OFlags::RDONLY | OFlags::DIRECTORY,
                        Mode::empty(),
                    )
                    .map_err(|_| IO)?
                }
                Err(_) => return Err(IO),
            };
            let stat = checked(&fd, true, index + 1 == names.len())?;
            if identity(&stat)
                != identity(&fs::statat(parent, name, AtFlags::SYMLINK_NOFOLLOW).map_err(|_| IO)?)
            {
                return Err(INVALID);
            }
            edges.push(Edge {
                fd,
                name: name.clone(),
                id: identity(&stat),
            });
        }
        let directory = &edges.last().ok_or(INVALID)?.fd;
        let lock = fs::openat(
            directory,
            "refresh.lock",
            flags() | OFlags::RDWR | OFlags::CREATE,
            Mode::from_raw_mode(0o600),
        )
        .map_err(|_| IO)?;
        let stat = checked(&lock, false, true)?;
        if stat.st_size != 0 {
            return Err(INVALID);
        }
        fs::flock(&lock, FlockOperation::NonBlockingLockExclusive)
            .map_err(|_| "source_refresh_busy")?;
        let cache = Self {
            root,
            edges,
            lock,
            lock_id: identity(&stat),
            uid,
            observed: RefCell::new(BTreeMap::new()),
        };
        cache.validate()?;
        Ok(cache)
    }
    fn directory(&self) -> &OwnedFd {
        &self.edges.last().expect("checked directory").fd
    }
    fn validate(&self) -> Result<()> {
        if self.uid != rustix::process::geteuid().as_raw()
            || self.uid != rustix::process::getuid().as_raw()
        {
            return Err(INVALID);
        }
        let mut parent = &self.root;
        for (index, edge) in self.edges.iter().enumerate() {
            if identity(&checked(&edge.fd, true, index + 1 == self.edges.len())?) != edge.id
                || identity(
                    &fs::statat(parent, &edge.name, AtFlags::SYMLINK_NOFOLLOW).map_err(|_| IO)?,
                ) != edge.id
            {
                return Err(INVALID);
            }
            parent = &edge.fd;
        }
        if identity(&checked(&self.lock, false, true)?) != self.lock_id
            || identity(
                &fs::statat(self.directory(), "refresh.lock", AtFlags::SYMLINK_NOFOLLOW)
                    .map_err(|_| IO)?,
            ) != self.lock_id
        {
            return Err(INVALID);
        }
        Ok(())
    }
    pub(crate) fn read(&self, name: &str, cap: usize) -> Result<Option<Vec<u8>>> {
        if name.is_empty()
            || name.len() > 160
            || name == "."
            || name == ".."
            || name
                .bytes()
                .any(|byte| !(byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_')))
            || cap > super::MAX_BYTES
        {
            return Err(INVALID);
        }
        self.validate()?;
        let fd = match fs::openat(
            self.directory(),
            name,
            flags() | OFlags::RDONLY,
            Mode::empty(),
        ) {
            Ok(fd) => fd,
            Err(Errno::NOENT) => {
                self.observed
                    .borrow_mut()
                    .entry(name.to_owned())
                    .or_insert(None);
                return Ok(None);
            }
            Err(_) => return Err(IO),
        };
        let before = checked(&fd, false, true)?;
        if before.st_size == 0 || before.st_size as usize > cap {
            return Err(INVALID);
        }
        let mut file = File::from(fd);
        let mut bytes = Vec::new();
        (&mut file)
            .take(cap as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| IO)?;
        let fd: OwnedFd = file.into();
        let after = checked(&fd, false, true)?;
        if bytes.len() != before.st_size as usize
            || before.st_size != after.st_size
            || before.st_mtime != after.st_mtime
            || before.st_mtime_nsec != after.st_mtime_nsec
            || before.st_ctime != after.st_ctime
            || before.st_ctime_nsec != after.st_ctime_nsec
            || identity(&after)
                != identity(
                    &fs::statat(self.directory(), name, AtFlags::SYMLINK_NOFOLLOW)
                        .map_err(|_| IO)?,
                )
        {
            return Err(INVALID);
        }
        self.validate()?;
        self.observed
            .borrow_mut()
            .entry(name.to_owned())
            .or_insert_with(|| Some(Sha256::digest(&bytes).to_vec()));
        Ok(Some(bytes))
    }
    pub(crate) fn require_entries(&self, allowed: &[&str]) -> Result<()> {
        self.validate()?;
        let entries = fs::Dir::read_from(self.directory()).map_err(|_| IO)?;
        for (index, entry) in entries.enumerate() {
            if index > 1024 {
                return Err(INVALID);
            }
            let entry = entry.map_err(|_| IO)?;
            let name = entry.file_name().to_bytes();
            if name == b"." || name == b".." {
                continue;
            }
            // A retained crash-stage file is safe but never interpreted as data.
            if name.starts_with(b".refresh-") && name.ends_with(b".pending") {
                continue;
            }
            if !allowed.iter().any(|allowed| allowed.as_bytes() == name) {
                return Err("source_refresh_cache_scope_mismatch");
            }
        }
        self.validate()
    }
    pub(crate) fn create_binding(&self, bytes: &[u8]) -> Result<()> {
        self.validate()?;
        if self.read("profile.json", 4096)?.is_some() {
            return Err(INVALID);
        }
        self.replace("profile.json", bytes)
    }
    pub(crate) fn replace(&self, name: &str, bytes: &[u8]) -> Result<()> {
        if bytes.is_empty() || bytes.len() > super::MAX_BYTES {
            return Err(INVALID);
        }
        self.validate()?;
        // Refuse pre-existing symlinks/foreign files, even though rename would
        // replace the link itself, so cache corruption is never silently repaired.
        let current = self.read(name, super::MAX_BYTES)?;
        let hash = current.as_ref().map(|bytes| Sha256::digest(bytes).to_vec());
        if self.observed.borrow().get(name) != Some(&hash) {
            return Err("source_refresh_cache_changed");
        }
        let mut nonce = [0u8; 16];
        getrandom::fill(&mut nonce).map_err(|_| IO)?;
        let pending = format!(".refresh-{}.pending", super::hex(&nonce));
        let fd = fs::openat(
            self.directory(),
            &pending,
            flags() | OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL,
            Mode::from_raw_mode(0o600),
        )
        .map_err(|_| IO)?;
        checked(&fd, false, true)?;
        let operation = || -> Result<()> {
            let mut file = File::from(fd);
            file.write_all(bytes).map_err(|_| IO)?;
            file.sync_all().map_err(|_| IO)?;
            self.validate()?;
            // One rename publishes the complete usage snapshot. No partially
            // written `usage.*` file can be discovered by the importer.
            fs::renameat(self.directory(), &pending, self.directory(), name).map_err(|_| IO)?;
            fs::fsync(self.directory()).map_err(|_| IO)?;
            self.validate()?;
            self.observed
                .borrow_mut()
                .insert(name.to_owned(), Some(Sha256::digest(bytes).to_vec()));
            if self.read(name, super::MAX_BYTES)?.as_deref() != Some(bytes) {
                return Err(INVALID);
            }
            Ok(())
        };
        let result = operation();
        // Only the unique file created by this invocation may be removed.
        let _ = fs::unlinkat(self.directory(), &pending, AtFlags::empty());
        result
    }
}
fn components(path: &Path) -> Result<Vec<OsString>> {
    let bytes = path.as_os_str().as_bytes();
    if !path.is_absolute() || bytes.len() > 4096 || bytes.contains(&0) {
        return Err(INVALID);
    }
    let names: Vec<_> = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(name) => Some(Ok(name.to_owned())),
            Component::RootDir => None,
            _ => Some(Err(INVALID)),
        })
        .collect::<Result<_>>()?;
    if names.is_empty() || names.len() > 64 {
        return Err(INVALID);
    }
    Ok(names)
}
fn credential_file(path: &Path, private: bool, cap: u64) -> Result<File> {
    let names = components(path).map_err(|_| CREDENTIAL)?;
    let mut current = Path::new("/").to_path_buf();
    for name in names {
        current.push(name);
        if std::fs::symlink_metadata(&current)
            .map_err(|_| CREDENTIAL)?
            .file_type()
            .is_symlink()
        {
            return Err(CREDENTIAL);
        }
    }
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| CREDENTIAL)?;
    let before = file.metadata().map_err(|_| CREDENTIAL)?;
    let named = std::fs::symlink_metadata(path).map_err(|_| CREDENTIAL)?;
    if !before.is_file()
        || before.nlink() != 1
        || before.len() == 0
        || before.len() > cap
        || before.uid() != rustix::process::geteuid().as_raw()
        || (before.dev(), before.ino()) != (named.dev(), named.ino())
        || before.mode() & 0o022 != 0
        || (private && before.mode() & 0o7777 != 0o600)
    {
        return Err(CREDENTIAL);
    }
    #[cfg(target_os = "macos")]
    if private {
        aicharts_platform_acl::require_no_acl(file.as_fd()).map_err(|_| CREDENTIAL)?;
    }
    Ok(file)
}
pub(crate) fn read_secret(path: &Path) -> Result<String> {
    let mut file = credential_file(path, true, 16 * 1024)?;
    let before = file.metadata().map_err(|_| CREDENTIAL)?;
    let mut bytes = Vec::new();
    (&mut file)
        .take(16 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| CREDENTIAL)?;
    let after = file.metadata().map_err(|_| CREDENTIAL)?;
    if bytes.len() != before.len() as usize
        || before.len() != after.len()
        || before.mtime() != after.mtime()
        || before.mtime_nsec() != after.mtime_nsec()
        || before.ctime() != after.ctime()
        || before.ctime_nsec() != after.ctime_nsec()
    {
        return Err(CREDENTIAL);
    }
    String::from_utf8(bytes).map_err(|_| CREDENTIAL)
}
pub(crate) fn read_desktop_token(path: &Path) -> Result<String> {
    let pinned = credential_file(path, false, 64 * 1024 * 1024 * 1024)?;
    let before = pinned.metadata().map_err(|_| CREDENTIAL)?;
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut name = path.as_os_str().to_os_string();
        name.push(suffix);
        let sidecar = std::path::PathBuf::from(name);
        if sidecar.exists() {
            let _ = credential_file(&sidecar, false, 64 * 1024 * 1024 * 1024)?;
        }
    }
    let connection = rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| CREDENTIAL)?;
    connection
        .busy_timeout(Duration::from_millis(100))
        .map_err(|_| CREDENTIAL)?;
    connection
        .set_limit(rusqlite::limits::Limit::SQLITE_LIMIT_LENGTH, 16 * 1024)
        .map_err(|_| CREDENTIAL)?;
    connection
        .pragma_update(None, "query_only", true)
        .map_err(|_| CREDENTIAL)?;
    let started = Instant::now();
    connection
        .progress_handler(
            1000,
            Some(move || started.elapsed() > Duration::from_secs(2)),
        )
        .map_err(|_| CREDENTIAL)?;
    let mut statement = connection
        .prepare("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken' LIMIT 2")
        .map_err(|_| CREDENTIAL)?;
    let mut rows = statement.query([]).map_err(|_| CREDENTIAL)?;
    let token = {
        let row = rows.next().map_err(|_| CREDENTIAL)?.ok_or(CREDENTIAL)?;
        let value = row
            .get_ref(0)
            .map_err(|_| CREDENTIAL)?
            .as_str()
            .map_err(|_| CREDENTIAL)?;
        if value.is_empty() || value.len() > 16 * 1024 {
            return Err(CREDENTIAL);
        }
        value.to_owned()
    };
    if rows.next().map_err(|_| CREDENTIAL)?.is_some() {
        return Err(CREDENTIAL);
    }
    let after = std::fs::symlink_metadata(path).map_err(|_| CREDENTIAL)?;
    if after.file_type().is_symlink() || (before.dev(), before.ino()) != (after.dev(), after.ino())
    {
        return Err(CREDENTIAL);
    }
    Ok(token)
}
