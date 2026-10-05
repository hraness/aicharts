//! Pure release discovery and checksum matching for `aicharts update`.
//!
//! GitHub publishes each CLI release as `cli-vMAJOR.MINOR.PATCH` with a
//! `SHA256SUMS` asset covering the Linux archive and one `<name>.sha256`
//! sidecar for the signed macOS archive. Everything here is in-memory text
//! handling; network, filesystem and process work live in sibling modules.

use serde::Deserialize;

pub(crate) const RELEASES_URL: &str =
    "https://api.github.com/repos/hraness/aicharts/releases?per_page=20";
pub(crate) const DOWNLOAD_BASE: &str = "https://github.com/hraness/aicharts/releases/download";

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Version {
    pub(crate) major: u64,
    pub(crate) minor: u64,
    pub(crate) patch: u64,
}

impl Version {
    pub(crate) fn parse(text: &str) -> Option<Self> {
        let mut parts = text.split('.');
        let major = component(parts.next()?)?;
        let minor = component(parts.next()?)?;
        let patch = component(parts.next()?)?;
        if parts.next().is_some() {
            return None;
        }
        Some(Self {
            major,
            minor,
            patch,
        })
    }

    pub(crate) fn text(&self) -> String {
        format!("{}.{}.{}", self.major, self.minor, self.patch)
    }
}

fn component(text: &str) -> Option<u64> {
    if text.is_empty()
        || text.len() > 9
        || (text.len() > 1 && text.starts_with('0'))
        || !text.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    text.parse().ok()
}

/// The archive name and checksum asset for this build's platform.
pub(crate) fn target_asset(version: &Version) -> Option<TargetAsset> {
    let triple = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "aarch64-apple-darwin",
        ("linux", "x86_64") => "x86_64-unknown-linux-gnu",
        _ => return None,
    };
    Some(TargetAsset {
        triple,
        archive: format!("aicharts-{}-{}.tar.gz", version.text(), triple),
        macos: std::env::consts::OS == "macos",
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TargetAsset {
    pub(crate) triple: &'static str,
    /// `aicharts-V-T.tar.gz`
    pub(crate) archive: String,
    /// Digest for this archive arrives via `SHA256SUMS` on Linux and via the
    /// archive's own `.sha256` sidecar on macOS.
    pub(crate) macos: bool,
}

impl TargetAsset {
    /// The release asset that carries this archive's expected digest.
    pub(crate) fn checksum_asset(&self) -> String {
        if self.macos {
            format!("{}.sha256", self.archive)
        } else {
            "SHA256SUMS".to_owned()
        }
    }
}

#[derive(Deserialize)]
struct ListedRelease {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// Newest stable `cli-v*` release in a `/releases` JSON body, or None when the
/// page holds none. Drafts, prereleases and non-CLI tags never count.
pub(crate) fn newest_release(body: &[u8]) -> Result<Option<Version>, &'static str> {
    let listed: Vec<ListedRelease> =
        serde_json::from_slice(body).map_err(|_| "update_release_list_invalid")?;
    let mut newest: Option<Version> = None;
    for release in listed {
        if release.draft || release.prerelease {
            continue;
        }
        let Some(version) = release
            .tag_name
            .strip_prefix("cli-v")
            .and_then(Version::parse)
        else {
            continue;
        };
        if newest.is_none_or(|held| version > held) {
            newest = Some(version);
        }
    }
    Ok(newest)
}

/// `<64 lowercase hex><two spaces><basename><LF>` per line, sorted upstream.
/// Returns the digest for exactly `name`; duplicate or malformed rows and
/// any name containing a path separator or whitespace fail closed.
pub(crate) fn checksum_for(sums: &[u8], name: &str) -> Option<String> {
    if name.is_empty()
        || name.len() > 128
        || name
            .bytes()
            .any(|b| b == b'/' || b == b'\\' || b.is_ascii_whitespace())
    {
        return None;
    }
    let text = std::str::from_utf8(sums).ok()?;
    if text.len() > 8 * 1024 || !text.ends_with('\n') {
        return None;
    }
    let mut found = None;
    for line in text.split('\n').take_while(|line| !line.is_empty()) {
        let (digest, file) = line.split_once("  ")?;
        if digest.len() != 64
            || !digest
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            || file.is_empty()
            || file
                .bytes()
                .any(|b| b.is_ascii_whitespace() || b == b'/' || b == b'\\')
        {
            return None;
        }
        if file == name {
            if found.is_some() {
                return None;
            }
            found = Some(digest.to_owned());
        }
    }
    found
}

/// A one-line `<digest>  <name>` sidecar, as published beside the signed
/// macOS archive.
pub(crate) fn sidecar_digest(body: &[u8], name: &str) -> Option<String> {
    let text = std::str::from_utf8(body).ok()?.trim_end_matches('\n');
    let (digest, file) = text.split_once("  ")?;
    if file != name
        || digest.len() != 64
        || !digest
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return None;
    }
    Some(digest.to_owned())
}
