//! Descriptor-bound copy-on-write capture. The private destination is never a
//! source cache. Unsupported filesystems use the caller's bounded copy path.
use std::{fs::File, io, path::Path};

#[cfg(target_os = "macos")]
pub(super) fn capture(
    source: &File,
    directory: &Path,
) -> io::Result<Option<tempfile::NamedTempFile>> {
    use std::{
        ffi::CString,
        fs,
        os::{
            fd::AsRawFd,
            unix::{
                ffi::OsStrExt,
                fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
            },
        },
    };
    let dir = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(directory)?;
    let info = dir.metadata()?;
    // SAFETY: geteuid has no pointer arguments and does not mutate process state.
    if !info.is_dir() || info.uid() != unsafe { libc::geteuid() } || info.mode() & 0o777 != 0o700 {
        return Err(io::Error::other("import_snapshot_unavailable"));
    }
    let reservation = tempfile::NamedTempFile::new_in(directory)?;
    let path = reservation.into_temp_path();
    let name = CString::new(
        path.file_name()
            .ok_or_else(|| io::Error::other("import_snapshot_unavailable"))?
            .as_bytes(),
    )
    .map_err(|_| io::Error::other("import_snapshot_unavailable"))?;
    fs::remove_file(&path)?;
    // SAFETY: both descriptors remain owned/live, the destination is one NUL-
    // terminated filename beneath the private directory, and flags are defined
    // by Darwin. fclonefileat refuses an existing destination and never writes
    // the source. Later source writes cannot change the captured data blocks.
    let result = unsafe {
        libc::fclonefileat(
            source.as_raw_fd(),
            dir.as_raw_fd(),
            name.as_ptr(),
            0x0001 | 0x0002, // CLONE_NOFOLLOW | CLONE_NOOWNERCOPY, sys/clonefile.h,
        )
    };
    if result != 0 {
        let failure = io::Error::last_os_error();
        return if matches!(
            failure.raw_os_error(),
            Some(libc::ENOTSUP | libc::EXDEV | libc::ENOSYS)
        ) {
            Ok(None)
        } else {
            Err(failure)
        };
    }
    // Clones inherit the source mode. A readable archive may be 0400/0444,
    // so first open read-only and change only this verified destination inode.
    let readonly = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(&path)?;
    let info = readonly.metadata()?;
    let named = fs::symlink_metadata(&path)?;
    if !info.is_file()
        || info.nlink() != 1
        || info.uid() != dir.metadata()?.uid()
        || (info.dev(), info.ino()) != (named.dev(), named.ino())
        || named.file_type().is_symlink()
    {
        return Err(io::Error::other("import_snapshot_unavailable"));
    }
    readonly.set_permissions(fs::Permissions::from_mode(0o600))?;
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(&path)?;
    let writable = file.metadata()?;
    let named = fs::symlink_metadata(&path)?;
    if !writable.is_file()
        || writable.nlink() != 1
        || writable.uid() != info.uid()
        || writable.mode() & 0o777 != 0o600
        || (writable.dev(), writable.ino()) != (info.dev(), info.ino())
        || (writable.dev(), writable.ino()) != (named.dev(), named.ino())
        || named.file_type().is_symlink()
    {
        return Err(io::Error::other("import_snapshot_unavailable"));
    }
    Ok(Some(tempfile::NamedTempFile::from_parts(file, path)))
}

#[cfg(not(target_os = "macos"))]
pub(super) fn capture(
    _source: &File,
    _directory: &Path,
) -> io::Result<Option<tempfile::NamedTempFile>> {
    Ok(None)
}
