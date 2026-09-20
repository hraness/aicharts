use super::*;
use serde_json::json;

fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| (*v).into()).collect()
}
fn stream(turn: &str, count: u64) -> Vec<u8> {
    let event = json!({"type":"message","message":{"role":"assistant","turnId":turn,"timestamp":1789779600000u64,"content":"PRIVATE_RESPONSE_CANARY","usage":{"inputTokens":count,"outputTokens":3,"cacheReadTokens":2,"cacheWriteTokens":1}},"prompt":"PRIVATE_PROMPT_CANARY"});
    let result = json!({"type":"exec.result","turnId":turn,"sessionId":"PRIVATE_SESSION_CANARY","status":"succeeded","model":{"providerId":"minimax","modelId":"MiniMax-M2.5"},"response":"PRIVATE_RESPONSE_CANARY"});
    format!("{event}\n{result}\n").into_bytes()
}
const NOW: u64 = 1789862400000;
#[test]
fn help_explains_explicit_capture_without_opening_a_cache_or_executable() {
    for values in [
        &["--help"][..],
        &["mcode", "--help"][..],
        &["-h"][..],
        &["mcode", "-h"][..],
    ] {
        let outcome = run(&args(values)).unwrap();
        assert_eq!(outcome.exit_code, 0);
        assert!(outcome.summary.contains("--cache-dir ABS --executable ABS"));
        assert!(outcome.summary.contains("without a shell"));
        assert!(outcome.summary.contains("never publishes"));
    }
}

#[test]
fn argv_is_preserved_without_shell_interpolation_and_conflicting_formats_fail() {
    assert_eq!(
        prepare_args(&args(&["exec", "--prompt", "a 'quoted' $(literal) prompt"])).unwrap(),
        args(&[
            "exec",
            "--output-format",
            "stream-json",
            "--prompt",
            "a 'quoted' $(literal) prompt"
        ])
    );
    for values in [
        &["exec", "--output-format", "stream-json"][..],
        &["exec", "--format=stream-json"][..],
    ] {
        assert_eq!(prepare_args(&args(values)).unwrap(), args(values));
    }
    for values in [
        &["version"][..],
        &["exec", "--format=json"][..],
        &[
            "exec",
            "--format",
            "stream-json",
            "--output-format",
            "stream-json",
        ][..],
    ] {
        assert!(prepare_args(&args(values)).is_err());
    }
    assert!(options(&args(&[
        "mcode",
        "--cache-dir",
        "/private/cache",
        "--executable",
        "/bin/fake",
        "--timeout-seconds",
        "7201",
        "--",
        "exec"
    ]))
    .is_err());
}
#[test]
fn projected_cache_contains_only_numeric_usage_and_hashed_identities() {
    let mut projection = projection::Projection::default();
    for chunk in stream("PRIVATE_TURN_CANARY", 11).chunks(7) {
        projection.push(chunk, NOW).unwrap();
    }
    projection.finish(NOW).unwrap();
    let bytes = projection.merge(None).unwrap();
    let text = String::from_utf8(bytes.clone()).unwrap();
    assert_eq!(projection.records(), 1);
    assert!(!text.contains("PRIVATE_"));
    assert!(!text.contains("content"));
    assert!(text.contains("MiniMax-M2.5"));
    assert!(text.contains("\"inputTokens\":11"));
    assert_eq!(projection.merge(Some(&bytes)).unwrap(), bytes);
    let mut conflicting = projection::Projection::default();
    conflicting
        .push(&stream("PRIVATE_TURN_CANARY", 99), NOW)
        .unwrap();
    conflicting.finish(NOW).unwrap();
    assert_eq!(
        conflicting.merge(Some(&bytes)).unwrap_err(),
        "capture_conflicting_turn"
    );
    let mut next = projection::Projection::default();
    next.push(&stream("another-turn", 17), NOW).unwrap();
    next.finish(NOW).unwrap();
    let merged = next.merge(Some(&bytes)).unwrap();
    assert_eq!(
        String::from_utf8(merged)
            .unwrap()
            .matches("\"type\":\"message\"")
            .count(),
        2
    );
}
#[test]
fn the_same_turn_id_in_distinct_sessions_preserves_both_observations() {
    let mut first = projection::Projection::default();
    first.push(&stream("turn-1", 11), NOW).unwrap();
    first.finish(NOW).unwrap();
    let previous = first.merge(None).unwrap();
    let fresh = String::from_utf8(stream("turn-1", 11))
        .unwrap()
        .replace("PRIVATE_SESSION_CANARY", "other-session");
    let mut second = projection::Projection::default();
    second.push(fresh.as_bytes(), NOW).unwrap();
    second.finish(NOW).unwrap();
    let merged = second.merge(Some(&previous)).unwrap();
    assert_eq!(
        String::from_utf8(merged)
            .unwrap()
            .matches("\"type\":\"message\"")
            .count(),
        2
    );
}

#[test]
fn incomplete_invalid_failed_and_future_streams_cannot_publish() {
    let bytes = stream("turn", 11);
    let line_end = bytes.iter().position(|b| *b == b'\n').unwrap() + 1;
    let mut partial = projection::Projection::default();
    partial.push(&bytes[..line_end], NOW).unwrap();
    assert_eq!(partial.finish(NOW).unwrap_err(), "capture_incomplete");
    for invalid in [
        b"{invalid}\n".to_vec(),
        stream("turn", u64::MAX),
        String::from_utf8(bytes.clone())
            .unwrap()
            .replace("succeeded", "failed")
            .into_bytes(),
    ] {
        let mut projection = projection::Projection::default();
        assert!(projection.push(&invalid, NOW).is_err());
    }
    let mut future = projection::Projection::default();
    assert!(future.push(&bytes, 1000).is_err());
    let mut oversized = projection::Projection::default();
    assert_eq!(
        oversized
            .push(&vec![b'x'; 1024 * 1024 + 1], NOW)
            .unwrap_err(),
        "capture_line_limit"
    );
}

#[cfg(unix)]
mod native {
    use super::*;
    use std::{
        fs,
        os::unix::fs::{MetadataExt, PermissionsExt},
        path::Path,
        sync::atomic::{AtomicU64, Ordering},
    };
    static NEXT: AtomicU64 = AtomicU64::new(0);
    static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());
    struct Fixture {
        root: PathBuf,
        executable: PathBuf,
        cache: PathBuf,
    }
    impl Fixture {
        fn new(script: &str) -> Self {
            let base = std::fs::canonicalize(std::env::temp_dir()).unwrap();
            let root = base.join(format!(
                "aicharts-mcode-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
            let executable = root.join("fake-mcode");
            let cache = root.join("cache");
            write_script(&executable, script);
            Self {
                root,
                executable,
                cache,
            }
        }
        fn options(&self) -> Options {
            Options {
                cache: self.cache.clone(),
                executable: self.executable.clone(),
                args: prepare_args(&args(&["exec", "--prompt", "literal $(no-shell) 'text'"]))
                    .unwrap(),
                timeout: Duration::from_secs(5),
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    fn write_script(path: &Path, content: &str) {
        fs::write(path, format!("#!/bin/sh\n{content}\n")).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
    }
    fn successful_script() -> String {
        format!(
            "[ \"$1\" = exec ] && [ \"$2\" = --output-format ] && [ \"$3\" = stream-json ] || exit 27\nprintf '%s\\n' 'PRIVATE_STDERR_CANARY' >&2\ncat <<'NUMERIC_FIXTURE'\n{}NUMERIC_FIXTURE\n",
            String::from_utf8(stream("turn", 11)).unwrap()
        )
    }
    #[test]
    fn fake_capture_publishes_private_numeric_cache_and_imports_exclusive_mcode() {
        let _serial = SERIAL.lock().unwrap();
        let fixture = Fixture::new(&successful_script());
        let result = process::capture(&fixture.options()).unwrap();
        assert_eq!(result.exit_code, 0);
        assert!(!result.summary.contains("PRIVATE"));
        let cache = fs::read(fixture.cache.join("usage.jsonl")).unwrap();
        assert!(!String::from_utf8(cache.clone())
            .unwrap()
            .contains("PRIVATE"));
        assert_eq!(
            fs::metadata(fixture.cache.join("usage.jsonl"))
                .unwrap()
                .mode()
                & 0o777,
            0o600
        );
        let manifest = fs::read_to_string(fixture.cache.join("profile.json")).unwrap();
        assert!(!manifest.contains(fixture.root.to_str().unwrap()));
        assert!(!manifest.contains("prompt"));
        let imported = aicharts_import::collect_profile(
            &fixture.root,
            "mcode",
            std::slice::from_ref(&fixture.cache),
            std::slice::from_ref(&fixture.cache),
        )
        .unwrap();
        assert_eq!(imported.messages.len(), 1);
        assert_eq!(imported.messages[0].tokens.input, 11);
        assert_eq!(imported.messages[0].tokens.cache_read, 2);
        process::capture(&fixture.options()).unwrap();
        assert_eq!(fs::read(fixture.cache.join("usage.jsonl")).unwrap(), cache);
    }
    #[test]
    fn nonzero_exit_is_propagated_and_no_incomplete_snapshot_is_written() {
        let _serial = SERIAL.lock().unwrap();
        let failed = Fixture::new("exit 7");
        let outcome = process::capture(&failed.options()).unwrap();
        assert_eq!(outcome.exit_code, 7);
        assert!(!failed.cache.join("usage.jsonl").exists());
        let incomplete = Fixture::new(
            "printf '%s\\n' '{\"type\":\"message\",\"message\":{\"role\":\"assistant\",\"turnId\":\"turn\",\"timestamp\":1789779600000,\"usage\":{\"inputTokens\":11}}}'",
        );
        assert!(process::capture(&incomplete.options()).is_err());
        assert!(!incomplete.cache.join("usage.jsonl").exists());
    }
    #[test]
    fn failed_later_execution_keeps_the_last_good_history_byte_for_byte() {
        let _serial = SERIAL.lock().unwrap();
        let fixture = Fixture::new("exit 0");
        let marker = fixture.root.join("fail-next");
        let script = format!(
            "[ ! -e '{}' ] || exit 23\n{}",
            marker.display(),
            successful_script()
        );
        write_script(&fixture.executable, &script);
        process::capture(&fixture.options()).unwrap();
        let previous = fs::read(fixture.cache.join("usage.jsonl")).unwrap();
        fs::write(marker, b"synthetic failure selector").unwrap();
        let result = process::capture(&fixture.options()).unwrap();
        assert_eq!(result.exit_code, 23);
        assert_eq!(
            fs::read(fixture.cache.join("usage.jsonl")).unwrap(),
            previous
        );
    }

    #[test]
    fn changed_executable_and_corrupt_history_fail_before_another_capture() {
        let _serial = SERIAL.lock().unwrap();
        let fixture = Fixture::new(&successful_script());
        process::capture(&fixture.options()).unwrap();
        let previous = fs::read(fixture.cache.join("usage.jsonl")).unwrap();
        write_script(&fixture.executable, "exit 29");
        assert_eq!(
            process::capture(&fixture.options()).err(),
            Some("capture_executable_profile_mismatch")
        );
        assert_eq!(
            fs::read(fixture.cache.join("usage.jsonl")).unwrap(),
            previous
        );
        let other = Fixture::new(&successful_script());
        process::capture(&other.options()).unwrap();
        fs::write(other.cache.join("usage.jsonl"), "invalid\n").unwrap();
        assert_eq!(
            process::capture(&other.options()).err(),
            Some("capture_cache_invalid")
        );
    }
    #[test]
    fn timeout_and_descendant_held_pipes_are_bounded_without_incomplete_publish() {
        let _serial = SERIAL.lock().unwrap();
        let sleeping = Fixture::new("sleep 30");
        let mut options = sleeping.options();
        options.timeout = Duration::from_millis(30);
        let start = std::time::Instant::now();
        let result = process::capture(&options).unwrap();
        assert_eq!(result.exit_code, 124);
        assert!(start.elapsed() < Duration::from_secs(6));
        let held = Fixture::new(&(successful_script() + "sleep 30 &\nexit 0"));
        let start = std::time::Instant::now();
        let result = process::capture(&held.options()).unwrap();
        assert_eq!(result.exit_code, 1);
        assert!(result.summary.contains("capture_pipe_incomplete"));
        assert!(start.elapsed() < Duration::from_secs(6));
        assert!(!held.cache.join("usage.jsonl").exists());
    }
    #[test]
    #[ignore = "subprocess-only synthetic signal fixture"]
    fn signal_child_fixture() {
        let root = PathBuf::from(
            std::env::var_os("AICHARTS_CAPTURE_SIGNAL_FIXTURE_DIR")
                .expect("explicit synthetic fixture"),
        );
        let options = Options {
            cache: root.join("cache"),
            executable: root.join("fake-mcode"),
            args: prepare_args(&args(&["exec"])).unwrap(),
            timeout: Duration::from_secs(4),
        };
        let result = process::capture(&options).unwrap();
        assert_eq!(result.exit_code, 128 + libc::SIGTERM);
        assert!(result.summary.contains("capture_cancelled"));
        assert!(!root.join("cache/usage.jsonl").exists());
    }
    #[test]
    fn real_term_signal_cancels_owned_child_without_publishing() {
        use std::process::{Command, Stdio};
        let _serial = SERIAL.lock().unwrap();
        let fixture = Fixture::new("exit 0");
        let ready = fixture.root.join("capture-ready");
        write_script(
            &fixture.executable,
            &format!("printf ready > '{}'\nsleep 2", ready.display()),
        );
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "capture::tests::native::signal_child_fixture",
                "--ignored",
            ])
            .env("AICHARTS_CAPTURE_SIGNAL_FIXTURE_DIR", &fixture.root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let started = std::time::Instant::now();
        while !ready.exists() && started.elapsed() < Duration::from_secs(5) {
            if child.try_wait().unwrap().is_some() {
                panic!("signal fixture exited before readiness");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        if !ready.exists() {
            let _ = child.kill();
            let _ = child.wait();
            panic!("signal fixture not ready");
        }
        let pid = rustix::process::Pid::from_raw(i32::try_from(child.id()).unwrap()).unwrap();
        rustix::process::kill_process(pid, rustix::process::Signal::TERM).unwrap();
        loop {
            if let Some(status) = child.try_wait().unwrap() {
                assert!(
                    status.success(),
                    "signal fixture must complete through scoped cancellation"
                );
                break;
            }
            if started.elapsed() >= Duration::from_secs(6) {
                let _ = child.kill();
                let _ = child.wait();
                panic!("signal fixture did not settle");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn stderr_output_and_executable_read_limits_fail_without_cache_publication() {
        let _serial = SERIAL.lock().unwrap();
        let noisy = Fixture::new("head -c 4194305 /dev/zero >&2");
        let outcome = process::capture(&noisy.options()).unwrap();
        assert_eq!(outcome.exit_code, 1);
        assert!(outcome.summary.contains("capture_stderr_limit"));
        let invalid = Fixture::new("exit 0");
        fs::remove_file(&invalid.executable).unwrap();
        fs::create_dir(&invalid.executable).unwrap();
        assert!(process::capture(&invalid.options()).is_err());
    }
}
