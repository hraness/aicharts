//! Dormant terminal enrollment bytes and retained-context validation only.
//! No transport, CLI command, filesystem, credential custody or activation lives
//! here. A decoded response is not authentication or permission to upload.
#![allow(dead_code)]

pub(super) mod contract;
