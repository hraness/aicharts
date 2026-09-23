//! Narrow, read-only macOS process identity and argument snapshots.
//! The caller must validate the executable's ownership/path before using any
//! argument as authority. Errors never contain process arguments or paths.
#![deny(unsafe_op_in_unsafe_fn)]
#[cfg(unix)]
pub mod groups;
#[cfg(unix)]
pub mod signals;
use std::path::PathBuf;
pub type Result<T> = std::result::Result<T, &'static str>;
const INVALID: &str = "platform_process_unavailable";
#[derive(PartialEq, Eq)]
pub struct Snapshot {
    pub pid: u32,
    pub uid: u32,
    pub started: (u64, u64),
    pub executable: PathBuf,
    pub arguments: Vec<String>,
}
#[cfg(target_os = "macos")]
mod native {
    use super::*;
    fn info(pid: u32) -> Result<libc::proc_bsdinfo> {
        let pid = i32::try_from(pid)
            .ok()
            .filter(|pid| *pid > 1)
            .ok_or(INVALID)?;
        let mut value = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
        let size = std::mem::size_of::<libc::proc_bsdinfo>();
        // SAFETY: the output buffer has exactly the documented proc_bsdinfo layout,
        // remains live for the call, and is read only after its complete byte count.
        let bytes = unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                value.as_mut_ptr().cast(),
                size as i32,
            )
        };
        if bytes != size as i32 {
            return Err(INVALID);
        }
        // SAFETY: a successful exact-sized proc_pidinfo initialized every field.
        let value = unsafe { value.assume_init() };
        // SAFETY: getuid/geteuid take no pointers and have no side effects.
        let (uid, real) = unsafe { (libc::geteuid(), libc::getuid()) };
        if uid != real
            || value.pbi_pid != pid as u32
            || value.pbi_uid != uid
            || value.pbi_ruid != uid
        {
            return Err(INVALID);
        }
        Ok(value)
    }
    fn path(pid: u32) -> Result<PathBuf> {
        let mut bytes = [0u8; 4096];
        // SAFETY: the initialized buffer is writable for its full supplied length.
        let len = unsafe {
            libc::proc_pidpath(pid as i32, bytes.as_mut_ptr().cast(), bytes.len() as u32)
        };
        if len <= 0 || len as usize >= bytes.len() {
            return Err(INVALID);
        }
        let end = bytes.iter().position(|b| *b == 0).ok_or(INVALID)?;
        let path = PathBuf::from(std::str::from_utf8(&bytes[..end]).map_err(|_| INVALID)?);
        if !path.is_absolute() {
            return Err(INVALID);
        }
        Ok(path)
    }
    fn arguments(pid: u32) -> Result<Vec<String>> {
        let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid as i32];
        let mut bytes = vec![0u8; 256 * 1024];
        let mut length = bytes.len();
        // SAFETY: the MIB and output/length buffers are initialized and live. No new
        // value is provided, so this is a bounded read-only sysctl query.
        let result = unsafe {
            libc::sysctl(
                mib.as_mut_ptr(),
                mib.len() as u32,
                bytes.as_mut_ptr().cast(),
                &mut length,
                std::ptr::null_mut(),
                0,
            )
        };
        if result != 0 || length > bytes.len() {
            return Err(INVALID);
        }
        decode_arguments(&bytes[..length])
    }
    pub(super) fn snapshot(pid: u32) -> Result<Snapshot> {
        let before = info(pid)?;
        let executable = path(pid)?;
        let arguments = arguments(pid)?;
        let after = info(pid)?;
        if (before.pbi_start_tvsec, before.pbi_start_tvusec)
            != (after.pbi_start_tvsec, after.pbi_start_tvusec)
            || path(pid)? != executable
        {
            return Err(INVALID);
        }
        Ok(Snapshot {
            pid,
            uid: before.pbi_uid,
            started: (before.pbi_start_tvsec, before.pbi_start_tvusec),
            executable,
            arguments,
        })
    }
    pub(super) fn pids() -> Result<Vec<u32>> {
        let mut pids = vec![0i32; 16_384];
        let capacity = pids.len() * std::mem::size_of::<i32>();
        // SAFETY: buffer is initialized, aligned for pid_t, and valid for capacity.
        let count = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), capacity as i32) };
        if count <= 0 || count as usize >= pids.len() {
            return Err(INVALID);
        }
        pids.truncate(count as usize);
        Ok(pids
            .into_iter()
            .filter_map(|pid| u32::try_from(pid).ok().filter(|pid| *pid > 1))
            .collect())
    }
    pub(super) fn identity(pid: u32) -> Result<(u32, PathBuf)> {
        let value = info(pid)?;
        Ok((value.pbi_uid, path(pid)?))
    }
}
/// Enumerate at most 16,383 kernel process identifiers without reading argv.
pub fn pids() -> Result<Vec<u32>> {
    #[cfg(target_os = "macos")]
    {
        native::pids()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(INVALID)
    }
}
/// Read an owned process's kernel executable path without reading argv. Use this
/// to filter for the explicitly authorized application before calling snapshot.
pub fn identity(pid: u32) -> Result<(u32, PathBuf)> {
    #[cfg(target_os = "macos")]
    {
        native::identity(pid)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = pid;
        Err(INVALID)
    }
}
/// Read a same-user process, bounded to 256KiB and 4096 arguments. Environment
/// entries after argc are excluded. PID start time and executable are rechecked.
pub fn snapshot(pid: u32) -> Result<Snapshot> {
    #[cfg(target_os = "macos")]
    {
        native::snapshot(pid)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = pid;
        Err(INVALID)
    }
}
#[cfg(any(target_os = "macos", test))]
fn decode_arguments(bytes: &[u8]) -> Result<Vec<String>> {
    let argc = i32::from_ne_bytes(
        bytes
            .get(..4)
            .ok_or(INVALID)?
            .try_into()
            .map_err(|_| INVALID)?,
    );
    if !(1..=4096).contains(&argc) || bytes.len() > 256 * 1024 {
        return Err(INVALID);
    }
    let mut cursor = 4;
    while bytes.get(cursor).is_some_and(|b| *b != 0) {
        cursor += 1
    }
    while bytes.get(cursor) == Some(&0) {
        cursor += 1
    }
    let mut arguments = Vec::new();
    for _ in 0..argc {
        let rest = bytes.get(cursor..).ok_or(INVALID)?;
        let end = rest.iter().position(|b| *b == 0).ok_or(INVALID)?;
        arguments.push(
            std::str::from_utf8(&rest[..end])
                .map_err(|_| INVALID)?
                .to_owned(),
        );
        cursor += end + 1
    }
    Ok(arguments)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn argv_decode_stops_before_environment() {
        let mut bytes = 2i32.to_ne_bytes().to_vec();
        bytes.extend_from_slice(b"/binary\0\0/binary\0--csrf_token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\0PRIVATE_ENV=not-an-argument\0");
        let args = decode_arguments(&bytes).unwrap();
        assert_eq!(args.len(), 2);
        assert!(!args.iter().any(|arg| arg.contains("PRIVATE_ENV")));
    }
    #[test]
    fn malformed_oversized_and_unterminated_arguments_refuse() {
        for bytes in [
            vec![],
            0i32.to_ne_bytes().to_vec(),
            4097i32.to_ne_bytes().to_vec(),
            vec![0; 256 * 1024 + 1],
        ] {
            assert!(decode_arguments(&bytes).is_err())
        }
        let mut bytes = 2i32.to_ne_bytes().to_vec();
        bytes.extend_from_slice(b"/binary\0\0/binary\0unfinished");
        assert!(decode_arguments(&bytes).is_err());
    }
    #[test]
    fn empty_argument_is_preserved_after_first_arg() {
        let mut bytes = 3i32.to_ne_bytes().to_vec();
        bytes.extend_from_slice(b"/binary\0\0/binary\0\0last\0ENV=excluded\0");
        assert_eq!(decode_arguments(&bytes).unwrap(), ["/binary", "", "last"]);
    }
}
