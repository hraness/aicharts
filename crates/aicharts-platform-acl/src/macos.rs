//! The only Rust unsafe boundary: borrowed descriptors and fixed integer codes.
#![allow(unsafe_code)]

use std::os::fd::{AsRawFd, BorrowedFd};

use crate::{decode_status, AclError};

unsafe extern "C" {
    fn aicharts_macos_check_acl_fd(fd: std::ffi::c_int) -> std::ffi::c_int;
}

pub(super) fn require_no_acl(fd: BorrowedFd<'_>) -> Result<(), AclError> {
    // SAFETY: the borrow keeps a valid descriptor alive for this synchronous
    // call. The native function reads metadata only, never retains or closes
    // the descriptor, accepts no pointers, and returns a fixed integer status.
    let status = unsafe { aicharts_macos_check_acl_fd(fd.as_raw_fd()) };
    decode_status(status)
}

#[cfg(test)]
#[link(name = "aicharts_acl_test", kind = "static")]
unsafe extern "C" {
    fn aicharts_macos_acl_test_run(scenario: std::ffi::c_int) -> u32;
    fn aicharts_macos_acl_test_set(fd: std::ffi::c_int, kind: std::ffi::c_int) -> std::ffi::c_int;
}

#[cfg(test)]
fn fault_case(scenario: std::ffi::c_int) -> u32 {
    // SAFETY: the test-only native runner accepts an integer and owns all fake
    // objects in thread-local storage; it performs no filesystem operations.
    unsafe { aicharts_macos_acl_test_run(scenario) }
}

#[cfg(test)]
fn set_fixture_acl(fd: BorrowedFd<'_>, kind: std::ffi::c_int) {
    // SAFETY: callers are private tests passing descriptors of their own
    // disposable fixtures. The synchronous helper changes only this object's
    // ACL, keeps the descriptor borrowed, and accepts no Rust pointers.
    assert_eq!(
        unsafe { aicharts_macos_acl_test_set(fd.as_raw_fd(), kind) },
        0
    );
}

#[cfg(test)]
mod tests;
