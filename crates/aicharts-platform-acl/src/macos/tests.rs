use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, Write},
    os::{
        fd::AsFd,
        unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
    },
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use super::{deny_fault_case, fault_case, set_fixture_acl};
use crate::{require_deny_only_acl, require_no_acl, AclError};

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let counter = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
        let path = fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!(
                "aicharts-acl-test-{}-{nonce}-{counter}",
                std::process::id()
            ));
        // Exclusive directory creation refuses a pre-existing collision.
        fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
        Self(path)
    }

    fn directory(&self) -> File {
        File::open(&self.0).unwrap()
    }

    fn file(&self, name: &str) -> File {
        OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(self.0.join(name))
            .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // Exact directory created by this fixture, never a path-prefix sweep.
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn native_faults_preserve_closed_status_and_exact_cleanup() {
    // Every successful security allocation must be freed. Real ACL copies
    // must be freed once; absent/null/sentinel and borrowed entry pointers must not.
    for (name, scenario, status, security_frees, acl_frees) in [
        ("absent ACL", 0, 0, 1, 0),
        ("empty ACL", 1, 0, 1, 1),
        ("ACE present with bitmask presence", 2, 1, 1, 1),
        ("allocation failure", 3, 2, 0, 0),
        ("descriptor stat failure", 4, 2, 1, 0),
        ("stat unsupported", 5, 3, 1, 0),
        ("false-success unpopulated stat", 6, 2, 1, 0),
        ("owner property absent", 7, 2, 1, 0),
        ("group property absent", 8, 2, 1, 0),
        ("mode property absent", 9, 2, 1, 0),
        ("owner disagrees with stat", 10, 2, 1, 0),
        ("group disagrees with stat", 11, 2, 1, 0),
        ("mode disagrees with stat", 12, 2, 1, 0),
        ("owner read failure", 13, 2, 1, 0),
        ("ACL presence query failure", 14, 2, 1, 0),
        ("ACL copy read failure", 15, 2, 1, 0),
        ("null ACL copy", 16, 2, 1, 0),
        ("unexpected remove sentinel", 17, 2, 1, 0),
        ("invalid ACL", 18, 2, 1, 1),
        ("iterator allocation failure", 19, 2, 1, 1),
        ("iterator non-Darwin positive result", 20, 2, 1, 1),
        ("null entry after iterator success", 21, 2, 1, 1),
        ("unexpected positive stat result", 22, 2, 1, 0),
        ("unexpected positive ACL read result", 23, 2, 1, 0),
        ("unexpected positive query result", 24, 2, 1, 0),
        ("iterator unsupported survives cleanup errno", 25, 3, 1, 1),
        ("entry success ignores stale EINVAL", 26, 1, 1, 1),
        ("mandatory metadata query failure", 27, 2, 1, 0),
        ("stat ENOENT is not ACL absence", 28, 2, 1, 0),
        ("ACL read ENOENT is not absence", 29, 2, 1, 0),
        ("group read failure", 30, 2, 1, 0),
        ("mode read failure", 31, 2, 1, 0),
        ("ACL cleanup unexpected failure", 32, 2, 1, 1),
        ("query unsupported", 33, 3, 1, 0),
        ("ACL read unsupported", 34, 3, 1, 0),
        ("validation unsupported", 35, 3, 1, 1),
    ] {
        let packed = fault_case(scenario);
        assert_eq!(packed & 255, status, "{name}: status");
        assert_eq!(
            (packed >> 8) & 255,
            security_frees,
            "{name}: security cleanup"
        );
        assert_eq!((packed >> 16) & 255, acl_frees, "{name}: ACL cleanup");
        assert_eq!(
            packed >> 24,
            0,
            "{name}: invalid call or freed borrowed pointer"
        );
        // The shared ownership/property/error checks retain the same behavior
        // under the traversal policy for all original scenarios.
        assert_eq!(
            deny_fault_case(scenario),
            packed,
            "{name}: traversal ownership path"
        );
    }
}

#[test]
fn deny_only_iteration_is_bounded_and_never_accepts_unknown_or_allow_entries() {
    for (scenario, status) in [
        (36, 0),
        (37, 0),
        (38, 2),
        (39, 1),
        (40, 2),
        (41, 2),
        (42, 2),
        (43, 2),
        (44, 2),
        (45, 2),
    ] {
        let packed = deny_fault_case(scenario);
        assert_eq!(packed & 255, status, "scenario {scenario}");
        assert_eq!((packed >> 8) & 255, 1);
        assert_eq!((packed >> 16) & 255, 1);
        assert_eq!(packed >> 24, 0);
    }
}

#[test]
fn real_deny_only_ancestor_policy_is_distinct_from_private_storage_policy() {
    for (kind, accepted) in [(0, true), (1, false), (2, true), (3, false)] {
        let fixture = Fixture::new();
        let directory = fixture.directory();
        set_fixture_acl(directory.as_fd(), kind);
        assert_eq!(require_deny_only_acl(directory.as_fd()).is_ok(), accepted);
        assert_eq!(require_no_acl(directory.as_fd()).is_ok(), kind == 0);
        assert!(directory.metadata().unwrap().is_dir());
    }
}

#[test]
fn inspection_accepts_absent_and_empty_acls_without_closing_or_seeking_fd() {
    let fixture = Fixture::new();
    let directory = fixture.directory();
    assert_eq!(require_no_acl(directory.as_fd()), Ok(()));
    let mut file = fixture.file("empty");
    assert_eq!(require_no_acl(file.as_fd()), Ok(()));
    file.write_all(b"synthetic numeric-reference fixture")
        .unwrap();
    let position = file.stream_position().unwrap();
    set_fixture_acl(file.as_fd(), 0);
    for _ in 0..4 {
        assert_eq!(require_no_acl(file.as_fd()), Ok(()));
        assert_eq!(file.stream_position().unwrap(), position);
    }
    file.rewind().unwrap();
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).unwrap();
    assert_eq!(bytes, b"synthetic numeric-reference fixture");
    assert_eq!(
        file.metadata().unwrap().permissions().mode() & 0o7777,
        0o600
    );
}

#[test]
fn all_allow_deny_and_inherit_only_entries_are_rejected() {
    for kind in [1, 2] {
        let fixture = Fixture::new();
        let file = fixture.file("entry");
        set_fixture_acl(file.as_fd(), kind);
        assert_eq!(require_no_acl(file.as_fd()), Err(AclError::AclPresent));
        assert_eq!(file.metadata().unwrap().len(), 0);
    }
    let fixture = Fixture::new();
    let directory = fixture.directory();
    set_fixture_acl(directory.as_fd(), 3);
    assert_eq!(require_no_acl(directory.as_fd()), Err(AclError::AclPresent));
    assert!(directory.metadata().unwrap().is_dir());
}

#[test]
fn inherited_acls_are_visible_despite_private_creation_modes_before_payload_write() {
    let fixture = Fixture::new();
    let directory = fixture.directory();
    set_fixture_acl(directory.as_fd(), 3);
    let file = fixture.file("inherited");
    assert_eq!(
        file.metadata().unwrap().permissions().mode() & 0o7777,
        0o600
    );
    assert_eq!(require_no_acl(file.as_fd()), Err(AclError::AclPresent));
    assert_eq!(file.metadata().unwrap().len(), 0);
    let child_path = fixture.0.join("child");
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&child_path)
        .unwrap();
    let child = File::open(child_path).unwrap();
    assert_eq!(
        child.metadata().unwrap().permissions().mode() & 0o7777,
        0o700
    );
    assert_eq!(require_no_acl(child.as_fd()), Err(AclError::AclPresent));
}

#[test]
fn renamed_descriptor_never_switches_to_the_replacement_path() {
    let fixture = Fixture::new();
    let original = fixture.file("current");
    set_fixture_acl(original.as_fd(), 1);
    fs::rename(fixture.0.join("current"), fixture.0.join("previous")).unwrap();
    let replacement = fixture.file("current");
    assert_eq!(require_no_acl(original.as_fd()), Err(AclError::AclPresent));
    assert_eq!(require_no_acl(replacement.as_fd()), Ok(()));
    fs::remove_file(fixture.0.join("previous")).unwrap();
    assert_eq!(require_no_acl(original.as_fd()), Err(AclError::AclPresent));
    assert!(original.metadata().is_ok());
    assert!(replacement.metadata().is_ok());
}
