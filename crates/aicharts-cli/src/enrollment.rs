//! Dormant terminal enrollment codec and once-only HTTPS exchange. There is no
//! production transport constructor, CLI command, filesystem, credential custody
//! or activation here. A returned observation is not permission to upload.
#![allow(dead_code)]

mod attempt;
pub(super) mod contract;
mod https;
