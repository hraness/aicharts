//! Terminal enrollment codec and once-only HTTPS exchange. The `enroll`
//! command drives native pairing custody on macOS; upload enrollment remains
//! dormant. A returned observation is not permission to upload.
#![allow(dead_code)]

mod attempt;
pub(super) mod command;
pub(super) mod contract;
mod https;
