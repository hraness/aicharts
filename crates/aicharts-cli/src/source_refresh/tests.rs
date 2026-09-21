use super::*;
use std::{
    collections::VecDeque,
    fs,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};

fn jwt(user: &str) -> String {
    jwt_sub(&format!("auth0|{user}"))
}
fn jwt_sub(sub: &str) -> String {
    let claims = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(serde_json::to_vec(&json!({"sub":sub})).unwrap());
    format!("header.{claims}.signature")
}
fn auth() -> Credential {
    credential(&jwt("user_test"), true).unwrap()
}
fn event(timestamp: u64, count: u64) -> Value {
    json!({"timestamp":timestamp,"model":"claude-sonnet-4","conversationId":format!("session-{timestamp}"),"tokenUsage":{"inputTokens":count,"outputTokens":2,"totalCents":0.25},"privateTranscript":"must never persist"})
}
fn page(total: usize, events: Vec<Value>) -> Vec<u8> {
    serde_json::to_vec(&json!({"totalUsageEventsCount":total,"usageEventsDisplay":events})).unwrap()
}
struct Fixture {
    pages: VecDeque<Result<Vec<u8>>>,
    calls: usize,
}
impl Fixture {
    fn new(pages: Vec<Vec<u8>>) -> Self {
        Self {
            pages: pages.into_iter().map(Ok).collect(),
            calls: 0,
        }
    }
}
impl Transport for Fixture {
    fn summary(&mut self, _: &Credential, _: Duration) -> Result<Vec<u8>> {
        Ok(br#"{"billingCycleStart":"2026-09-01T00:00:00Z","billingCycleEnd":"2026-10-01T00:00:00Z"}"#.to_vec())
    }
    fn page(
        &mut self,
        _: &Credential,
        page: usize,
        _: (u64, u64),
        _: Duration,
        _: usize,
    ) -> Result<Vec<u8>> {
        self.calls += 1;
        assert_eq!(page, self.calls);
        self.pages.pop_front().expect("bounded fixture request")
    }
}
#[test]
fn credential_requires_exact_subject_cookie_binding_and_never_debugs_cookie() {
    let access = jwt("user_test");
    let first = credential(&access, true).unwrap();
    let second = credential(&format!("user_test%3A%3A{access}"), false).unwrap();
    assert_eq!(first.account, second.account);
    assert!(first.cookie.is_sensitive());
    assert!(credential(&format!("user_other%3A%3A{access}"), false).is_err());
    assert!(credential(&jwt("prefix_user_bad"), true).is_err());
    assert!(credential(&format!("{access};secret=bad"), true).is_err());
}
#[test]
fn credential_derives_account_from_identity_provider_prefixed_subjects() {
    // Cursor's migrated session tokens carry Auth0 connection names such as
    // `google-oauth2|`; the account id is the final `user_` segment and the
    // cookie prefix must still bind to it exactly.
    for sub in [
        "google-oauth2|user_test",
        "workos|user_test",
        "auth0|user_test",
        "user_test",
    ] {
        let access = jwt_sub(sub);
        let bound = credential(&format!("user_test%3A%3A{access}"), false).unwrap();
        assert_eq!(bound.account, auth().account);
    }
    // IdP-backed subjects carry the upstream identity, not the account id; the
    // cookie prefix supplies it instead. Desktop tokens have no prefix and
    // cannot derive an account from these subjects.
    let idp = jwt_sub("google-oauth2|112374926342319287763");
    let bound = credential(&format!("user_test%3A%3A{idp}"), false).unwrap();
    assert_eq!(bound.account, auth().account);
    assert!(credential(&idp, true).is_err());
    // With an IdP subject no embedded `user_` exists to prove the binding, so
    // the cookie prefix is authoritative: a different prefix binds a different
    // account rather than aliasing user_test's.
    let other = credential(&format!("user_other%3A%3A{idp}"), false).unwrap();
    assert_ne!(other.account, auth().account);
    assert!(credential(&jwt_sub("google-oauth2|service_account"), true).is_err());
    assert_ne!(
        credential(&jwt_sub("google-oauth2|user_other"), true)
            .unwrap()
            .account,
        auth().account
    );
    let foreign = jwt_sub("google-oauth2|user_test");
    assert!(credential(&format!("user_other%3A%3A{foreign}"), false).is_err());
}
#[test]
fn pagination_is_complete_and_projects_only_recognized_usage_fields() {
    let mut fixture = Fixture::new(vec![
        page(2, vec![event(1789779600000, 10)]),
        page(2, vec![event(1789779700000, 20)]),
    ]);
    let rows = fetch(&mut fixture, &auth(), Instant::now(), None).unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(fixture.calls, 2);
    assert!(rows.iter().all(|r| r.get("privateTranscript").is_none()));
}
#[test]
fn repeated_pages_shrinking_totals_and_empty_truncation_are_rejected() {
    let first = page(2, vec![event(1789779600000, 10)]);
    for last in [
        first.clone(),
        page(1, vec![event(1789779700000, 20)]),
        page(2, vec![]),
    ] {
        let mut fixture = Fixture::new(vec![first.clone(), last]);
        assert!(fetch(&mut fixture, &auth(), Instant::now(), None).is_err());
    }
}
#[test]
fn append_only_drift_is_tolerated_and_boundary_duplicates_collapse() {
    // The advertised total may grow while paging: Cursor clients repost usage
    // with past timestamps inside the pinned window. The refresh completes on
    // the newest advertised count.
    let grown = event(1789779800000, 30);
    let mut fixture = Fixture::new(vec![
        page(2, vec![event(1789779600000, 10)]),
        page(3, vec![event(1789779700000, 20), grown.clone()]),
    ]);
    let rows = fetch(&mut fixture, &auth(), Instant::now(), None).unwrap();
    assert_eq!(rows.len(), 3);
    // A boundary-shifted page can re-show an identical event; it collapses
    // instead of double counting, while a mass duplicate still refuses.
    let duped = event(1789779600000, 10);
    let mut fixture = Fixture::new(vec![
        page(2, vec![duped.clone()]),
        page(2, vec![duped, event(1789779700000, 20)]),
    ]);
    let rows = fetch(&mut fixture, &auth(), Instant::now(), None).unwrap();
    assert_eq!(rows.len(), 2);
}
#[test]
fn malformed_usage_is_not_silently_dropped() {
    for row in [
        json!({"timestamp":1789779600000u64,"model":"auto"}),
        json!({"timestamp":1789779600000u64,"model":"auto","tokenUsage":{"inputTokens":-1}}),
        json!({"timestamp":1789779600000u64,"model":"auto","chargedCents":"NaN"}),
    ] {
        let mut fixture = Fixture::new(vec![page(1, vec![row])]);
        assert!(fetch(&mut fixture, &auth(), Instant::now(), None).is_err());
    }
    let mut fixture = Fixture::new(vec![serde_json::to_vec(
        &json!({"totalUsageEventsCount":0,"challenge":"blocked"}),
    )
    .unwrap()]);
    assert!(fetch(&mut fixture, &auth(), Instant::now(), None).is_err());
}
#[test]
fn total_deadline_refuses_late_success_without_publishing() {
    let mut fixture = Fixture::new(vec![]);
    assert_eq!(
        fetch(&mut fixture, &auth(), Instant::now() - BUDGET, None).unwrap_err(),
        "cursor_refresh_timeout"
    );
    assert_eq!(fixture.calls, 0);
}
#[test]
fn merge_replaces_present_utc_days_and_retains_older_absent_days() {
    let older = event(1789606800000, 5);
    let old_current = event(1789779600000, 10);
    let new_current = event(1789779700000, 20);
    let previous = merge(None, vec![older.clone(), old_current]).unwrap();
    let result = merge(Some(&previous), vec![new_current.clone()]).unwrap();
    let result: Value = serde_json::from_slice(&result).unwrap();
    let rows = result["usageEventsDisplay"].as_array().unwrap();
    assert_eq!(
        rows,
        &vec![project(&older).unwrap(), project(&new_current).unwrap()]
    );
    assert_eq!(
        merge(Some(&previous), vec![]).unwrap_err(),
        "cursor_refresh_empty_preserved"
    );
}

#[cfg(unix)]
mod unix {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Scratch(PathBuf);
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn scratch() -> Scratch {
        let parent = fs::canonicalize(std::env::temp_dir()).unwrap();
        let path = parent.join(format!(
            "aicharts-cursor-refresh-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        Scratch(path)
    }
    fn current(path: &Path, auth: &Credential) -> PathBuf {
        path.join(format!("usage.{}.json", &auth.account[..32]))
    }
    #[test]
    fn refresh_preserves_last_good_cache_after_failed_page_or_account_switch() {
        let scratch = scratch();
        let auth = auth();
        let mut first = Fixture::new(vec![page(1, vec![event(1789779600000, 10)])]);
        refresh(&scratch.0, &auth, &mut first, Instant::now()).unwrap();
        let original = fs::read(current(&scratch.0, &auth)).unwrap();
        let mut failed = Fixture {
            pages: VecDeque::from([Err("fixture_failure")]),
            calls: 0,
        };
        assert_eq!(
            refresh(&scratch.0, &auth, &mut failed, Instant::now()).unwrap_err(),
            "fixture_failure"
        );
        assert_eq!(fs::read(current(&scratch.0, &auth)).unwrap(), original);
        let other = credential(&jwt("user_other"), true).unwrap();
        let mut unused = Fixture::new(vec![]);
        assert_eq!(
            refresh(&scratch.0, &other, &mut unused, Instant::now()).unwrap_err(),
            "cursor_refresh_account_mismatch"
        );
        assert_eq!(unused.calls, 0);
        assert_eq!(fs::read(current(&scratch.0, &auth)).unwrap(), original);
        assert_eq!(
            fs::metadata(current(&scratch.0, &auth))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert!(!String::from_utf8(original)
            .unwrap()
            .contains("privateTranscript"));
    }
    #[test]
    fn stable_lock_refuses_concurrent_refresh_and_symlinked_cache() {
        let scratch = scratch();
        let cache = disk::Cache::open(&scratch.0).unwrap();
        assert!(disk::Cache::open(&scratch.0).is_err());
        drop(cache);
        let alias = scratch.0.join("alias");
        std::os::unix::fs::symlink(&scratch.0, &alias).unwrap();
        assert!(disk::Cache::open(&alias).is_err());
    }
    #[test]
    fn cache_refuses_changed_content_replaced_directory_and_escaping_names() {
        let scratch = scratch();
        let path = scratch.0.join("cache");
        let cache = disk::Cache::open(&path).unwrap();
        cache.replace("usage.json", b"first").unwrap();
        fs::write(path.join("usage.json"), b"externally-changed").unwrap();
        assert_eq!(
            cache.replace("usage.json", b"second").unwrap_err(),
            "source_refresh_cache_changed"
        );
        assert_eq!(
            fs::read(path.join("usage.json")).unwrap(),
            b"externally-changed"
        );
        assert!(cache.replace("../escape", b"bytes").is_err());
        assert!(!scratch.0.join("escape").exists());
        fs::rename(&path, scratch.0.join("moved")).unwrap();
        fs::create_dir(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(cache.replace("other.json", b"bytes").is_err());
        assert!(!path.join("other.json").exists());
    }
    #[test]
    fn hardlinked_secret_and_usage_cache_are_rejected() {
        let scratch = scratch();
        let secret = scratch.0.join("secret");
        fs::write(&secret, "secret-value").unwrap();
        fs::set_permissions(&secret, fs::Permissions::from_mode(0o600)).unwrap();
        fs::hard_link(&secret, scratch.0.join("alias")).unwrap();
        assert!(disk::read_secret(&secret).is_err());
        let path = scratch.0.join("cache");
        let cache = disk::Cache::open(&path).unwrap();
        cache.replace("usage.json", b"first").unwrap();
        fs::hard_link(path.join("usage.json"), scratch.0.join("usage-alias")).unwrap();
        assert!(cache.replace("usage.json", b"second").is_err());
        assert_eq!(fs::read(path.join("usage.json")).unwrap(), b"first");
    }
    #[test]
    fn explicit_secret_is_private_regular_and_bounded() {
        let scratch = scratch();
        let path = scratch.0.join("credential");
        fs::write(&path, "explicit-test-secret").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(disk::read_secret(&path).unwrap(), "explicit-test-secret");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(disk::read_secret(&path).is_err());
        let alias = scratch.0.join("alias");
        std::os::unix::fs::symlink(&path, &alias).unwrap();
        assert!(disk::read_secret(&alias).is_err());
    }
    #[test]
    fn desktop_sqlite_reads_only_the_explicit_token_key() {
        let scratch = scratch();
        let path = scratch.0.join("state.vscdb");
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE ItemTable(key TEXT PRIMARY KEY,value TEXT);")
            .unwrap();
        let access = jwt("user_test");
        db.execute(
            "INSERT INTO ItemTable VALUES('cursorAuth/accessToken',?1)",
            [&access],
        )
        .unwrap();
        db.execute(
            "INSERT INTO ItemTable VALUES('unrelated','private-ignored')",
            [],
        )
        .unwrap();
        drop(db);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(disk::read_desktop_token(&path).unwrap(), access);
    }
}

#[test]
fn billing_summary_must_identify_a_valid_cycle() {
    for bytes in [
        br#"{"billingCycleStart":"","billingCycleEnd":""}"#.as_slice(),
        br#"{"error":"challenge"}"#.as_slice(),
        br#"{"billingCycleStart":"2026-10-01T00:00:00Z","billingCycleEnd":"2026-09-01T00:00:00Z"}"#
            .as_slice(),
    ] {
        assert!(validate_summary(bytes).is_err());
    }
}

#[test]
fn exact_numeric_counts_and_blank_conversation_fallback_are_preserved() {
    let value=project(&json!({"timestamp":"1789779600000","model":"auto","conversationId":"","tokenUsage":{"inputTokens":"10.0","outputTokens":2.0,"totalCents":"0.25"}})).unwrap();
    assert_eq!(value["tokenUsage"]["inputTokens"], 10);
    assert!(value.get("conversationId").is_none());
    assert!(integer(&json!(1.5)).is_err());
}
