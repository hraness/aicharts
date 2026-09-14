//! Owned filesystem fixtures; no home-directory discovery or user data reads.
use super::*;
use crate::references::engine;
use std::{
    fs::{self as disk, File},
    os::unix::fs::{symlink, DirBuilderExt, PermissionsExt},
    path::PathBuf,
};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = Path::new("/private/tmp").join(format!(
            "aic-anchor-{}-{stamp}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        disk::DirBuilder::new().mode(0o700).create(&path).unwrap();
        Self(path)
    }
    fn child(&self, name: &str) -> PathBuf {
        let path = self.0.join(name);
        disk::DirBuilder::new().mode(0o700).create(&path).unwrap();
        path
    }
    fn walk(&self, path: &str) -> Result<TrustedAnchor> {
        let names = components(Path::new(path))?;
        TrustedAnchor::walk(
            File::open(&self.0).unwrap().into(),
            names,
            rustix::process::geteuid().as_raw(),
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        disk::remove_dir_all(&self.0).unwrap();
    }
}
fn acl(path: &Path, rule: &str) {
    assert!(std::process::Command::new("/bin/chmod")
        .args(["+a", rule])
        .arg(path)
        .status()
        .unwrap()
        .success());
}

struct FixtureAclCleanup(Vec<PathBuf>);
impl Drop for FixtureAclCleanup {
    fn drop(&mut self) {
        // These exact newly-created test nodes received our synthetic ACLs.
        // Removing them here is fixture cleanup, never a production repair.
        for path in self.0.iter().rev() {
            assert!(std::process::Command::new("/bin/chmod")
                .arg("-N")
                .arg(path)
                .status()
                .unwrap()
                .success());
        }
    }
}

#[test]
fn path_grammar_is_exact_bounded_and_does_not_normalize() {
    for bad in [
        "", "/", "relative", "~/state", "/a/", "//a", "/a//b", "/a/./b", "/a/../b", "/a\0b",
    ] {
        assert!(components(Path::new(bad)).is_err(), "{bad:?}");
    }
    assert!(components(Path::new(&format!("/{}", "a".repeat(256)))).is_err());
    assert!(components(Path::new(&format!("/{}", vec!["a"; 65].join("/")))).is_err());
    assert_eq!(
        components(Path::new(&format!("/{}", vec!["a"; 64].join("/"))))
            .unwrap()
            .len(),
        64
    );
    assert!(components(Path::new(&format!(
        "/{}",
        vec!["a".repeat(255); 4].join("/")
    )))
    .is_err());
    let non_utf8 = Path::new(std::ffi::OsStr::from_bytes(b"/safe/\xff"));
    assert_eq!(components(non_utf8).unwrap()[1].as_bytes(), b"\xff");
}

#[test]
fn traversal_pins_every_edge_and_descriptor() {
    let fixture = Fixture::new();
    fixture.child("parent");
    fixture.child("parent/anchor");
    let chain = fixture.walk("/parent/anchor").unwrap();
    assert!(chain.revalidate().is_ok());
    let held = chain.descriptor().unwrap();
    disk::rename(fixture.0.join("parent"), fixture.0.join("old")).unwrap();
    fixture.child("parent");
    fixture.child("parent/anchor");
    assert!(chain.revalidate().is_err());
    assert!(fs::fstat(&held).is_ok());
}

#[test]
fn unsafe_ancestor_or_final_mode_never_creates_storage() {
    for (ancestor_mode, anchor_mode) in [
        (0o777, 0o700),
        (0o770, 0o700),
        (0o1777, 0o700),
        (0o700, 0o755),
        (0o700, 0o770),
    ] {
        let fixture = Fixture::new();
        let parent = fixture.child("parent");
        let anchor = fixture.child("parent/anchor");
        disk::set_permissions(parent, disk::Permissions::from_mode(ancestor_mode)).unwrap();
        disk::set_permissions(&anchor, disk::Permissions::from_mode(anchor_mode)).unwrap();
        assert!(fixture.walk("/parent/anchor").is_err());
        assert!(!anchor.join(DIRECTORY).exists());
    }
}

#[test]
fn no_symlink_component_or_missing_ancestor_is_followed_or_created() {
    let fixture = Fixture::new();
    let target = fixture.child("target");
    symlink(&target, fixture.0.join("link")).unwrap();
    assert!(fixture.walk("/link").is_err());
    fixture.child("target/anchor");
    assert!(fixture.walk("/link/anchor").is_err());
    assert!(matches!(
        fixture.walk("/missing/anchor"),
        Err(Error::Missing)
    ));
    assert!(!fixture.0.join("missing").exists());
}

#[test]
fn deny_only_ancestors_are_allowed_but_final_anchor_requires_no_acl() {
    let fixture = Fixture::new();
    let parent = fixture.child("parent");
    let anchor = fixture.child("parent/anchor");
    let _cleanup = FixtureAclCleanup(vec![parent.clone(), anchor.clone()]);
    acl(&parent, "everyone deny delete");
    assert!(fixture.walk("/parent/anchor").is_ok());
    acl(&anchor, "everyone deny delete");
    assert!(fixture.walk("/parent/anchor").is_err());
}

#[test]
fn any_allow_ancestor_entry_is_rejected_even_if_inherit_only() {
    for rule in [
        "everyone allow read",
        "everyone allow delete",
        "everyone allow read,file_inherit,directory_inherit,only_inherit",
    ] {
        let fixture = Fixture::new();
        let parent = fixture.child("parent");
        fixture.child("parent/anchor");
        let _cleanup = FixtureAclCleanup(vec![parent.clone()]);
        acl(&parent, rule);
        assert!(fixture.walk("/parent/anchor").is_err());
    }
}

#[test]
fn changed_ancestor_permissions_are_rechecked_on_each_storage_operation() {
    let fixture = Fixture::new();
    let parent = fixture.child("parent");
    fixture.child("parent/anchor");
    let chain = fixture.walk("/parent/anchor").unwrap();
    let mut storage =
        MacStorage::construct(chain.descriptor().unwrap(), true, Some(chain)).unwrap();
    engine::initialize(&mut storage, [41; 32]).unwrap();
    disk::set_permissions(parent, disk::Permissions::from_mode(0o777)).unwrap();
    assert!(engine::snapshot(&mut storage).is_err());
}

#[test]
fn owner_and_directory_rules_are_closed_without_changing_real_ownership() {
    let fixture = Fixture::new();
    let file = File::open(&fixture.0).unwrap();
    let uid = rustix::process::geteuid().as_raw();
    let mut stat = fs::fstat(&file).unwrap();
    for owner in [0, uid] {
        stat.st_uid = owner;
        assert!(ancestor_role(&stat, uid).is_ok());
    }
    stat.st_uid = uid.wrapping_add(1).max(1);
    assert!(ancestor_role(&stat, uid).is_err());
    stat.st_uid = uid;
    stat.st_mode = 0o100700;
    assert!(ancestor_role(&stat, uid).is_err());
}
