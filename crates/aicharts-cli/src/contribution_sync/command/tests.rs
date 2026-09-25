use super::*;

fn args(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| (*part).into()).collect()
}

#[test]
fn command_requires_one_explicit_action_and_its_exact_options() {
    for (action, expected) in [
        ("--inspect", Command::Inspect),
        ("--resume", Command::Resume),
        ("--cancel", Command::Cancel),
    ] {
        let parsed = options(&args(&[
            "contribution-sync",
            action,
            "--state-dir",
            "/private/state",
            "--key-file",
            "/private/key",
        ]))
        .unwrap();
        assert_eq!(parsed.command, expected);
        assert_eq!(parsed.directory, Path::new("/private/state"));
        assert!(parsed.population.is_none());
        assert!(parsed.source.is_none());
    }
    let population = "1".repeat(64);
    let initialize = options(&args(&[
        "contribution-sync",
        "--initialize",
        "--state-dir",
        "/private/state",
        "--key-file",
        "/private/key",
        "--population-id",
        &population,
    ]))
    .unwrap();
    assert_eq!(initialize.command, Command::Initialize);
    assert_eq!(initialize.population.as_deref(), Some(population.as_str()));
    let send = options(&args(&[
        "contribution-sync",
        "--send",
        "--state-dir",
        "/private/state",
        "--key-file",
        "/private/key",
        "--population-id",
        &population,
        "--claude",
        "/private/source.jsonl",
    ]))
    .unwrap();
    assert_eq!(send.command, Command::Send);
    assert_eq!(
        send.source
            .as_ref()
            .map(|(provider, path)| (*provider, path.as_path())),
        Some((
            aicharts_protocol::Provider::ClaudeCode,
            Path::new("/private/source.jsonl")
        ))
    );
    assert_eq!(send.max_batches, 1);
    let codex = options(&args(&[
        "contribution-sync",
        "--send",
        "--state-dir",
        "/private/state",
        "--key-file",
        "/private/key",
        "--population-id",
        &population,
        "--codex",
        "/private/rollout.jsonl",
        "--max-batches",
        "8",
    ]))
    .unwrap();
    assert_eq!(
        codex
            .source
            .as_ref()
            .map(|(provider, path)| (*provider, path.as_path())),
        Some((
            aicharts_protocol::Provider::Codex,
            Path::new("/private/rollout.jsonl")
        ))
    );
    assert_eq!(codex.max_batches, MAX_BATCHES);
    for (count, ok) in [
        ("1", true),
        ("8", true),
        ("0", false),
        ("9", false),
        ("01", false),
        ("x", false),
    ] {
        let parsed = options(&args(&[
            "contribution-sync",
            "--send",
            "--state-dir",
            "/private/state",
            "--key-file",
            "/private/key",
            "--population-id",
            &population,
            "--claude",
            "/private/source.jsonl",
            "--max-batches",
            count,
        ]));
        assert_eq!(parsed.is_ok(), ok, "{count}");
    }
    // Two sources, or draining outside --send, are refused before any effect.
    assert!(options(&args(&[
        "contribution-sync",
        "--send",
        "--state-dir",
        "/private/state",
        "--key-file",
        "/private/key",
        "--population-id",
        &population,
        "--claude",
        "/private/source.jsonl",
        "--codex",
        "/private/rollout.jsonl",
    ]))
    .is_err());
    assert!(options(&args(&[
        "contribution-sync",
        "--resume",
        "--state-dir",
        "/private/state",
        "--key-file",
        "/private/key",
        "--max-batches",
        "2",
    ]))
    .is_err());
}

#[test]
fn incomplete_duplicate_foreign_and_implicit_activation_arguments_fail_before_effects() {
    let base = args(&[
        "contribution-sync",
        "--inspect",
        "--state-dir",
        "/private/state",
        "--key-file",
        "/private/key",
    ]);
    for suffix in [
        vec!["--send"],
        vec!["--inspect"],
        vec!["--state-dir", "/private/other"],
        vec!["--key-file", "/private/other"],
        vec!["--population-id", &"1".repeat(64)],
        vec!["--claude", "/private/source"],
        vec!["--activate"],
        vec!["--token", "secret"],
        vec!["--url", "https://example.invalid"],
    ] {
        let mut input = base.clone();
        input.extend(suffix.into_iter().map(String::from));
        assert!(options(&input).is_err());
    }
    for input in [
        args(&[]),
        args(&["sync", "--inspect"]),
        args(&["contribution-sync"]),
        args(&[
            "contribution-sync",
            "--send",
            "--state-dir",
            "/private/state",
            "--key-file",
            "/private/key",
        ]),
        args(&["contribution-sync", "--inspect", "--state-dir"]),
    ] {
        assert!(options(&input).is_err());
    }
    for population in ["0".repeat(64), "A".repeat(64), "1".repeat(63)] {
        assert!(options(&args(&[
            "contribution-sync",
            "--initialize",
            "--state-dir",
            "/private/state",
            "--key-file",
            "/private/key",
            "--population-id",
            &population
        ]))
        .is_err());
    }
}

#[test]
fn paths_are_bounded_literal_absolute_names_and_help_needs_no_files() {
    for value in [
        "",
        "/",
        "relative",
        "/private/../key",
        "/private/./key",
        "/private//key",
        "/private/key/",
        "/private/\0key",
    ] {
        assert!(path(value).is_err(), "{value:?}");
    }
    assert!(path(&format!("/{}", "x".repeat(256))).is_err());
    assert!(path(&format!("/{}", vec!["x"; 65].join("/"))).is_err());
    assert!(path(&format!("/{}", vec!["x"; 64].join("/"))).is_ok());
    let help = run(&args(&["contribution-sync", "--help"])).unwrap();
    assert!(help.contains("--inspect"));
    assert!(help.contains("Coverage remains partial"));
    assert!(help.contains("explicit and opt-in"));
}

#[cfg(target_os = "macos")]
#[test]
fn inspect_opens_only_existing_checkpoint_and_never_initializes_missing_state() {
    use std::{fs, os::unix::fs::PermissionsExt};
    struct Scratch(PathBuf);
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    let directory = fs::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "aicharts-contribution-command-{}",
            std::process::id()
        ));
    fs::create_dir(&directory).unwrap();
    let _scratch = Scratch(directory.clone());
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
    let key = [0xa4; 32];
    assert!(local_inspect(&directory, &key).is_err());
    assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);
    let batch = crate::contribution_sync::tests::batch(1, 12, 4);
    let binding = crate::contribution_sync::Binding::from_scope(&batch.scope());
    drop(
        crate::contribution_sync::Outbox::initialize(
            &directory,
            &key,
            &binding,
            &crate::contribution_sync::tests::progress(&batch),
        )
        .unwrap(),
    );
    let before = fs::read(directory.join("contribution-sync-v3.current")).unwrap();
    let result: serde_json::Value =
        serde_json::from_str(&local_inspect(&directory, &key).unwrap()).unwrap();
    assert_eq!(result["scope"], "local-checkpoint");
    assert_eq!(result["remoteState"], "not_observed");
    assert_eq!(result["lastSequence"], 0);
    assert!(result["flight"].is_null());
    assert_eq!(
        fs::read(directory.join("contribution-sync-v3.current")).unwrap(),
        before
    );
    assert_eq!(fs::read_dir(&directory).unwrap().count(), 2);
}

#[cfg(target_os = "macos")]
#[test]
fn retained_outcomes_distinguish_committed_cancellation_race_from_abandonment_and_floor() {
    use crate::contribution_sync::{
        tests::{batch, committed_reply, frozen, reply},
        RetainedTerminal,
    };
    let original = batch(1, 12, 4);
    for (proof, outcome, revision) in [
        (committed_reply(&original).proof, "committed", 13),
        (reply(&original, 15).proof, "abandoned", 15),
    ] {
        let mut checkpoint = frozen();
        checkpoint.last_sequence = 1;
        checkpoint.last_revision = 15;
        checkpoint.flight.as_mut().unwrap().action = crate::contribution_sync::Action::Cancel {
            expected_revision: 14,
        };
        checkpoint.terminal = Some(RetainedTerminal {
            flight: checkpoint.flight.take().unwrap(),
            proof,
        });
        checkpoint.validate().unwrap();
        let terminal = retained_terminal(&checkpoint).unwrap().unwrap();
        assert_eq!(terminal["outcome"], outcome);
        assert_eq!(terminal["terminalRevision"], revision);
        assert_eq!(terminal["sequence"], 1);
        assert_eq!(terminal["operationId"], original.operation_id());
        assert_eq!(terminal["bodyHash"], original.body_hash());
    }
}
