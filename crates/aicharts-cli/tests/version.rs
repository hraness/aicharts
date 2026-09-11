//! Version identity uses only compiler metadata, never local usage or keys.
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
};

const PRIVATE: &str = "PRIVATE_VERSION_CANARY_861c";

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let mut random = [0; 16];
        getrandom::fill(&mut random).unwrap();
        let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let path = std::env::temp_dir().join(format!("aicharts-version-{suffix}"));
        let builder = fs::DirBuilder::new();
        #[cfg(unix)]
        let builder = {
            use std::os::unix::fs::DirBuilderExt;
            let mut builder = builder;
            builder.mode(0o700);
            builder
        };
        builder.create(&path).unwrap();
        Self(path)
    }

    fn write(&self, name: &str) {
        let mut options = fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options
            .open(self.0.join(name))
            .unwrap()
            .write_all(PRIVATE.as_bytes())
            .unwrap();
    }

    fn run(&self, args: &[&str]) -> Output {
        let output = Command::new(env!("CARGO_BIN_EXE_aicharts"))
            .current_dir(&self.0)
            .env_clear()
            .env("CARGO_PKG_VERSION", PRIVATE)
            .env("AICHARTS_BUILD_SHA", PRIVATE)
            .env("AICHARTS_BUILD_TARGET", PRIVATE)
            .env("AICHARTS_RELEASE_QUALIFIED", "true")
            .args(args)
            .stdin(Stdio::null())
            .output()
            .unwrap();
        for bytes in [&output.stdout, &output.stderr] {
            assert!(!String::from_utf8_lossy(bytes).contains(PRIVATE));
            assert!(!String::from_utf8_lossy(bytes).contains(&*self.0.to_string_lossy()));
        }
        output
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

// This checks writes/replacements; ordinary access-time changes are excluded.
// The identity path's absence of reads is additionally a direct source invariant.
#[derive(Debug, PartialEq, Eq)]
struct Entry {
    bytes: Vec<u8>,
    #[cfg(unix)]
    metadata: [u64; 7],
}

fn snapshot(path: &Path) -> BTreeMap<PathBuf, Entry> {
    fs::read_dir(path)
        .unwrap()
        .map(|entry| {
            let entry = entry.unwrap();
            let metadata = entry.metadata().unwrap();
            assert!(metadata.is_file());
            #[cfg(unix)]
            let observation = {
                use std::os::unix::fs::MetadataExt;
                [
                    metadata.dev(),
                    metadata.ino(),
                    u64::from(metadata.mode()),
                    metadata.mtime() as u64,
                    metadata.mtime_nsec() as u64,
                    metadata.ctime() as u64,
                    metadata.ctime_nsec() as u64,
                ]
            };
            (
                entry.file_name().into(),
                Entry {
                    bytes: fs::read(entry.path()).unwrap(),
                    #[cfg(unix)]
                    metadata: observation,
                },
            )
        })
        .collect()
}

#[test]
fn version_text_needs_no_runtime_environment_or_initialized_state() {
    let fixture = Fixture::new();
    let output = fixture.run(&["--version"]);
    assert_eq!(output.status.code(), Some(0));
    assert_eq!(
        output.stdout,
        format!("aicharts {}\n", env!("CARGO_PKG_VERSION")).as_bytes()
    );
    assert!(output.stderr.is_empty());
    assert!(snapshot(&fixture.0).is_empty());
}

#[test]
fn json_identity_is_exact_and_cannot_be_qualified_by_runtime_environment() {
    let fixture = Fixture::new();
    for name in [
        "private.key",
        "codex.jsonl",
        "ledger.sqlite",
        "ledger.sqlite-journal",
    ] {
        fixture.write(name);
    }
    let before = snapshot(&fixture.0);
    let output = fixture.run(&["--version", "--json"]);
    assert_eq!(output.status.code(), Some(0));
    assert!(output.stderr.is_empty());
    assert!(output.stdout.len() < 512);
    assert!(output.stdout.ends_with(b"\n"));
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&output.stdout).unwrap(),
        serde_json::json!({
            "schemaVersion": 1,
            "operation": "version",
            "version": env!("CARGO_PKG_VERSION"),
            "build": {
                "os": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
                "sourceCommit": null,
            },
            "provenance": "unverified",
        })
    );
    assert_eq!(snapshot(&fixture.0), before);
}

#[test]
fn extra_reordered_and_command_mixed_version_flags_refuse_before_data_io() {
    let fixture = Fixture::new();
    for name in ["private.key", "codex.jsonl", "ledger.sqlite-journal"] {
        fixture.write(name);
    }
    let before = snapshot(&fixture.0);
    let cases: &[&[&str]] = &[
        &["--json", "--version"],
        &["--version", "--json", "--json"],
        &["--version", "--version"],
        &["--version", "--help"],
        &["--help", "--version"],
        &["--version", "--key-file", "private.key"],
        &["--version", "--json", "--codex", "codex.jsonl"],
        &["keygen", "--output", "must-not-exist.key", "--version"],
        &["keygen", "--output", "--version"],
        &[
            "init",
            "--state-dir",
            "must-not-exist",
            "--key-file",
            "private.key",
            "--version",
        ],
        &[
            "collect",
            "--state-dir",
            ".",
            "--key-file",
            "private.key",
            "--codex",
            "codex.jsonl",
            "--version",
        ],
        &[
            "inspect",
            "--state-dir",
            ".",
            "--key-file",
            "private.key",
            "--version",
        ],
        &[
            "upload",
            "--dry-run",
            "--key-file",
            "private.key",
            "--codex",
            "codex.jsonl",
            "--version",
        ],
    ];
    for args in cases {
        let output = fixture.run(args);
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        assert_eq!(output.stderr, b"aicharts: invalid_version_arguments\n");
        assert_eq!(snapshot(&fixture.0), before);
    }
}

#[test]
fn ordinary_help_remains_local_only_without_any_identity_side_effect() {
    let fixture = Fixture::new();
    for args in [&[][..], &["--help"][..], &["-h"][..]] {
        let output = fixture.run(args);
        assert_eq!(output.status.code(), Some(0));
        let text = String::from_utf8(output.stdout).unwrap();
        assert!(text.contains("local-only"));
        assert!(text.contains("No account sign-in, upload, daemon"));
        assert!(output.stderr.is_empty());
    }
    assert!(snapshot(&fixture.0).is_empty());
}
