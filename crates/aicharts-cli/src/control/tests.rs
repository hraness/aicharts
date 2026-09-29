use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::*;
use crate::health::{CollectorStatus, FailureCount, LastCycle, Pass, Step};

/// 2026-09-21T14:13:20Z, the clock every golden is rendered at.
const NOW: u64 = 1_790_000_000;

fn now() -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(NOW)
}

fn collector(ago: u64, ok: bool, error: Option<&str>, failures: &[(&str, u32)]) -> CollectorStatus {
    CollectorStatus {
        schema_version: 1,
        updated_at: NOW - ago,
        interval_seconds: 900,
        last_pass: Pass {
            at: NOW - ago,
            ok,
            error: error.map(str::to_owned),
        },
        last_success_at: ok.then_some(NOW - ago),
        recent_failures: failures
            .iter()
            .map(|(code, count)| FailureCount {
                code: (*code).into(),
                count: *count,
            })
            .collect(),
        recent_passes: 96,
    }
}

fn cycle(ago: u64, failed: &[(&str, &str)]) -> (LastCycle, SystemTime) {
    let mut steps = vec![Step {
        action: "publish".into(),
        client: Some("codex".into()),
        status: "published".into(),
        error: None,
    }];
    steps.extend(failed.iter().map(|(client, error)| Step {
        action: "publish".into(),
        client: Some((*client).into()),
        status: "failed".into(),
        error: Some((*error).into()),
    }));
    let status = if failed.is_empty() {
        "complete"
    } else {
        "partial_failure"
    };
    (
        LastCycle {
            schema_version: 1,
            status: status.into(),
            dry_run: false,
            steps,
        },
        UNIX_EPOCH + Duration::from_secs(NOW - ago),
    )
}

fn outputs(count: u64) -> OutputsData {
    let files: Vec<OutputFile> = (0..count.min(NEWEST_OUTPUTS as u64))
        .map(|index| {
            let modified = now() - Duration::from_secs(600 * (index + 1));
            OutputFile {
                name: format!("chart {}.csv", count - 1 - index),
                bytes: 2048,
                modified_at: iso(modified),
                modified,
            }
        })
        .collect();
    OutputsData {
        folder: "/Users/you/Library/Application Support/AI Charts/outputs".into(),
        total: count,
        files,
    }
}

fn legacy(ours: bool) -> Vec<LoginItem> {
    vec![LoginItem {
        label: "app.hraness.aicharts".into(),
        path: "/Users/you/Library/LaunchAgents/app.hraness.aicharts.plist".into(),
        ours,
    }]
}

const ERROR_LOG_PATH: &str = "/Users/you/.aicharts/daemon.err.log";

/// The retired menu bar's fixture states, as `status` now shows them.
fn fixtures() -> Vec<(&'static str, Health, OutputsData, Vec<LoginItem>)> {
    let running = || Health {
        collector: Some(collector(240, true, None, &[])),
        cycle: Some(cycle(3_000, &[])),
        error_log: false,
    };
    vec![
        ("first-run", Health::default(), outputs(0), Vec::new()),
        (
            "running",
            Health {
                error_log: true,
                ..running()
            },
            outputs(3),
            Vec::new(),
        ),
        (
            "error",
            Health {
                collector: Some(collector(
                    300,
                    false,
                    Some("ledger_source_history_changed"),
                    &[("ledger_source_history_changed", 7)],
                )),
                cycle: Some(cycle(3_000, &[("cursor", "stats_sync_request_refused")])),
                error_log: true,
            },
            outputs(3),
            Vec::new(),
        ),
        (
            "partial",
            Health {
                collector: Some(collector(
                    240,
                    true,
                    None,
                    &[("source_byte_limit", 3), ("ledger_busy_retry", 1)],
                )),
                cycle: Some(cycle(3_000, &[])),
                error_log: true,
            },
            outputs(1),
            Vec::new(),
        ),
        (
            "stopped",
            Health {
                collector: Some(collector(5 * 3_600, true, None, &[])),
                cycle: None,
                error_log: false,
            },
            outputs(0),
            Vec::new(),
        ),
        (
            "empty",
            Health {
                collector: Some(collector(60, true, None, &[])),
                cycle: None,
                error_log: false,
            },
            outputs(0),
            Vec::new(),
        ),
        (
            "publish-only",
            Health {
                collector: None,
                cycle: Some(cycle(
                    7_300,
                    &[
                        ("cursor", "stats_sync_request_refused"),
                        ("claude", "network_unavailable"),
                    ],
                )),
                error_log: true,
            },
            outputs(0),
            Vec::new(),
        ),
        ("many-outputs", running(), outputs(9), Vec::new()),
        ("legacy-login-item", running(), outputs(0), legacy(true)),
        (
            "legacy-login-not-ours",
            running(),
            outputs(0),
            legacy(false),
        ),
    ]
}

fn build(health: &Health, outputs: OutputsData, items: Vec<LoginItem>) -> Envelope<StatusData> {
    let error_log = PathBuf::from(ERROR_LOG_PATH);
    let data = status_data(
        health,
        outputs,
        health.error_log.then_some(error_log.as_path()),
        items,
        now(),
    );
    next_steps(&data)
        .into_iter()
        .fold(Envelope::ok(STATUS_SCHEMA, data), Envelope::with_next)
        .at(now())
}

fn json<T: Serialize>(envelope: &Envelope<T>) -> String {
    let mut out = Vec::new();
    envelope::emit(&mut out, envelope);
    String::from_utf8(out).unwrap()
}

fn snapshot_of(envelope: &Envelope<StatusData>, width: u16) -> String {
    match envelope {
        Envelope::Ok { data, .. } => snapshot(data, width, now()),
        Envelope::Err { .. } => unreachable!(),
    }
}

fn rendered() -> Vec<(String, String)> {
    let mut files = Vec::new();
    for (name, health, outputs, items) in fixtures() {
        let envelope = build(&health, outputs, items);
        for width in [40u16, 80, 120] {
            files.push((
                format!("{name}.w{width}.txt"),
                snapshot_of(&envelope, width),
            ));
        }
        files.push((format!("{name}.json"), json(&envelope)));
    }
    files
}

fn golden_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/status")
}

#[test]
fn snapshots_and_json_match_the_goldens() {
    let dir = golden_dir();
    let update = std::env::var_os("AICHARTS_UPDATE_GOLDENS").is_some();
    if update {
        std::fs::create_dir_all(&dir).unwrap();
    }
    let mut stale = Vec::new();
    for (name, text) in rendered() {
        let path = dir.join(&name);
        if update {
            std::fs::write(&path, &text).unwrap();
        } else if std::fs::read_to_string(&path).ok().as_deref() != Some(text.as_str()) {
            stale.push(format!("{name}:\n{text}"));
        }
    }
    assert!(
        stale.is_empty(),
        "goldens differ (AICHARTS_UPDATE_GOLDENS=1 cargo test -p aicharts-cli control):\n{}",
        stale.join("\n")
    );
}

#[test]
fn snapshots_fit_their_width_and_carry_no_trailing_space() {
    for (name, text) in rendered() {
        let Some(width) = name
            .split(".w")
            .nth(1)
            .and_then(|rest| rest.strip_suffix(".txt"))
            .and_then(|w| w.parse::<usize>().ok())
        else {
            continue;
        };
        for line in text.lines() {
            assert!(line.chars().count() <= width, "{name}: {line}");
            assert_eq!(line, line.trim_end(), "{name}");
        }
    }
}

#[test]
fn status_carries_no_account_or_session_content() {
    for (name, text) in rendered() {
        for forbidden in ["accountId", "sessionId", "prompt", "--key-file"] {
            assert!(!text.contains(forbidden), "{name}: {forbidden}");
        }
    }
}

#[test]
fn attention_follows_codes_that_need_a_person() {
    let states: Vec<(&str, bool, &str)> = fixtures()
        .into_iter()
        .map(
            |(name, health, outputs, items)| match build(&health, outputs, items) {
                Envelope::Ok { data, .. } => (name, data.attention, data.state),
                Envelope::Err { .. } => unreachable!(),
            },
        )
        .collect();
    for (name, attention, state) in states {
        let expected = matches!(name, "error" | "partial" | "stopped" | "publish-only");
        assert_eq!(attention, expected, "{name} ({state})");
    }
}

#[test]
fn next_steps_point_at_real_verbs() {
    let registry = registry();
    for (name, health, outputs, items) in fixtures() {
        let Envelope::Ok { next, .. } = build(&health, outputs, items) else {
            unreachable!()
        };
        for step in next {
            let words: Vec<&str> = step
                .command
                .split_whitespace()
                .skip(1)
                .take_while(|word| !word.starts_with('-'))
                .collect();
            let known =
                registry.lookup(&words).is_some() || matches!(words.first(), Some(&"setup"));
            assert!(known, "{name}: {}", step.command);
        }
    }
}

#[test]
fn a_legacy_login_item_that_is_ours_suggests_retire() {
    let health = Health {
        collector: Some(collector(240, true, None, &[])),
        cycle: None,
        error_log: false,
    };
    let data = status_data(&health, outputs(0), None, legacy(true), now());
    assert!(next_steps(&data)
        .iter()
        .any(|step| step.command == "aicharts doctor retire"));
    let data = status_data(&health, outputs(0), None, legacy(false), now());
    assert!(next_steps(&data).is_empty());
}

// --- Registry and parity --------------------------------------------------

#[test]
fn registry_lists_every_dispatched_verb() {
    let registry = registry();
    let listed: Vec<String> = registry.verbs().iter().map(|v| v.command()).collect();
    for verb in [
        "status",
        "tui",
        "commands",
        "doctor",
        "doctor retire",
        "open",
        "diagnostics",
        "outputs",
        "outputs open",
        "outputs reveal",
        "service status",
        "service install",
        "service uninstall",
    ] {
        assert!(listed.iter().any(|v| v == verb), "{verb}");
    }
    let value = serde_json::to_value(registry.commands_json()).unwrap();
    assert_eq!(value["schema"], "hraness.commands/1");
    // Plan grammar: the login item is persistent configuration, so
    // install and uninstall are `decide` behind T1+T2. D-14 keeps
    // `decide-legacy` for three other products' verbs only.
    for verb in registry.verbs() {
        let command = verb.command();
        let gated = matches!(command.as_str(), "service install" | "service uninstall");
        assert_ne!(verb.op_class, OpClass::DecideLegacy, "{command}");
        if gated {
            assert_eq!(verb.op_class, OpClass::Decide, "{command}");
            assert_eq!(verb.gate, Some(GateTier::T1T2), "{command}");
        } else {
            assert!(verb.gate.is_none(), "{command}");
        }
    }
    let listed = value["data"]["verbs"].as_array().unwrap();
    let install = listed
        .iter()
        .find(|verb| verb["path"] == serde_json::json!(["service", "install"]))
        .unwrap();
    assert_eq!(install["opClass"], "decide");
}

// --- Human gate ----------------------------------------------------------

fn markers(agent: bool) -> gate::AgentMarkers {
    gate::AgentMarkers {
        agent,
        markers: if agent {
            vec!["env:CLAUDECODE".into()]
        } else {
            vec![]
        },
    }
}

#[test]
fn decide_verbs_refuse_agents_and_json_without_prompting() {
    use hraness_cli_kit::Audience as Who;
    let registry = registry();
    let install = registry.lookup(&["service", "install"]).unwrap();
    let command = "aicharts service install --claude /c";
    // `--json` from an agent or a script, and any run with agent markers,
    // stop before the prompt with `human-required` and a person's command.
    for (json, who, agent) in [
        (true, Who::Agent, false),
        (true, Who::Quiet, false),
        (false, Who::Human, true),
        (false, Who::Agent, true),
        (true, Who::Human, true),
    ] {
        let error = unattended_refusal(&registry, install, json, who, &markers(agent), command)
            .unwrap_or_else(|| panic!("{json} {who:?} {agent}"));
        assert_eq!(error.code, ErrorCode::HumanRequired);
        assert_eq!(Envelope::<()>::error(error.clone()).exit_code(), 3);
        assert_eq!(error.next[0].command, command);
        assert_eq!(error.next[0].audience, Audience::Human);
    }
    // A person, or a script with no agent markers, goes on to T1+T2,
    // which itself refuses when there is no terminal.
    for (json, who) in [(false, Who::Human), (true, Who::Human), (false, Who::Agent)] {
        assert!(
            unattended_refusal(&registry, install, json, who, &markers(false), command).is_none()
        );
    }
}

#[test]
fn the_person_gets_the_command_without_json() {
    let args: Vec<String> = [
        "service",
        "install",
        "--json",
        "--claude",
        "/Users/me/my projects",
    ]
    .iter()
    .map(|arg| arg.to_string())
    .collect();
    assert_eq!(
        command_for_person(&args),
        "aicharts service install --claude '/Users/me/my projects'"
    );
}

/// Every action the retired menu bar offered, and the verb that replaces it.
const MENU_PARITY: &[(&str, &str)] = &[
    ("dashboard", "open dashboard"),
    ("setup.guide", "open setup-guide"),
    ("errors.open", "open error-log"),
    ("errors.reveal", "open error-log --reveal"),
    ("outputs.open.fileN", "outputs open"),
    ("outputs.reveal.fileN", "outputs reveal"),
    ("outputs.folder", "open outputs"),
    ("outputs.all", "outputs --all"),
    ("login", "service install"),
    ("support", "open support"),
    ("support.diagnostics", "diagnostics"),
    ("status", "status"),
];

#[test]
fn every_menu_action_has_a_verb_and_a_parity_row() {
    let registry = registry();
    let parity = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs/cli-parity.md"),
    )
    .expect("docs/cli-parity.md");
    for (action, command) in MENU_PARITY {
        let words: Vec<&str> = command
            .split_whitespace()
            .take_while(|word| !word.starts_with('-'))
            .collect();
        // `open dashboard` is the `open` verb with a target.
        let verb = registry
            .lookup(&words)
            .or_else(|| registry.lookup(&words[..1]));
        assert!(verb.is_some(), "{action} → {command}");
        assert!(parity.contains(&format!("`{action}`")), "{action}");
        assert!(
            parity.contains(&format!("`aicharts {command}")),
            "{command}"
        );
    }
}

// --- TUI clock ------------------------------------------------------------

#[test]
fn the_outputs_view_reads_the_clock_when_it_draws() {
    // The interactive TUI stays open: ages must follow the clock at render
    // time, not the moment it launched.
    use std::cell::Cell;
    use std::rc::Rc;
    let clock = Rc::new(Cell::new(now()));
    let reader = Rc::clone(&clock);
    let views = views(Box::new(move || reader.get()));
    let outputs_view = views.iter().find(|view| view.id() == "outputs").unwrap();
    let Envelope::Ok { data, .. } = build(&Health::default(), outputs(1), vec![]) else {
        unreachable!()
    };
    let first = tui::render_to_string(outputs_view.as_ref(), &data, 80);
    assert!(first.contains("10 min ago"), "{first}");
    clock.set(now() + Duration::from_secs(3_600));
    let later = tui::render_to_string(outputs_view.as_ref(), &data, 80);
    assert!(later.contains("1 hour ago"), "{later}");
    // A file written after launch is still only minutes old, not "just now"
    // forever and not in the future.
    let mut fresh = outputs(1);
    fresh.files[0].modified = now() + Duration::from_secs(1_800);
    let data = StatusData {
        outputs: fresh,
        ..data
    };
    let fresh_text = tui::render_to_string(outputs_view.as_ref(), &data, 80);
    assert!(fresh_text.contains("30 min ago"), "{fresh_text}");
}

// --- Legacy login items ---------------------------------------------------

fn temp_home(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "aicharts-control-{name}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(dir.join("Library/LaunchAgents")).unwrap();
    dir
}

fn plist(program: &str) -> String {
    format!(
        "<?xml version=\"1.0\"?>\n<plist version=\"1.0\"><dict><key>Label</key><string>app.hraness.aicharts</string><key>ProgramArguments</key><array><string>{program}</string></array></dict></plist>\n"
    )
}

const MENUBAR_PROGRAM: &str =
    "/Users/you/Library/Application Support/AI Charts/bin/aicharts-menubar";

#[test]
fn only_the_retired_menu_bar_counts_as_ours() {
    assert!(launches_menubar(&plist(MENUBAR_PROGRAM)));
    assert!(launches_menubar(&plist(
        "/Users/you/Applications/Hraness/AI Charts.app/Contents/MacOS/AI Charts"
    )));
    assert!(!launches_menubar(&plist("/usr/local/bin/aicharts")));
    assert!(!launches_menubar(&plist("/opt/aicharts-menubar-helper")));
    assert!(!launches_menubar("aicharts-menubar"));
}

#[test]
fn retire_renames_ours_and_leaves_everything_else() {
    let home = temp_home("retire");
    let agents = home.join("Library/LaunchAgents");
    std::fs::write(
        agents.join("app.hraness.aicharts.plist"),
        plist(MENUBAR_PROGRAM),
    )
    .unwrap();
    std::fs::write(
        agents.join("app.hraness.companion.aicharts.plist"),
        plist("/usr/local/bin/something-else"),
    )
    .unwrap();
    std::fs::write(
        agents.join("io.aicharts.daemon.plist"),
        plist(MENUBAR_PROGRAM),
    )
    .unwrap();
    let booted = std::cell::RefCell::new(Vec::new());
    let retired = retire_login_items(&home, current_uid(), 42, &|label| {
        booted.borrow_mut().push(label.to_owned())
    })
    .unwrap();
    assert_eq!(retired.len(), 1);
    assert_eq!(*booted.borrow(), vec!["app.hraness.aicharts".to_owned()]);
    assert!(!agents.join("app.hraness.aicharts.plist").exists());
    let kept = agents.join("app.hraness.aicharts.plist.retired-42");
    assert_eq!(
        std::fs::read_to_string(&kept).unwrap(),
        plist(MENUBAR_PROGRAM)
    );
    assert!(retired[0].restore.starts_with("mv "));
    assert!(retired[0]
        .restore
        .contains("launchctl bootstrap gui/$(id -u)"));
    // Not ours, and the collector's own service: untouched.
    assert!(agents.join("app.hraness.companion.aicharts.plist").exists());
    assert!(agents.join("io.aicharts.daemon.plist").exists());
    // Running again does nothing.
    let again = retire_login_items(&home, current_uid(), 43, &|_| panic!("no bootout")).unwrap();
    assert!(again.is_empty());
    assert_eq!(retired_items(&home).len(), 1);
    std::fs::remove_dir_all(home).unwrap();
}

#[test]
fn retire_refuses_to_overwrite_an_earlier_copy() {
    let home = temp_home("conflict");
    let agents = home.join("Library/LaunchAgents");
    std::fs::write(
        agents.join("app.hraness.aicharts.plist"),
        plist(MENUBAR_PROGRAM),
    )
    .unwrap();
    std::fs::write(
        agents.join("app.hraness.aicharts.plist.retired-7"),
        "earlier",
    )
    .unwrap();
    let error = retire_login_items(&home, current_uid(), 7, &|_| panic!("no bootout")).unwrap_err();
    assert_eq!(error.code, ErrorCode::Conflict);
    assert!(agents.join("app.hraness.aicharts.plist").exists());
    assert_eq!(
        std::fs::read_to_string(agents.join("app.hraness.aicharts.plist.retired-7")).unwrap(),
        "earlier"
    );
    std::fs::remove_dir_all(home).unwrap();
}

#[cfg(unix)]
#[test]
fn retire_leaves_symlinks_and_other_owners_alone() {
    let home = temp_home("symlink");
    let agents = home.join("Library/LaunchAgents");
    let target = home.join("elsewhere.plist");
    std::fs::write(&target, plist(MENUBAR_PROGRAM)).unwrap();
    std::os::unix::fs::symlink(&target, agents.join("app.hraness.aicharts.plist")).unwrap();
    let retired = retire_login_items(&home, current_uid(), 1, &|_| panic!("no bootout")).unwrap();
    assert!(retired.is_empty());
    assert!(!find_login_items(&home, current_uid())[0].ours);
    std::fs::remove_file(agents.join("app.hraness.aicharts.plist")).unwrap();
    std::fs::write(
        agents.join("app.hraness.aicharts.plist"),
        plist(MENUBAR_PROGRAM),
    )
    .unwrap();
    let other = current_uid().map(|uid| uid.wrapping_add(1));
    let retired = retire_login_items(&home, other, 1, &|_| panic!("no bootout")).unwrap();
    assert!(retired.is_empty());
    assert!(agents.join("app.hraness.aicharts.plist").exists());
    std::fs::remove_dir_all(home).unwrap();
}

#[test]
fn shell_quote_keeps_paths_with_spaces_whole() {
    assert_eq!(shell_quote("/a/b.plist"), "/a/b.plist");
    assert_eq!(shell_quote("/a b/c"), "'/a b/c'");
    assert_eq!(shell_quote("it's"), "'it'\\''s'");
}

// --- Outputs, diagnostics and arguments ------------------------------------

#[test]
fn outputs_list_newest_first_and_skip_hidden_files_and_folders() {
    let home = temp_home("outputs");
    let folder = home.join("outputs");
    std::fs::create_dir_all(folder.join("folder")).unwrap();
    std::fs::write(folder.join(".DS_Store"), "x").unwrap();
    for name in ["a.csv", "b.csv", "c.csv"] {
        std::fs::write(folder.join(name), "x").unwrap();
        std::thread::sleep(Duration::from_millis(20));
    }
    let listed = list_outputs(&folder, 2);
    assert_eq!(listed.total, 3);
    let names: Vec<&str> = listed.files.iter().map(|file| file.name.as_str()).collect();
    assert_eq!(names, ["c.csv", "b.csv"]);
    assert_eq!(list_outputs(&home.join("missing"), 5).total, 0);
    std::fs::remove_dir_all(home).unwrap();
}

#[test]
fn diagnostics_carry_codes_but_no_paths() {
    let health = Health {
        collector: Some(collector(
            300,
            false,
            Some("source_byte_limit"),
            &[("source_byte_limit", 2)],
        )),
        cycle: Some(cycle(3_000, &[("cursor", "stats_sync_request_refused")])),
        error_log: true,
    };
    let text = diagnostics_text(&health, "0.2.0", now());
    assert!(text.starts_with("aicharts 0.2.0\n"));
    assert!(text.contains("source_byte_limit"));
    assert!(text.contains("stats_sync_request_refused"));
    assert!(!text.contains('/'));
}

#[test]
fn ledger_flags_keep_the_older_status() {
    let words = |values: &[&str]| values.iter().map(|v| (*v).to_owned()).collect::<Vec<_>>();
    assert!(!is_ledger_status(&words(&[])));
    assert!(!is_ledger_status(&words(&["--json"])));
    assert!(is_ledger_status(&words(&["--state-dir", "s"])));
    assert!(is_ledger_status(&words(&["--key-file", "k", "--json"])));
    assert!(dispatch(&words(&["status", "--state-dir", "s"])).is_none());
    assert!(dispatch(&words(&["stats"])).is_none());
}

#[test]
fn flags_are_checked() {
    let words = |values: &[&str]| values.iter().map(|v| (*v).to_owned()).collect::<Vec<_>>();
    assert_eq!(
        parse(&words(&["--width", "19"]), "tui", &["--width"])
            .unwrap_err()
            .code,
        ErrorCode::Usage
    );
    assert_eq!(
        parse(&words(&["--width", "120"]), "tui", &["--width"])
            .unwrap()
            .width,
        Some(120)
    );
    assert_eq!(
        parse(&words(&["--snapshot"]), "status", &["--json"])
            .unwrap_err()
            .code,
        ErrorCode::Usage
    );
}
