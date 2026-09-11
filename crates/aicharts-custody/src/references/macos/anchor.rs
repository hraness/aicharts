//! Explicit existing paths only. Every descriptor and parent/name edge remains
//! pinned; a home-directory string is never authority or a recovery fallback.
use super::*;
use aicharts_platform_acl::require_deny_only_acl;
use std::{
    ffi::OsString,
    os::unix::ffi::{OsStrExt, OsStringExt},
    path::Path,
};

const MAX_PATH: usize = 1023;
const MAX_COMPONENTS: usize = 64;

struct Node {
    fd: OwnedFd,
    identity: Identity,
    name: OsString,
}

pub(super) struct TrustedAnchor {
    root: OwnedFd,
    root_identity: Identity,
    nodes: Vec<Node>,
    uid: u32,
}

fn components(path: &Path) -> Result<Vec<OsString>> {
    let bytes = path.as_os_str().as_bytes();
    if bytes.len() < 2 || bytes.len() > MAX_PATH || bytes[0] != b'/' || bytes.contains(&0) {
        return Err(Error::RecoveryRequired);
    }
    let mut result = Vec::new();
    for component in bytes[1..].split(|byte| *byte == b'/') {
        if component.is_empty()
            || component.len() > 255
            || component == b"."
            || component == b".."
            || result.len() == MAX_COMPONENTS
        {
            return Err(Error::RecoveryRequired);
        }
        result.push(OsString::from_vec(component.to_vec()));
    }
    Ok(result)
}

fn ancestor_role(stat: &Stat, uid: u32) -> Result<()> {
    if FileType::from_raw_mode(stat.st_mode) != FileType::Directory
        || (stat.st_uid != 0 && stat.st_uid != uid)
        || stat.st_mode & 0o022 != 0
        || stat.st_nlink == 0
    {
        return Err(Error::RecoveryRequired);
    }
    Ok(())
}

fn checked_ancestor(fd: &OwnedFd, uid: u32) -> Result<Stat> {
    let before = fs::fstat(fd).map_err(unavailable)?;
    ancestor_role(&before, uid)?;
    require_deny_only_acl(fd.as_fd()).map_err(|_| Error::RecoveryRequired)?;
    let filesystem = fs::fstatfs(fd).map_err(unavailable)?;
    let name: Vec<u8> = filesystem
        .f_fstypename
        .iter()
        .map(|value| *value as u8)
        .collect();
    let end = name
        .iter()
        .position(|value| *value == 0)
        .ok_or(Error::RecoveryRequired)?;
    // Root's system volume can be read-only. The actual write anchor is checked
    // separately by the stricter writable same-device storage contract.
    if filesystem.f_flags & MNT_LOCAL == 0
        || filesystem.f_flags & MNT_IGNORE_OWNERSHIP != 0
        || &name[..=end] != b"apfs\0"
    {
        return Err(Error::RecoveryRequired);
    }
    let after = fs::fstat(fd).map_err(unavailable)?;
    ancestor_role(&after, uid)?;
    if !same_observation(&before, &after) {
        return Err(Error::RecoveryRequired);
    }
    Ok(after)
}

impl TrustedAnchor {
    pub(super) fn open_existing(path: &Path) -> Result<Self> {
        let names = components(path)?;
        let uid = rustix::process::geteuid().as_raw();
        if rustix::process::getuid().as_raw() != uid {
            return Err(Error::RecoveryRequired);
        }
        let root = fs::open(
            "/",
            flags() | OFlags::RDONLY | OFlags::DIRECTORY,
            Mode::empty(),
        )
        .map_err(unavailable)?;
        Self::walk(root, names, uid)
    }

    fn walk(root: OwnedFd, names: Vec<OsString>, uid: u32) -> Result<Self> {
        let root_stat = checked_ancestor(&root, uid)?;
        let mut value = Self {
            root,
            root_identity: Identity::of(&root_stat),
            nodes: Vec::new(),
            uid,
        };
        let count = names.len();
        for (index, name) in names.into_iter().enumerate() {
            value.revalidate_chain(false)?;
            let parent = value.nodes.last().map_or(&value.root, |node| &node.fd);
            let before = fs::statat(parent, &name, AtFlags::SYMLINK_NOFOLLOW).map_err(|error| {
                if error == Errno::NOENT {
                    Error::Missing
                } else {
                    unavailable(error)
                }
            })?;
            ancestor_role(&before, uid)?;
            let fd = fs::openat(
                parent,
                &name,
                flags() | OFlags::RDONLY | OFlags::DIRECTORY,
                Mode::empty(),
            )
            .map_err(unavailable)?;
            let after = if index + 1 == count {
                checked_fd(&fd, uid, true)?
            } else {
                checked_ancestor(&fd, uid)?
            };
            if !same_observation(&before, &after) {
                return Err(Error::RecoveryRequired);
            }
            let named =
                fs::statat(parent, &name, AtFlags::SYMLINK_NOFOLLOW).map_err(unavailable)?;
            if !same_observation(&after, &named) {
                return Err(Error::RecoveryRequired);
            }
            value.nodes.push(Node {
                fd,
                identity: Identity::of(&after),
                name,
            });
        }
        value.revalidate()?;
        Ok(value)
    }

    pub(super) fn descriptor(&self) -> Result<OwnedFd> {
        self.revalidate()?;
        self.nodes
            .last()
            .ok_or(Error::RecoveryRequired)?
            .fd
            .try_clone()
            .map_err(|_| Error::StorageUnavailable)
    }

    pub(super) fn revalidate(&self) -> Result<()> {
        self.revalidate_chain(true)
    }

    fn revalidate_chain(&self, final_anchor: bool) -> Result<()> {
        if rustix::process::getuid().as_raw() != self.uid
            || rustix::process::geteuid().as_raw() != self.uid
        {
            return Err(Error::RecoveryRequired);
        }
        let root = checked_ancestor(&self.root, self.uid)?;
        if Identity::of(&root) != self.root_identity {
            return Err(Error::RecoveryRequired);
        }
        let mut parent = &self.root;
        for (index, node) in self.nodes.iter().enumerate() {
            let observed = if final_anchor && index + 1 == self.nodes.len() {
                checked_fd(&node.fd, self.uid, true)?
            } else {
                checked_ancestor(&node.fd, self.uid)?
            };
            let named =
                fs::statat(parent, &node.name, AtFlags::SYMLINK_NOFOLLOW).map_err(unavailable)?;
            if Identity::of(&observed) != node.identity || !same_observation(&observed, &named) {
                return Err(Error::RecoveryRequired);
            }
            parent = &node.fd;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;
