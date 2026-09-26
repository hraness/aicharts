//! Golden checks for the human CLI surface: bare invocation, grouped help,
//! per-command help, version, errors per audience, NO_COLOR, TERM=dumb and
//! closed pipes (Hraness CLI style contract § D9). No test reads real usage.
use std::io::Read;
use std::process::{Command, Output, Stdio};

const AGENT_MARKERS: &[&str] = &[
    "AI_AGENT",
    "CLAUDECODE",
    "CODEX_SANDBOX",
    "CODEX_SANDBOX_NETWORK_DISABLED",
    "CURSOR_AGENT",
    "GEMINI_CLI",
    "HRANESS_AUDIENCE",
    "HRANESS_DEBUG",
    "NO_COLOR",
    "FORCE_COLOR",
    "HRANESS_ASCII",
];

fn command(args: &[&str], env: &[(&str, &str)]) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_aicharts"));
    command.args(args).current_dir(std::env::temp_dir());
    for name in AGENT_MARKERS {
        command.env_remove(name);
    }
    command
        .env("LANG", "en_US.UTF-8")
        .env("HRANESS_SUPPORT", "off")
        .env("HRANESS_SUPPORT_AUDIENCE", "off");
    for (name, value) in env {
        command.env(name, value);
    }
    command
}

fn run(args: &[&str], env: &[(&str, &str)]) -> Output {
    command(args, env).output().unwrap()
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8(bytes.to_vec()).unwrap()
}

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[test]
fn bare_invocation_is_a_short_overview() {
    let output = run(&[], &[]);
    assert_eq!(output.status.code(), Some(0));
    assert!(output.stderr.is_empty());
    let stdout = text(&output.stdout);
    assert_eq!(
        stdout,
        format!(
            "AI Charts measures your coding agents' token use on this computer.

Start here
  aicharts stats --list-clients     List the agents AI Charts can read
  aicharts stats --home ~ --all     Show the last 30 days of token use
  aicharts help publish             Publish your usage to aicharts.io

Everyday
  aicharts stats [options]          Token use by day, agent and model
  aicharts sync [options]           Collect and publish once
  aicharts status [options]         Check your local usage ledger

All commands: aicharts --help · Topics: aicharts help <topic>
aicharts {VERSION}
"
        )
    );
}

#[test]
fn root_help_forms_agree_and_exit_zero() {
    let help = run(&["--help"], &[]);
    assert_eq!(help.status.code(), Some(0));
    for form in [&["-h"][..], &["help"][..]] {
        let other = run(form, &[]);
        assert_eq!(other.status.code(), Some(0));
        assert_eq!(other.stdout, help.stdout, "{form:?}");
    }
    let stdout = text(&help.stdout);
    assert!(stdout.starts_with("Usage: aicharts <command> [options]\n"));
    assert!(stdout.lines().count() <= 60);
    assert!(stdout.contains("\nStart here\n"));
    assert!(stdout.contains("Optional support: aicharts support"));
}

#[test]
fn every_command_answers_its_own_help_with_exit_zero() {
    for command in [
        "usage",
        "upload",
        "keygen",
        "init",
        "collect",
        "collect-prefix",
        "prefix-enable",
        "upgrade",
        "status",
        "outbox",
        "inspect",
        "account",
        "enroll",
        "reindex-plan",
        "reindex-prepare",
        "daemon",
        "stats",
        "stats-health",
        "stats-sync",
        "stats-totals",
        "turns",
        "sessions",
        "sync",
        "autosubmit",
        "capture",
        "contribution-sync",
        "refresh",
    ] {
        let long = run(&[command, "--help"], &[]);
        assert_eq!(long.status.code(), Some(0), "{command}: {long:?}");
        assert!(!long.stdout.is_empty(), "{command}");
        let short = run(&[command, "-h"], &[]);
        let topic = run(&["help", command], &[]);
        assert_eq!(short.stdout, long.stdout, "{command} -h");
        assert_eq!(topic.stdout, long.stdout, "help {command}");
        assert_eq!(topic.status.code(), Some(0), "help {command}");
        // Help never repeats the whole root page.
        assert!(
            !text(&long.stdout).starts_with("Usage: aicharts <command>"),
            "{command}"
        );
    }
    let nested = run(&["help", "refresh", "cursor"], &[]);
    assert_eq!(nested.status.code(), Some(0));
    assert_eq!(
        nested.stdout,
        run(&["refresh", "cursor", "--help"], &[]).stdout
    );
}

#[test]
fn help_topics_exist_and_unknown_topics_fail_cleanly() {
    for topic in ["publish", "advanced"] {
        let output = run(&["help", topic], &[]);
        assert_eq!(output.status.code(), Some(0), "{topic}");
    }
    let missing = run(&["help", "nope"], &[("HRANESS_AUDIENCE", "human")]);
    assert_eq!(missing.status.code(), Some(2));
    assert!(missing.stdout.is_empty());
    assert_eq!(
        text(&missing.stderr),
        "✗ No help topic named \"nope\".\n→ aicharts --help\n"
    );
}

#[test]
fn version_forms_print_name_and_version() {
    for flag in ["--version", "-V"] {
        let output = run(&[flag], &[]);
        assert_eq!(output.status.code(), Some(0), "{flag}");
        assert!(text(&output.stdout).starts_with(&format!("aicharts {VERSION}")));
    }
}

#[test]
fn people_get_a_sentence_and_one_next_command() {
    let output = run(&["status"], &[("HRANESS_AUDIENCE", "human")]);
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    assert_eq!(
        text(&output.stderr),
        "✗ Missing --state-dir, the private folder that holds your AI Charts ledger.\n→ aicharts status --help\n"
    );
    let unknown = run(&["stauts"], &[("HRANESS_AUDIENCE", "human")]);
    assert_eq!(unknown.status.code(), Some(2));
    assert_eq!(
        text(&unknown.stderr),
        "✗ Unknown command \"stauts\". Did you mean \"status\"?\n→ aicharts --help\n"
    );
    let debug = run(
        &["status"],
        &[("HRANESS_AUDIENCE", "human"), ("HRANESS_DEBUG", "1")],
    );
    assert!(text(&debug.stderr).ends_with("  code: state_directory_required\n"));
}

#[test]
fn color_follows_no_color_force_color_and_dumb_terminals() {
    let forced = run(
        &["status"],
        &[("HRANESS_AUDIENCE", "human"), ("FORCE_COLOR", "1")],
    );
    assert!(text(&forced.stderr).starts_with("\x1b[31m✗\x1b[0m Missing --state-dir"));
    // Not a terminal: no color even for a person, symbols stay.
    let plain = run(
        &["status"],
        &[("HRANESS_AUDIENCE", "human"), ("NO_COLOR", "1")],
    );
    assert!(text(&plain.stderr).starts_with("✗ Missing --state-dir"));
    let dumb = run(
        &["status"],
        &[("HRANESS_AUDIENCE", "human"), ("TERM", "dumb")],
    );
    assert_eq!(
        text(&dumb.stderr),
        "FAIL Missing --state-dir, the private folder that holds your AI Charts ledger.\n-> aicharts status --help\n"
    );
}

#[test]
fn scripts_and_agents_keep_the_fixed_code_line() {
    // Not a terminal and no agent marker: the quiet audience.
    let quiet = run(&["status"], &[]);
    assert_eq!(quiet.status.code(), Some(2));
    assert_eq!(text(&quiet.stderr), "aicharts: state_directory_required\n");
    let agent = run(&["status"], &[("CLAUDECODE", "1")]);
    assert_eq!(text(&agent.stderr), "aicharts: state_directory_required\n");
    assert!(agent.stdout.is_empty());
}

#[test]
fn json_callers_keep_the_fixed_refusal() {
    let output = run(&["status", "--json"], &[("HRANESS_AUDIENCE", "human")]);
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    assert_eq!(text(&output.stderr), "aicharts: state_directory_required\n");
}

#[test]
fn a_closed_pipe_ends_help_quietly() {
    let mut child = command(&["--help"], &[])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdout = child.stdout.take().unwrap();
    let mut first = [0u8; 5];
    stdout.read_exact(&mut first).unwrap();
    drop(stdout);
    let output = child.wait_with_output().unwrap();
    assert_eq!(&first, b"Usage");
    assert_eq!(output.status.code(), Some(0));
    assert!(output.stderr.is_empty(), "{}", text(&output.stderr));
}
