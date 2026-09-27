//! `aicharts-menubar`: the AI Charts menu bar.
//!
//! It shows whether the local usage collector is working (last pass, last
//! sync, and any failures in plain words, with the error log one click
//! away), opens the usage dashboard, and lists a few recent outputs. It
//! holds no authority: it only reads the collector's status files and the
//! outputs folder.
//!
//! `aicharts-menubar install | uninstall | status | start` manage the login
//! item through desktop-foundation's shared helper. `aicharts menubar …`
//! runs the same commands.

mod health;
mod lifecycle;
mod menu;
#[cfg(test)]
mod menu_fixture;

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use desktop_foundation::browser::{BrowserOpener, BrowserStatus};
use desktop_foundation::outputs::OutputsSection;
use desktop_foundation::service::{self, InstanceLock, LoginState};
use desktop_foundation::{DispatchOutcome, Host, MenuModel, Options, RenderError};

use health::Health;
use lifecycle::Product;

const PRODUCT: Product = Product {
    app_id: menu::APP_ID,
    name: menu::NAME,
    command: "aicharts",
    binary: "aicharts-menubar",
    version: env!("CARGO_PKG_VERSION"),
};

const DASHBOARD_URL: &str = "https://aicharts.io/usage";
const SETUP_URL: &str = "https://github.com/hraness/aicharts/blob/main/docs/usage-local.md";
const SUPPORT_URL: &str = "https://account.hraness.com/support?product=aicharts&source=desktop";
/// How long a failed action stays on screen as a ⚠︎ row.
const ACTION_ERROR_SECONDS: u64 = 60;

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

/// The outputs folder: `AICHARTS_OUTPUTS`, `--outputs <dir>`, or the
/// menu bar's own folder in Application Support.
fn outputs_dir(home: Option<&PathBuf>) -> Option<PathBuf> {
    if let Some(value) = std::env::var_os("AICHARTS_OUTPUTS").filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(value));
    }
    let args: Vec<String> = std::env::args().collect();
    if let Some(dir) = args
        .iter()
        .position(|arg| arg == "--outputs")
        .and_then(|index| args.get(index + 1))
    {
        return Some(PathBuf::from(dir));
    }
    home.map(|home| lifecycle::state_dir(home, &PRODUCT).join("outputs"))
}

struct AiChartsHost {
    outputs: OutputsSection,
    browser: BrowserOpener,
    /// `~/.aicharts`, where the collector writes its status.
    collector_home: Option<PathBuf>,
    /// The user's home, for the login item.
    home: Option<PathBuf>,
    executable: Option<PathBuf>,
    action_error: Mutex<Option<(String, Instant)>>,
}

impl AiChartsHost {
    fn health(&self) -> Health {
        self.collector_home
            .as_deref()
            .map(Health::read)
            .unwrap_or_default()
    }

    fn login_plan(&self) -> Option<service::LaunchAgentPlan> {
        let item = lifecycle::login_item(&PRODUCT, self.executable.clone()?);
        service::plan(&item, self.home.as_deref()?).ok()
    }

    fn login_on(&self) -> bool {
        self.login_plan().is_some_and(|plan| {
            matches!(
                service::login_state(&plan),
                LoginState::On | LoginState::Outdated | LoginState::NotOurs
            )
        })
    }

    fn fail(&self, message: &str) -> DispatchOutcome {
        *self
            .action_error
            .lock()
            .unwrap_or_else(|error| error.into_inner()) =
            Some((message.to_owned(), Instant::now()));
        DispatchOutcome::Rejected
    }

    fn current_action_error(&self) -> Option<String> {
        if let BrowserStatus::Failed(_) = self.browser.status() {
            return Some("Couldn't open your browser".to_owned());
        }
        let mut slot = self
            .action_error
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        match slot.as_ref() {
            Some((message, when)) if when.elapsed() < Duration::from_secs(ACTION_ERROR_SECONDS) => {
                Some(message.clone())
            }
            _ => {
                *slot = None;
                None
            }
        }
    }

    fn open(&self, address: &str) -> DispatchOutcome {
        match self.browser.open(address) {
            Ok(()) => DispatchOutcome::Accepted,
            Err(_) => self.fail("Couldn't open your browser"),
        }
    }

    fn open_error_log(&self, reveal: bool) -> DispatchOutcome {
        let Some(path) = self
            .collector_home
            .as_ref()
            .map(|home| home.join(health::ERROR_LOG))
        else {
            return self.fail("Couldn't find the error log");
        };
        if !std::fs::symlink_metadata(&path).is_ok_and(|meta| meta.is_file()) {
            return self.fail("Couldn't find the error log");
        }
        let mut command = std::process::Command::new("/usr/bin/open");
        if reveal {
            command.arg("-R");
        }
        let spawned = command
            .arg(&path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
        match spawned {
            Ok(mut child) => {
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
                DispatchOutcome::Accepted
            }
            Err(_) => self.fail("Couldn't open the error log"),
        }
    }

    fn copy_diagnostics(&self) -> DispatchOutcome {
        let text = menu::diagnostics(&self.health(), PRODUCT.version, SystemTime::now());
        let child = std::process::Command::new("/usr/bin/pbcopy")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
        let Ok(mut child) = child else {
            return self.fail("Couldn't copy diagnostics");
        };
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            let _ = stdin.write_all(text.as_bytes());
        }
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        DispatchOutcome::Accepted
    }

    fn toggle_login(&self) -> DispatchOutcome {
        let Some(plan) = self.login_plan() else {
            return self.fail("Couldn't change Open at login");
        };
        let result = if self.login_on() {
            service::uninstall(&plan)
        } else {
            service::install(&plan)
        };
        match result {
            Ok(_) => DispatchOutcome::Accepted,
            Err(_) => self.fail("Couldn't change Open at login"),
        }
    }
}

impl Host for AiChartsHost {
    fn snapshot(&self) -> MenuModel {
        let health = self.health();
        let action_error = self.current_action_error();
        menu::build(menu::View {
            health: &health,
            outputs: self.outputs.nodes(),
            login_on: self.login_on(),
            action_error: action_error.as_deref(),
            now: SystemTime::now(),
        })
    }

    fn dispatch_result(&self, id: &str) -> DispatchOutcome {
        match id {
            menu::DASHBOARD => self.open(DASHBOARD_URL),
            menu::SETUP_GUIDE => self.open(SETUP_URL),
            menu::SUPPORT => self.open(SUPPORT_URL),
            menu::ERRORS_OPEN => self.open_error_log(false),
            menu::ERRORS_REVEAL => self.open_error_log(true),
            menu::DIAGNOSTICS => self.copy_diagnostics(),
            menu::LOGIN => self.toggle_login(),
            _ if self.outputs.dispatch(id) => DispatchOutcome::Accepted,
            _ => DispatchOutcome::Rejected,
        }
    }

    fn render_failed(&self, error: RenderError) {
        eprintln!("aicharts-menubar: render failed: {error:?}");
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(code) = lifecycle::main(PRODUCT, &args, BTreeMap::new()) {
        std::process::exit(code);
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|home| home.is_absolute());
    let glyphs = lifecycle::glyphs(&env);
    let _instance = match home.as_ref() {
        Some(home) => {
            match InstanceLock::acquire(&lifecycle::state_dir(home, &PRODUCT), PRODUCT.app_id) {
                Ok(Some(lock)) => Some(lock),
                Ok(None) => {
                    eprint!("{}", lifecycle::already_running(&PRODUCT, glyphs));
                    std::process::exit(service::EXIT_ALREADY_RUNNING);
                }
                Err(_) => None,
            }
        }
        None => None,
    };
    let Some(dir) = outputs_dir(home.as_ref()) else {
        eprintln!("✗ Couldn't find the outputs folder.\n→ aicharts-menubar --help");
        std::process::exit(2);
    };
    let _ = std::fs::create_dir_all(&dir);
    let host = Arc::new(AiChartsHost {
        outputs: OutputsSection::new(dir).with_limit(menu::OUTPUTS_LIMIT),
        browser: BrowserOpener::new(),
        collector_home: health::aicharts_home(&env),
        home,
        executable: std::env::current_exe().ok(),
        action_error: Mutex::new(None),
    });
    let options = Options {
        refresh: Duration::from_secs(10),
        companion_window: false,
    };
    if let Err(error) = desktop_foundation::run(tauri::generate_context!(), host, options, |b| b) {
        eprintln!("aicharts-menubar: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::health::{CollectorStatus, FailureCount, LastCycle, Pass, Step};
    use std::time::UNIX_EPOCH;

    const NOW: u64 = 1_790_000_000;

    fn now() -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(NOW)
    }

    fn collector(
        ago: u64,
        ok: bool,
        error: Option<&str>,
        failures: &[(&str, u32)],
    ) -> CollectorStatus {
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
            "published"
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

    fn outputs(count: usize) -> (Vec<desktop_foundation::MenuNode>, PathBuf) {
        static SEQ: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "aicharts-menubar-outputs-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        for index in 0..count {
            std::fs::write(dir.join(format!("chart {index}.csv")), vec![b'x'; 2048]).unwrap();
            std::thread::sleep(Duration::from_millis(15));
        }
        let nodes = OutputsSection::new(&dir)
            .with_limit(menu::OUTPUTS_LIMIT)
            .nodes();
        (nodes, dir)
    }

    fn fixture(
        state: &str,
        health: Health,
        outputs_count: usize,
        login_on: bool,
        action_error: Option<&str>,
    ) {
        let (outputs, dir) = outputs(outputs_count);
        let model = menu::build(menu::View {
            health: &health,
            outputs,
            login_on,
            action_error,
            now: now(),
        });
        menu_fixture::check(state, &model, menu::APP_ID, menu::NAME);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn menu_first_run() {
        fixture("first-run", Health::default(), 0, false, None);
    }

    #[test]
    fn menu_running() {
        let health = Health {
            collector: Some(collector(240, true, None, &[])),
            cycle: Some(cycle(3_000, &[])),
            error_log: true,
        };
        fixture("running", health, 3, true, None);
    }

    #[test]
    fn menu_error() {
        let health = Health {
            collector: Some(collector(
                300,
                false,
                Some("ledger_source_history_changed"),
                &[("ledger_source_history_changed", 7)],
            )),
            cycle: Some(cycle(3_000, &[("cursor", "stats_sync_request_refused")])),
            error_log: true,
        };
        fixture("error", health, 3, true, None);
    }

    #[test]
    fn menu_partial() {
        let health = Health {
            collector: Some(collector(
                240,
                true,
                None,
                &[("source_byte_limit", 3), ("ledger_busy_retry", 1)],
            )),
            cycle: Some(cycle(3_000, &[])),
            error_log: true,
        };
        fixture("partial", health, 1, true, None);
    }

    #[test]
    fn menu_stopped() {
        let health = Health {
            collector: Some(collector(5 * 3_600, true, None, &[])),
            cycle: None,
            error_log: false,
        };
        fixture("stopped", health, 0, false, None);
    }

    #[test]
    fn menu_empty() {
        let health = Health {
            collector: Some(collector(60, true, None, &[])),
            cycle: None,
            error_log: false,
        };
        fixture("empty", health, 0, true, None);
    }

    #[test]
    fn menu_action_error() {
        let health = Health {
            collector: Some(collector(240, true, None, &[])),
            cycle: Some(cycle(3_000, &[])),
            error_log: false,
        };
        fixture(
            "action-error",
            health,
            3,
            true,
            Some("Couldn't open your browser"),
        );
    }

    #[test]
    fn menu_signed_out_publisher_only() {
        // An older collector without a status file: only publishing results.
        let health = Health {
            collector: None,
            cycle: Some(cycle(
                7_300,
                &[
                    ("cursor", "stats_sync_request_refused"),
                    ("claude", "network_unavailable"),
                ],
            )),
            error_log: true,
        };
        fixture("publish-only", health, 0, false, None);
    }

    #[test]
    fn worst_case_stays_within_ten_rows() {
        let health = Health {
            collector: Some(collector(300, true, None, &[("source_byte_limit", 2)])),
            cycle: Some(cycle(3_000, &[("cursor", "stats_sync_request_refused")])),
            error_log: true,
        };
        let (outputs, dir) = outputs(9);
        let model = menu::build(menu::View {
            health: &health,
            outputs,
            login_on: true,
            action_error: Some("Couldn't open your browser"),
            now: now(),
        });
        let rows = model
            .nodes
            .iter()
            .filter(|node| {
                !matches!(
                    node,
                    desktop_foundation::MenuNode::Separator
                        | desktop_foundation::MenuNode::Header { .. }
                )
            })
            .count();
        assert!(rows <= 10, "{rows} rows");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn unknown_actions_are_rejected_without_opening_anything() {
        let host = AiChartsHost {
            outputs: OutputsSection::new("/dev/null/absent-outputs"),
            browser: BrowserOpener::new(),
            collector_home: None,
            home: None,
            executable: None,
            action_error: Mutex::new(None),
        };
        assert!(matches!(
            host.dispatch_result("unknown.action"),
            DispatchOutcome::Rejected
        ));
        assert_eq!(host.browser.status(), BrowserStatus::Idle);
        // Without a home folder the login toggle fails visibly.
        assert!(matches!(
            host.dispatch_result(menu::LOGIN),
            DispatchOutcome::Rejected
        ));
        assert_eq!(
            host.current_action_error().as_deref(),
            Some("Couldn't change Open at login")
        );
        let model = host.snapshot();
        assert!(model.nodes.iter().any(|node| matches!(node,
            desktop_foundation::MenuNode::Status { title, .. } if title == "Couldn't change Open at login")));
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
        let text = menu::diagnostics(&health, "0.2.0", now());
        assert!(text.contains("source_byte_limit"));
        assert!(text.contains("stats_sync_request_refused"));
        assert!(!text.contains('/'));
    }
}
