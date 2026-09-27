//! The AI Charts menu on menu kit v2: collector health at the top, one
//! primary action, a few recent outputs, then login, support and Quit.
//! Pure: every input is passed in, so each state has a fixture.

use std::time::SystemTime;

use desktop_foundation::{
    Alternate, ItemState, MarkTone, MenuItem, MenuModel, MenuNode, Opens, StatusMark, Symbol,
};

use crate::health::{ago, explain, needs_person, Collector, Health, Problem};

pub const NAME: &str = "AI Charts";
pub const APP_ID: &str = "aicharts";

pub const DASHBOARD: &str = "dashboard";
pub const SETUP_GUIDE: &str = "setup.guide";
pub const ERRORS_OPEN: &str = "errors.open";
pub const ERRORS_REVEAL: &str = "errors.reveal";
pub const LOGIN: &str = "login";
pub const SUPPORT: &str = "support";
pub const DIAGNOSTICS: &str = "support.diagnostics";

/// Recent outputs shown in the menu. Two keeps the worst case (two status
/// rows and the error log row) within ten top-level rows.
pub const OUTPUTS_LIMIT: usize = 2;
const MAX_DETAIL: usize = 80;

/// Everything one menu depends on.
pub struct View<'a> {
    pub health: &'a Health,
    pub outputs: Vec<MenuNode>,
    pub login_on: bool,
    /// A failed menu action, shown as a ⚠︎ row until it expires.
    pub action_error: Option<&'a str>,
    pub now: SystemTime,
}

fn detail(text: String, fallback: impl FnOnce() -> String) -> String {
    if text.chars().count() <= MAX_DETAIL {
        text
    } else {
        fallback()
    }
}

fn first_row(view: &View) -> (Symbol, String, Option<String>, MarkTone) {
    let synced = view.health.last_sync().map(|when| ago(when, view.now));
    match view.health.collector_state(view.now) {
        Collector::NotSetUp => (
            Symbol::StatusIdle,
            "Not set up on this Mac".into(),
            Some("Set up publishing to see your usage here".into()),
            MarkTone::Normal,
        ),
        Collector::Unknown => (
            Symbol::StatusRunning,
            "Publishing".into(),
            synced.map(|when| format!("Last sync {when}")),
            MarkTone::Normal,
        ),
        Collector::Collecting { last } => {
            let pass = format!("Last pass {}", ago(last, view.now));
            let text = match synced {
                Some(when) => format!("{pass} · last sync {when}"),
                None => pass.clone(),
            };
            (
                Symbol::StatusRunning,
                "Collecting".into(),
                Some(detail(text, || pass)),
                MarkTone::Normal,
            )
        }
        Collector::Failing { code, last } => {
            let reason = explain(&code).trim_end_matches('.').to_owned();
            let text = format!("{reason} · {}", ago(last, view.now));
            // A failure the next pass retries on its own gets a row, not a dot.
            let tone = if needs_person(&code) {
                MarkTone::Attention
            } else {
                MarkTone::Normal
            };
            (
                Symbol::StatusAttention,
                "Last pass didn't finish".into(),
                Some(detail(text, || reason)),
                tone,
            )
        }
        Collector::Stopped { last } => (
            Symbol::StatusOffline,
            "Collector isn't running".into(),
            Some(format!("Last pass {}", ago(last, view.now))),
            MarkTone::Offline,
        ),
    }
}

/// The second status row: a failed action first, then publishing, then
/// recent collection failures.
fn second_row(view: &View, first_failing: bool) -> Option<Problem> {
    if let Some(error) = view.action_error {
        return Some(Problem {
            label: error.to_owned(),
            detail: "Try again".into(),
            code: String::new(),
        });
    }
    view.health.sync_problem(view.now).or_else(|| {
        (!first_failing)
            .then(|| view.health.recent_failures())
            .flatten()
    })
}

pub fn build(view: View) -> MenuModel {
    let (symbol, label, first_detail, mut tone) = first_row(&view);
    let failing = symbol == Symbol::StatusAttention;
    let not_set_up = label == "Not set up on this Mac";
    let tooltip = format!("{NAME} · {label}");
    let mut nodes = vec![
        MenuNode::header(NAME),
        MenuNode::status(symbol, label, first_detail),
    ];
    let problem = second_row(&view, failing);
    if let Some(problem) = &problem {
        nodes.push(MenuNode::status(
            Symbol::StatusAttention,
            problem.label.clone(),
            Some(problem.detail.clone()),
        ));
        if tone == MarkTone::Normal && !problem.code.is_empty() && needs_person(&problem.code) {
            tone = MarkTone::Attention;
        }
    }
    nodes.push(MenuNode::Separator);
    nodes.push(MenuNode::interactive(if not_set_up {
        MenuItem::action(SETUP_GUIDE, "Set up publishing")
            .with_symbol(Symbol::ActionHelp)
            .opens(Opens::Browser)
            .primary()
    } else {
        MenuItem::action(DASHBOARD, "Open usage dashboard")
            .with_symbol(Symbol::ActionOpen)
            .with_shortcut("CmdOrCtrl+O")
            .opens(Opens::Browser)
            .primary()
    }));
    nodes.push(MenuNode::Separator);
    nodes.extend(view.outputs);
    nodes.push(MenuNode::Separator);
    let has_problem = failing
        || problem
            .as_ref()
            .is_some_and(|problem| !problem.code.is_empty());
    if view.health.error_log && has_problem {
        nodes.push(MenuNode::interactive(
            MenuItem::action(ERRORS_OPEN, "Show error log")
                .with_symbol(Symbol::ActionHelp)
                .with_alternate(
                    Alternate::new(ERRORS_REVEAL, "Show error log in Finder")
                        .with_symbol(Symbol::ActionFolder),
                ),
        ));
    }
    let login = MenuItem::state(
        LOGIN,
        "Open at login",
        if view.login_on {
            ItemState::On
        } else {
            ItemState::Off
        },
    );
    nodes.push(MenuNode::interactive(if view.login_on {
        login
    } else {
        login.with_subtitle("macOS shows a notice when you turn this on")
    }));
    nodes.push(MenuNode::Separator);
    nodes.push(MenuNode::interactive(
        MenuItem::action(SUPPORT, "Updates & support")
            .with_symbol(Symbol::ActionSupport)
            .opens(Opens::Browser)
            .with_alternate(
                Alternate::new(DIAGNOSTICS, "Copy diagnostics").with_symbol(Symbol::ActionCopy),
            ),
    ));
    nodes.push(MenuNode::interactive(
        MenuItem::action(desktop_foundation::QUIT_ACTION_ID, format!("Quit {NAME}"))
            .with_shortcut("CmdOrCtrl+Q"),
    ));
    let mut model = MenuModel {
        tooltip: Some(tooltip),
        nodes,
        ..MenuModel::default()
    };
    model.set_mark(StatusMark::new(Symbol::MarkChart, "Ac").with_tone(tone));
    model
}

/// Plain-text diagnostics for "Copy diagnostics": version and fixed codes,
/// never paths, account IDs or session content.
pub fn diagnostics(health: &Health, version: &str, now: SystemTime) -> String {
    let mut lines = vec![format!("AI Charts menu bar {version}")];
    lines.push(format!(
        "Collector: {}",
        match health.collector_state(now) {
            Collector::NotSetUp => "not set up".to_owned(),
            Collector::Unknown => "no status file".to_owned(),
            Collector::Collecting { last } => format!("collecting, last pass {}", ago(last, now)),
            Collector::Failing { code, last } =>
                format!("failing ({code}), last pass {}", ago(last, now)),
            Collector::Stopped { last } => format!("stopped, last pass {}", ago(last, now)),
        }
    ));
    if let Some(status) = &health.collector {
        for failure in &status.recent_failures {
            lines.push(format!(
                "Recent failure: {} × {}",
                failure.code, failure.count
            ));
        }
    }
    if let Some((cycle, _)) = &health.cycle {
        lines.push(format!("Last publish: {}", cycle.status));
        for step in cycle.steps.iter().filter(|step| step.status == "failed") {
            lines.push(format!(
                "Failed: {} {}",
                step.client.as_deref().unwrap_or("-"),
                step.error.as_deref().unwrap_or("-")
            ));
        }
    }
    lines.join("\n") + "\n"
}
