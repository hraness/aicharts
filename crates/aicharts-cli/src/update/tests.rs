use super::release::{checksum_for, newest_release, sidecar_digest, Version};
use super::schedule;
use crate::history::schedule::Manager;
use std::cell::RefCell;
use std::path::{Path, PathBuf};

#[test]
fn version_parses_canonical_only() {
    assert_eq!(
        Version::parse("1.2.3"),
        Some(Version {
            major: 1,
            minor: 2,
            patch: 3
        })
    );
    for bad in [
        "",
        "1",
        "1.2",
        "1.2.3.4",
        "v1.2.3",
        "1.2.3-rc1",
        "1.2.x",
        "01.2.3",
        "1.2.3 ",
        " 1.2.3",
    ] {
        assert_eq!(Version::parse(bad), None, "{bad}");
    }
    assert_eq!(Version::parse("01.2.3"), None);
}

#[test]
fn newest_release_picks_highest_stable_cli_tag() {
    let body = br#"[
        {"tag_name":"cli-v0.3.1","draft":false,"prerelease":false},
        {"tag_name":"cli-v0.10.0","draft":false,"prerelease":false},
        {"tag_name":"cli-v0.9.9","draft":true,"prerelease":false},
        {"tag_name":"cli-v0.11.0","draft":false,"prerelease":true},
        {"tag_name":"site-v5","draft":false,"prerelease":false},
        {"tag_name":"junk","draft":false,"prerelease":false}
    ]"#;
    assert_eq!(
        newest_release(body),
        Ok(Some(Version {
            major: 0,
            minor: 10,
            patch: 0
        }))
    );
}

#[test]
fn newest_release_rejects_malformed_json_and_empty_pages() {
    assert_eq!(
        newest_release(b"not json"),
        Err("update_release_list_invalid")
    );
    assert_eq!(newest_release(b"[]"), Ok(None));
    assert_eq!(
        newest_release(br#"[{"tag_name":"cli-v1.0.0","draft":true,"prerelease":false}]"#),
        Ok(None)
    );
}

#[test]
fn checksum_for_finds_exact_name() {
    let digest = "a".repeat(64);
    let other = "b".repeat(64);
    let sums = format!("{digest}  aicharts-1.2.3-x86_64-unknown-linux-gnu.tar.gz\n{other}  release-manifest.json\n");
    assert_eq!(
        checksum_for(
            sums.as_bytes(),
            "aicharts-1.2.3-x86_64-unknown-linux-gnu.tar.gz"
        ),
        Some(digest.clone())
    );
    assert_eq!(checksum_for(sums.as_bytes(), "missing.tar.gz"), None);
}

#[test]
fn checksum_for_refuses_malformed_rows() {
    let digest = "a".repeat(64);
    // single space
    assert_eq!(
        checksum_for(
            format!("{digest} aicharts-1.tar.gz\n").as_bytes(),
            "aicharts-1.tar.gz"
        ),
        None
    );
    // uppercase digest
    assert_eq!(
        checksum_for(
            format!("{}  a.tar.gz\n", "A".repeat(64)).as_bytes(),
            "a.tar.gz"
        ),
        None
    );
    // duplicate name
    let dup = format!("{digest}  a.tar.gz\n{digest}  a.tar.gz\n");
    assert_eq!(checksum_for(dup.as_bytes(), "a.tar.gz"), None);
    // path separator in name
    let pathy = format!("{digest}  ../a.tar.gz\n");
    assert_eq!(checksum_for(pathy.as_bytes(), "../a.tar.gz"), None);
    // missing final newline
    assert_eq!(
        checksum_for(format!("{digest}  a.tar.gz").as_bytes(), "a.tar.gz"),
        None
    );
    // oversized body
    let big = vec![b'x'; 9 * 1024];
    assert_eq!(checksum_for(&big, "a.tar.gz"), None);
    // traversal in the requested name is refused before any row is read
    assert_eq!(
        checksum_for(format!("{digest}  a\n").as_bytes(), "../x"),
        None
    );
}

#[test]
fn sidecar_digest_matches_single_line() {
    let digest = "c".repeat(64);
    let body = format!("{digest}  aicharts-1.0.0-aarch64-apple-darwin.tar.gz\n");
    assert_eq!(
        sidecar_digest(
            body.as_bytes(),
            "aicharts-1.0.0-aarch64-apple-darwin.tar.gz"
        ),
        Some(digest.clone())
    );
    assert_eq!(sidecar_digest(body.as_bytes(), "other.tar.gz"), None);
    // two lines are not a sidecar
    let two = format!("{digest}  a.tar.gz\n{digest}  b.tar.gz\n");
    assert_eq!(sidecar_digest(two.as_bytes(), "a.tar.gz"), None);
}

struct Recorder {
    calls: RefCell<Vec<String>>,
    loaded: bool,
    succeed: bool,
}

impl Manager for Recorder {
    fn run(&self, program: &str, args: &[String]) -> bool {
        self.calls
            .borrow_mut()
            .push(format!("{program} {}", args.join(" ")));
        if args.first().map(String::as_str) == Some("print") {
            return self.loaded;
        }
        self.succeed
    }
}

fn recorder(loaded: bool, succeed: bool) -> Recorder {
    Recorder {
        calls: RefCell::new(Vec::new()),
        loaded,
        succeed,
    }
}

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "aicharts-update-schedule-{}-{name}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn launchd_plan_runs_scheduled_update_and_escapes_paths() {
    let home = PathBuf::from("/Users/me");
    let plan = schedule::plan_for(
        schedule::Kind::Launchd,
        Path::new("/Users/me/.local/bin/aicharts & co"),
        &|name| match name {
            "HOME" => Some("/Users/me".to_owned()),
            "AICHARTS_HOME" => Some("/Users/me/.aicharts".to_owned()),
            _ => None,
        },
    )
    .unwrap();
    let contents = &plan.definitions[0].contents;
    assert!(contents.starts_with("<!-- aicharts update io.aicharts.update.plist sha256:"));
    assert!(contents.contains(
        "<string>/Users/me/.local/bin/aicharts &amp; co</string><string>update</string><string>--scheduled</string>"
    ));
    assert!(contents.contains("<key>StartInterval</key><integer>86400</integer>"));
    assert!(contents.contains("<key>RunAtLoad</key><true/>"));
    assert!(!contents.contains("KeepAlive"));
    assert_eq!(
        plan.definitions[0].path,
        home.join("Library/LaunchAgents/io.aicharts.update.plist")
    );
    assert_eq!(
        schedule::plan_for(
            schedule::Kind::Launchd,
            Path::new("relative/aicharts"),
            &|name| match name {
                "HOME" => Some("/Users/me".to_owned()),
                "AICHARTS_HOME" => Some("/Users/me/.aicharts".to_owned()),
                _ => None,
            },
        ),
        Err("update_program_path_unsupported")
    );
}

#[test]
fn systemd_plan_refuses_paths_systemd_would_split_or_expand() {
    let plan = schedule::plan_for(
        schedule::Kind::Systemd,
        Path::new("/home/me/.local/bin/aicharts"),
        &|name| match name {
            "HOME" => Some("/home/me".to_owned()),
            _ => None,
        },
    )
    .unwrap();
    assert_eq!(plan.definitions.len(), 2);
    assert!(plan.definitions[0]
        .contents
        .contains("ExecStart=/home/me/.local/bin/aicharts update --scheduled"));
    assert!(plan.definitions[1]
        .contents
        .contains("OnUnitActiveSec=86400s"));
    assert!(plan.definitions[1].contents.contains("Persistent=true"));
    for unsafe_path in [
        "/home/me/my tools/aicharts",
        "/home/me/100%/aicharts",
        "/home/$USER/aicharts",
    ] {
        assert_eq!(
            schedule::plan_for(
                schedule::Kind::Systemd,
                Path::new(unsafe_path),
                &|name| match name {
                    "HOME" => Some("/home/me".to_owned()),
                    _ => None,
                },
            ),
            Err("update_program_path_unsupported")
        );
    }
}

#[test]
fn enable_writes_once_starts_and_reports_unchanged_on_repeat() {
    let dir = temp("enable");
    let unit_dir = dir.join("units");
    let plan = schedule::plan_for(
        schedule::Kind::Systemd,
        Path::new("/opt/aicharts/bin/aicharts"),
        &|name| match name {
            "XDG_CONFIG_HOME" => Some(dir.to_string_lossy().into_owned()),
            "HOME" => Some(dir.to_string_lossy().into_owned()),
            _ => None,
        },
    )
    .unwrap();
    // plan_for computes its own unit dir; rebuild one pointed at temp.
    let plan = schedule::Plan {
        kind: plan.kind,
        definitions: plan
            .definitions
            .iter()
            .map(|d| schedule::Definition {
                path: unit_dir.join(d.name),
                name: d.name,
                contents: d.contents.clone(),
            })
            .collect(),
    };
    let first = schedule::enable(
        &plan,
        &recorder(false, true),
        "",
        Some("/usr/bin/systemctl"),
    )
    .unwrap();
    assert_eq!(first.changes, vec!["created", "created"]);
    assert_eq!(first.activation, "running");
    assert_eq!(schedule::state(&plan), "on");
    let second = schedule::enable(
        &plan,
        &recorder(false, true),
        "",
        Some("/usr/bin/systemctl"),
    )
    .unwrap();
    assert_eq!(second.changes, vec!["unchanged", "unchanged"]);
    let removed = schedule::disable(
        &plan,
        &recorder(false, true),
        "",
        Some("/usr/bin/systemctl"),
    )
    .unwrap();
    assert!(removed);
    assert_eq!(schedule::state(&plan), "off");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn foreign_update_unit_is_left_alone() {
    let dir = temp("foreign");
    let plan = schedule::plan_for(
        schedule::Kind::Systemd,
        Path::new("/opt/aicharts/bin/aicharts"),
        &|name| match name {
            "XDG_CONFIG_HOME" => Some(dir.to_string_lossy().into_owned()),
            "HOME" => Some(dir.to_string_lossy().into_owned()),
            _ => None,
        },
    )
    .unwrap();
    let unit_dir = dir.join("systemd").join("user");
    std::fs::create_dir_all(&unit_dir).unwrap();
    let foreign = unit_dir.join("aicharts-update.service");
    std::fs::write(&foreign, "[Service]\nExecStart=/bin/false\n").unwrap();
    assert_eq!(schedule::state(&plan), "not-ours");
    assert_eq!(
        schedule::enable(
            &plan,
            &recorder(false, true),
            "",
            Some("/usr/bin/systemctl")
        ),
        Err("update_not_ours")
    );
    assert!(foreign.exists());
    let _ = std::fs::remove_dir_all(&dir);
}
