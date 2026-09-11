//! Descriptor-only macOS ACL inspection with a closed, nonsecret result.
//!
//! This checks for ACL entries, not ownership, mode, filesystem suitability,
//! pathname stability, or protection against the file owner changing its ACL.
#![deny(unsafe_code)]

#[cfg(target_os = "macos")]
mod macos;

/// Fixed failures contain no descriptor, path, principal, or native error text.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AclError {
    AclPresent,
    Unavailable,
    Unsupported,
}

impl AclError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::AclPresent => "acl_present",
            Self::Unavailable => "acl_unavailable",
            Self::Unsupported => "acl_unsupported",
        }
    }
}

impl std::fmt::Display for AclError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for AclError {}

/// Require an absent or empty macOS extended ACL on this already-open object.
///
/// The descriptor remains borrowed and open. No pathname is resolved, no ACL
/// is changed, and no principal is looked up. Other Unix targets fail closed.
#[cfg(unix)]
pub fn require_no_acl(fd: std::os::fd::BorrowedFd<'_>) -> Result<(), AclError> {
    #[cfg(target_os = "macos")]
    {
        macos::require_no_acl(fd)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = fd;
        Err(AclError::Unsupported)
    }
}

/// Require an absent, empty, or exclusively DENY macOS ACL for traversal.
///
/// This is not the private-storage policy: final private directories and files
/// must still use `require_no_acl`. No principal or effective-access inference
/// is made; even an allow entry for the current owner is rejected.
#[cfg(unix)]
pub fn require_deny_only_acl(fd: std::os::fd::BorrowedFd<'_>) -> Result<(), AclError> {
    #[cfg(target_os = "macos")]
    {
        macos::require_deny_only_acl(fd)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = fd;
        Err(AclError::Unsupported)
    }
}

#[cfg(any(target_os = "macos", test))]
fn decode_status(status: std::ffi::c_int) -> Result<(), AclError> {
    match status {
        0 => Ok(()),
        1 => Err(AclError::AclPresent),
        3 => Err(AclError::Unsupported),
        _ => Err(AclError::Unavailable),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_mapping_is_closed_for_every_sampled_integer() {
        for status in (-4096..=4096).chain([i32::MIN, i32::MAX]) {
            let expected = match status {
                0 => Ok(()),
                1 => Err(AclError::AclPresent),
                3 => Err(AclError::Unsupported),
                _ => Err(AclError::Unavailable),
            };
            assert_eq!(decode_status(status), expected);
        }
    }

    #[test]
    fn errors_have_only_fixed_nonsecret_codes() {
        for (error, code) in [
            (AclError::AclPresent, "acl_present"),
            (AclError::Unavailable, "acl_unavailable"),
            (AclError::Unsupported, "acl_unsupported"),
        ] {
            assert_eq!(error.code(), code);
            assert_eq!(error.to_string(), code);
            assert!(std::error::Error::source(&error).is_none());
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn other_unix_targets_do_not_claim_acl_support() {
        use std::os::fd::AsFd;
        let (socket, _peer) = std::os::unix::net::UnixStream::pair().unwrap();
        assert_eq!(require_no_acl(socket.as_fd()), Err(AclError::Unsupported));
        assert!(socket.local_addr().is_ok());
    }
}
