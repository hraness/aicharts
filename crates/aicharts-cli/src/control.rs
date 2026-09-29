//! The agent-navigable surface: `status`, `tui`, `commands`, `doctor`,
//! `doctor retire`, `open` and `outputs`, on desktop-foundation's control
//! kit. Every former menu bar item is one verb here (docs/cli-parity.md).
//!
//! The collector daemon (`aicharts daemon`, run by `aicharts service`) is
//! the owner. Nothing here starts, stops or signals it: these verbs read the
//! files it writes (`collector-status.json`, `autosubmit-runtime/
//! last-cycle.json`), open fixed pages, and set aside the retired menu bar's
//! login item by renaming it. They never read session content, account
//! identifiers or the ledger.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use hraness_control_kit::envelope::{self, Envelope};
use hraness_control_kit::gate;
use hraness_control_kit::registry::{GateTier, OpClass, Registry, Verb};
use hraness_control_kit::tui::{
    self,
    ratatui::{layout::Rect, text::Line, widgets::Paragraph, Frame},
    RunOptions, View,
};
use hraness_control_kit::{Audience, ErrorBody, ErrorCode, NextStep};
use serde::Serialize;

use crate::health::{self, ago, client_name, explain, needs_person, Collector, Health};

pub(crate) const PRODUCT: &str = "aicharts";
pub(crate) const STATUS_SCHEMA: &str = "aicharts.status/1";
pub(crate) const DOCTOR_SCHEMA: &str = "aicharts.doctor/1";
pub(crate) const RETIRE_SCHEMA: &str = "aicharts.retire/1";
pub(crate) const OPEN_SCHEMA: &str = "aicharts.open/1";
pub(crate) const OUTPUTS_SCHEMA: &str = "aicharts.outputs/1";
pub(crate) const DIAGNOSTICS_SCHEMA: &str = "aicharts.diagnostics/1";

pub(crate) const DASHBOARD_URL: &str = "https://aicharts.io/usage";
pub(crate) const SETUP_URL: &str =
    "https://github.com/hraness/aicharts/blob/main/docs/usage-local.md";
pub(crate) const SUPPORT_URL: &str =
    "https://account.hraness.com/support?product=aicharts&source=cli";

/// Login item labels the retired menu bar wrote through desktop-foundation
/// (`app.hraness.<appId>`, and the older companion label).
const LEGACY_LABELS: [&str; 2] = ["app.hraness.aicharts", "app.hraness.companion.aicharts"];
/// The retired menu bar's executable, as `bun run menubar:install` placed it.
const LEGACY_PROGRAM: &str = "aicharts-menubar";
/// The same binary inside the local app desktop-foundation assembled.
const LEGACY_APP_PROGRAM: &str = "/AI Charts.app/Contents/MacOS/AI Charts";
const MAX_LOGIN_ITEM_BYTES: u64 = 64 * 1024;
const NEWEST_OUTPUTS: usize = 5;
const MAX_OUTPUTS_LISTED: usize = 500;

// ---------------------------------------------------------------------------
// Registry

/// Every verb and its operation class. `commands --json` prints this.
pub(crate) fn registry() -> Registry {
    let verbs = vec![
        Verb::new(
            &["status"],
            OpClass::Read,
            STATUS_SCHEMA,
            "Collector and publishing health; with --state-dir, the local ledger",
        ),
        Verb::new(
            &["tui"],
            OpClass::Read,
            STATUS_SCHEMA,
            "The same health in a terminal view (--snapshot, --json)",
        ),
        Verb::new(
            &["commands"],
            OpClass::Read,
            hraness_control_kit::registry::COMMANDS_SCHEMA,
            "Every verb with its operation class",
        ),
        Verb::new(
            &["doctor"],
            OpClass::Read,
            DOCTOR_SCHEMA,
            "Collector files, the background collector and retired login items",
        ),
        Verb::new(
            &["doctor", "retire"],
            OpClass::Operate,
            RETIRE_SCHEMA,
            "Set aside the retired menu bar's login item (renamed, never deleted)",
        ),
        Verb::new(
            &["open"],
            OpClass::Operate,
            OPEN_SCHEMA,
            "Open the usage dashboard, setup guide, support page, error log or outputs",
        ),
        Verb::new(
            &["diagnostics"],
            OpClass::Read,
            DIAGNOSTICS_SCHEMA,
            "Version and error codes to paste into a support request",
        ),
        Verb::new(
            &["outputs"],
            OpClass::Read,
            OUTPUTS_SCHEMA,
            "The outputs folder and its newest files",
        ),
        Verb::new(
            &["outputs", "open"],
            OpClass::Operate,
            OPEN_SCHEMA,
            "Open one output file",
        ),
        Verb::new(
            &["outputs", "reveal"],
            OpClass::Operate,
            OPEN_SCHEMA,
            "Show one output file in Finder",
        ),
        Verb::new(
            &["service", "status"],
            OpClass::Read,
            "aicharts.service-status/1",
            "Whether the background collector is installed and running",
        ),
        Verb::new(
            &["service", "install"],
            OpClass::Decide,
            "aicharts.service-install/1",
            "Run the collector at login (macOS shows a notice)",
        )
        .gated(GateTier::T1T2),
        Verb::new(
            &["service", "uninstall"],
            OpClass::Decide,
            "aicharts.service-uninstall/1",
            "Stop running the collector at login",
        )
        .gated(GateTier::T1T2),
        Verb::new(
            &["support"],
            OpClass::Read,
            "aicharts.support/1",
            "Updates and optional support",
        ),
    ];
    let mut registry = Registry::new(PRODUCT);
    for verb in verbs {
        registry
            .register(verb)
            .expect("the aicharts registry is valid");
    }
    registry
}

// ---------------------------------------------------------------------------
// Status data

/// Everything `status`, `tui` and `status --json` show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StatusData {
    /// `not-set-up`, `publishing`, `collecting`, `failing` or `stopped`.
    pub(crate) state: &'static str,
    /// One line, such as "Collecting".
    pub(crate) headline: String,
    pub(crate) detail: Option<String>,
    /// Something here needs a person (the old menu bar's dot).
    pub(crate) attention: bool,
    pub(crate) collector: Option<CollectorData>,
    pub(crate) publishing: Option<PublishingData>,
    /// Problems worth a ⚠︎ line, most important first.
    pub(crate) problems: Vec<ProblemData>,
    /// The collector's error log, when it exists.
    pub(crate) error_log: Option<String>,
    pub(crate) outputs: OutputsData,
    pub(crate) links: Links,
    /// Login items left by the retired menu bar.
    pub(crate) legacy_login_items: Vec<LoginItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CollectorData {
    pub(crate) last_pass_at: String,
    pub(crate) last_pass_ok: bool,
    pub(crate) error: Option<String>,
    pub(crate) interval_seconds: u64,
    pub(crate) updated_at: String,
    pub(crate) recent_failures: Vec<FailureData>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FailureData {
    pub(crate) code: String,
    pub(crate) count: u32,
    pub(crate) explanation: &'static str,
    pub(crate) needs_person: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublishingData {
    /// `complete`, `partial_failure`, ... from `last-cycle.json`.
    pub(crate) status: String,
    pub(crate) synced_at: String,
    pub(crate) failed: Vec<FailedStep>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FailedStep {
    pub(crate) client: Option<String>,
    pub(crate) agent: Option<String>,
    pub(crate) code: Option<String>,
    pub(crate) explanation: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProblemData {
    pub(crate) title: String,
    pub(crate) detail: String,
    pub(crate) code: String,
    pub(crate) needs_person: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Links {
    pub(crate) dashboard: &'static str,
    pub(crate) setup_guide: &'static str,
    pub(crate) support: &'static str,
}

const LINKS: Links = Links {
    dashboard: DASHBOARD_URL,
    setup_guide: SETUP_URL,
    support: SUPPORT_URL,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OutputsData {
    pub(crate) folder: String,
    /// Regular files in the folder (not counting hidden ones).
    pub(crate) total: u64,
    /// The newest files first.
    pub(crate) files: Vec<OutputFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OutputFile {
    pub(crate) name: String,
    pub(crate) bytes: u64,
    pub(crate) modified_at: String,
    #[serde(skip)]
    pub(crate) modified: SystemTime,
}

fn iso(at: SystemTime) -> String {
    let offset = time::OffsetDateTime::from(at);
    offset
        .replace_nanosecond(0)
        .unwrap_or(offset)
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

/// Builds the status for `health` at `now`. Pure, for goldens.
pub(crate) fn status_data(
    health: &Health,
    outputs: OutputsData,
    error_log: Option<&Path>,
    legacy_login_items: Vec<LoginItem>,
    now: SystemTime,
) -> StatusData {
    let synced = health.last_sync().map(|when| ago(when, now));
    let (state, headline, detail, mut attention) = match health.collector_state(now) {
        Collector::NotSetUp => (
            "not-set-up",
            "Not set up on this Mac".to_owned(),
            Some("Set up publishing to see your usage here".to_owned()),
            false,
        ),
        Collector::Unknown => (
            "publishing",
            "Publishing".to_owned(),
            synced.as_ref().map(|when| format!("Last sync {when}")),
            false,
        ),
        Collector::Collecting { last } => {
            let pass = format!("Last pass {}", ago(last, now));
            (
                "collecting",
                "Collecting".to_owned(),
                Some(match &synced {
                    Some(when) => format!("{pass} · last sync {when}"),
                    None => pass,
                }),
                false,
            )
        }
        Collector::Failing { code, last } => (
            "failing",
            "Last pass didn't finish".to_owned(),
            Some(format!(
                "{} · {}",
                explain(&code).trim_end_matches('.'),
                ago(last, now)
            )),
            needs_person(&code),
        ),
        Collector::Stopped { last } => (
            "stopped",
            "Collector isn't running".to_owned(),
            Some(format!("Last pass {}", ago(last, now))),
            true,
        ),
    };
    let mut problems = Vec::new();
    if let Some(problem) = health.sync_problem(now) {
        problems.push(problem);
    }
    if state != "failing" {
        if let Some(problem) = health.recent_failures() {
            problems.push(problem);
        }
    }
    let problems: Vec<ProblemData> = problems
        .into_iter()
        .map(|problem| ProblemData {
            needs_person: needs_person(&problem.code),
            title: problem.label,
            detail: problem.detail,
            code: problem.code,
        })
        .collect();
    attention |= problems.iter().any(|problem| problem.needs_person);
    let collector = health.collector.as_ref().map(|status| CollectorData {
        last_pass_at: iso(health::at(status.last_pass.at)),
        last_pass_ok: status.last_pass.ok,
        error: status.last_pass.error.clone(),
        interval_seconds: status.interval_seconds,
        updated_at: iso(health::at(status.updated_at)),
        recent_failures: status
            .recent_failures
            .iter()
            .map(|failure| FailureData {
                code: failure.code.clone(),
                count: failure.count,
                explanation: explain(&failure.code),
                needs_person: needs_person(&failure.code),
            })
            .collect(),
    });
    let publishing = health.cycle.as_ref().map(|(cycle, when)| PublishingData {
        status: cycle.status.clone(),
        synced_at: iso(*when),
        failed: cycle
            .steps
            .iter()
            .filter(|step| step.status == "failed")
            .map(|step| FailedStep {
                agent: step.client.as_deref().map(client_name),
                client: step.client.clone(),
                code: step.error.clone(),
                explanation: explain(step.error.as_deref().unwrap_or("")),
            })
            .collect(),
    });
    StatusData {
        state,
        headline,
        detail,
        attention,
        collector,
        publishing,
        problems,
        error_log: error_log.map(|path| path.display().to_string()),
        outputs,
        links: LINKS,
        legacy_login_items,
    }
}

/// What to run next for `data`, most useful first.
pub(crate) fn next_steps(data: &StatusData) -> Vec<NextStep> {
    let mut next = Vec::new();
    match data.state {
        "not-set-up" => next.push(NextStep::new(
            "aicharts setup",
            "Set up collection and publishing on this Mac",
            Audience::Human,
        )),
        "stopped" => next.push(NextStep::new(
            "aicharts service status",
            "Check whether the background collector is installed",
            Audience::Agent,
        )),
        _ => {}
    }
    if data.error_log.is_some() && (data.state == "failing" || !data.problems.is_empty()) {
        next.push(NextStep::new(
            "aicharts open error-log",
            "Read the collector's error log",
            Audience::Human,
        ));
    }
    if data.legacy_login_items.iter().any(|item| item.ours) {
        next.push(NextStep::new(
            "aicharts doctor retire",
            "Set aside the retired menu bar's login item",
            Audience::Agent,
        ));
    }
    next
}

// ---------------------------------------------------------------------------
// Text and TUI

fn fit(text: &str, width: usize) -> String {
    if text.chars().count() <= width {
        return text.to_owned();
    }
    let mut out: String = text.chars().take(width.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Word-wraps `text` to `width`, indenting continuation lines by `indent`.
fn wrap(text: &str, width: usize, indent: usize) -> Vec<String> {
    let width = width.max(indent + 8);
    let mut lines = Vec::new();
    let mut line = String::new();
    for word in text.split_whitespace() {
        let limit = if lines.is_empty() {
            width
        } else {
            width - indent
        };
        if !line.is_empty() && line.chars().count() + 1 + word.chars().count() > limit {
            lines.push(std::mem::take(&mut line));
        }
        if !line.is_empty() {
            line.push(' ');
        }
        line.push_str(word);
    }
    if !line.is_empty() || lines.is_empty() {
        lines.push(line);
    }
    lines
        .into_iter()
        .enumerate()
        .map(|(index, line)| {
            let prefix = if index == 0 {
                String::new()
            } else {
                " ".repeat(indent)
            };
            fit(&format!("{prefix}{line}"), width)
        })
        .collect()
}

fn mark(data: &StatusData) -> &'static str {
    match data.state {
        "not-set-up" => "○",
        "failing" => "⚠︎",
        "stopped" => "✗",
        _ => "●",
    }
}

/// `status` and the TUI's Status view.
pub(crate) fn status_lines(data: &StatusData, width: u16) -> Vec<String> {
    let width = usize::from(width.max(20));
    let mut lines = vec![if data.attention {
        "aicharts · needs you".to_owned()
    } else {
        "aicharts".to_owned()
    }];
    lines.extend(wrap(
        &format!(
            "{} {}{}",
            mark(data),
            data.headline,
            data.detail
                .as_ref()
                .map(|detail| format!(" · {detail}"))
                .unwrap_or_default()
        ),
        width,
        2,
    ));
    for problem in &data.problems {
        lines.extend(wrap(
            &format!("⚠︎ {} · {}", problem.title, problem.detail),
            width,
            2,
        ));
    }
    lines.push(String::new());
    lines.push(fit("Usage dashboard  aicharts open dashboard", width));
    if data.error_log.is_some() {
        lines.push(fit("Error log        aicharts open error-log", width));
    }
    if data.outputs.total > 0 {
        lines.push(fit(
            &format!("Outputs ({})      aicharts outputs", data.outputs.total),
            width,
        ));
    }
    if data.state == "not-set-up" {
        lines.push(fit("Setup guide      aicharts open setup-guide", width));
    }
    lines.push(fit("Support          aicharts open support", width));
    for item in data.legacy_login_items.iter().filter(|item| item.ours) {
        lines.push(String::new());
        lines.extend(wrap(
            &format!(
                "The retired menu bar still opens at login ({}). aicharts doctor retire sets it aside.",
                item.label
            ),
            width,
            0,
        ));
    }
    lines
}

fn size(bytes: u64) -> String {
    match bytes {
        0..=999 => format!("{bytes} B"),
        1_000..=999_499 => format!("{} KB", (bytes + 500) / 1_000),
        999_500..=999_999 => "1.0 MB".to_owned(),
        1_000_000..=999_949_999 => format!("{:.1} MB", bytes as f64 / 1e6),
        _ => format!("{:.1} GB", bytes as f64 / 1e9),
    }
}

/// The TUI's Outputs view and `outputs` text.
pub(crate) fn outputs_lines(outputs: &OutputsData, width: u16, now: SystemTime) -> Vec<String> {
    let width = usize::from(width.max(20));
    let mut lines = vec![fit(&format!("Outputs · {}", outputs.folder), width)];
    if outputs.files.is_empty() {
        lines.push("No outputs yet.".to_owned());
        return lines;
    }
    for file in &outputs.files {
        lines.push(fit(
            &format!(
                "{} · {} · {}",
                file.name,
                size(file.bytes),
                ago(file.modified, now)
            ),
            width,
        ));
    }
    if outputs.total > outputs.files.len() as u64 {
        lines.push(fit(
            &format!(
                "and {} more · aicharts outputs --all",
                outputs.total - outputs.files.len() as u64
            ),
            width,
        ));
    }
    lines
}

struct StatusView;
/// The wall clock a view reads when it draws. The interactive TUI reads
/// the real one on every frame, so file ages keep moving while it stays
/// open; goldens inject a fixed time.
pub(crate) type Clock = Box<dyn Fn() -> SystemTime>;

struct OutputsView {
    clock: Clock,
}

fn draw(lines: Vec<String>, frame: &mut Frame, area: Rect) {
    let text: Vec<Line> = lines.into_iter().map(Line::from).collect();
    frame.render_widget(Paragraph::new(text), area);
}

impl View<StatusData> for StatusView {
    fn id(&self) -> &str {
        "status"
    }
    fn title(&self) -> &str {
        "Status"
    }
    fn render(&self, state: &StatusData, frame: &mut Frame, area: Rect) {
        draw(status_lines(state, area.width), frame, area)
    }
    fn height(&self, state: &StatusData, width: u16) -> u16 {
        status_lines(state, width).len().min(200) as u16
    }
}

impl View<StatusData> for OutputsView {
    fn id(&self) -> &str {
        "outputs"
    }
    fn title(&self) -> &str {
        "Outputs"
    }
    fn render(&self, state: &StatusData, frame: &mut Frame, area: Rect) {
        draw(
            outputs_lines(&state.outputs, area.width, (self.clock)()),
            frame,
            area,
        )
    }
    fn height(&self, state: &StatusData, width: u16) -> u16 {
        outputs_lines(&state.outputs, width, (self.clock)())
            .len()
            .min(200) as u16
    }
}

pub(crate) fn views(clock: Clock) -> Vec<Box<dyn View<StatusData>>> {
    vec![Box::new(StatusView), Box::new(OutputsView { clock })]
}

/// The `tui --snapshot` text for one state. Pure, for goldens.
#[cfg(test)]
pub(crate) fn snapshot(data: &StatusData, width: u16, now: SystemTime) -> String {
    views(Box::new(move || now))
        .iter()
        .map(|view| {
            format!(
                "== {} ==\n{}",
                view.title(),
                tui::render_to_string(view.as_ref(), data, width)
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

// ---------------------------------------------------------------------------
// Diagnostics

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticsData {
    /// Version and fixed codes only, never paths, account IDs or session
    /// content.
    pub(crate) text: String,
}

/// The text the menu bar's "Copy diagnostics" copied.
pub(crate) fn diagnostics_text(health: &Health, version: &str, now: SystemTime) -> String {
    let mut lines = vec![format!("aicharts {version}")];
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

// ---------------------------------------------------------------------------
// Outputs folder

/// `AICHARTS_OUTPUTS`, else `~/Library/Application Support/AI Charts/outputs`
/// (where the menu bar looked).
fn outputs_folder(home: &Path) -> PathBuf {
    if let Some(value) = std::env::var_os("AICHARTS_OUTPUTS").filter(|value| !value.is_empty()) {
        let path = PathBuf::from(value);
        if path.is_absolute() {
            return path;
        }
    }
    home.join("Library/Application Support/AI Charts/outputs")
}

pub(crate) fn list_outputs(folder: &Path, limit: usize) -> OutputsData {
    let mut files: Vec<OutputFile> = fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .take(MAX_OUTPUTS_LISTED * 4)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            if name.starts_with('.') {
                return None;
            }
            let meta = fs::symlink_metadata(entry.path()).ok()?;
            if !meta.is_file() {
                return None;
            }
            let modified = meta.modified().unwrap_or(UNIX_EPOCH);
            Some(OutputFile {
                name,
                bytes: meta.len(),
                modified_at: iso(modified),
                modified,
            })
        })
        .collect();
    files.sort_by(|a, b| b.modified.cmp(&a.modified).then(a.name.cmp(&b.name)));
    let total = files.len() as u64;
    files.truncate(limit);
    OutputsData {
        folder: folder.display().to_string(),
        total,
        files,
    }
}

// ---------------------------------------------------------------------------
// Legacy login items

/// A login item the retired menu bar wrote.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoginItem {
    pub(crate) label: String,
    pub(crate) path: String,
    /// It starts the retired menu bar and this user owns it: `doctor
    /// retire` sets it aside. Anything else is left alone.
    pub(crate) ours: bool,
}

fn plist_strings(text: &str) -> Vec<&str> {
    text.split("<string>")
        .skip(1)
        .filter_map(|rest| rest.split_once("</string>").map(|(value, _)| value))
        .collect()
}

/// Whether a login item's text starts the retired menu bar.
pub(crate) fn launches_menubar(text: &str) -> bool {
    plist_strings(text).iter().any(|value| {
        *value == LEGACY_PROGRAM
            || value.ends_with(&format!("/{LEGACY_PROGRAM}"))
            || value.ends_with(LEGACY_APP_PROGRAM)
    })
}

fn read_regular(path: &Path, limit: u64) -> Option<Vec<u8>> {
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > limit {
        return None;
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(limit)
        .read_to_end(&mut bytes)
        .ok()?;
    Some(bytes)
}

#[cfg(unix)]
fn current_uid() -> Option<u32> {
    Some(rustix::process::getuid().as_raw())
}

#[cfg(not(unix))]
fn current_uid() -> Option<u32> {
    None
}

#[cfg(unix)]
fn owner_matches(meta: &fs::Metadata, uid: Option<u32>) -> bool {
    use std::os::unix::fs::MetadataExt;
    uid.is_none_or(|uid| meta.uid() == uid)
}

#[cfg(not(unix))]
fn owner_matches(_meta: &fs::Metadata, _uid: Option<u32>) -> bool {
    true
}

fn owned_text(path: &Path, uid: Option<u32>) -> Option<String> {
    let meta = fs::symlink_metadata(path).ok()?;
    if !owner_matches(&meta, uid) {
        return None;
    }
    String::from_utf8(read_regular(path, MAX_LOGIN_ITEM_BYTES)?).ok()
}

/// Every legacy label present under `home`, and whether each is ours.
pub(crate) fn find_login_items(home: &Path, uid: Option<u32>) -> Vec<LoginItem> {
    let agents = home.join("Library/LaunchAgents");
    LEGACY_LABELS
        .iter()
        .filter_map(|label| {
            let path = agents.join(format!("{label}.plist"));
            fs::symlink_metadata(&path).ok()?;
            let ours = owned_text(&path, uid).is_some_and(|text| launches_menubar(&text));
            Some(LoginItem {
                label: (*label).to_owned(),
                path: path.display().to_string(),
                ours,
            })
        })
        .collect()
}

/// Earlier `doctor retire` copies, so `doctor` can say how to restore them.
fn retired_items(home: &Path) -> Vec<String> {
    let agents = home.join("Library/LaunchAgents");
    let mut found: Vec<String> = fs::read_dir(&agents)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| {
            LEGACY_LABELS
                .iter()
                .any(|label| name.starts_with(&format!("{label}.plist.retired-")))
        })
        .map(|name| agents.join(name).display().to_string())
        .collect();
    found.sort();
    found
}

/// One login item `doctor retire` set aside.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Retired {
    pub(crate) label: String,
    pub(crate) from: String,
    pub(crate) to: String,
    /// The command that puts it back.
    pub(crate) restore: String,
}

// ---------------------------------------------------------------------------
// Human gate

/// Why a `decide` verb stops before any prompt: `--json` from an agent or
/// quiet audience, or agent markers (T0) in any audience. `None` means a
/// person may be at the terminal, so the T1+T2 gate runs next.
pub(crate) fn unattended_refusal(
    registry: &Registry,
    verb: &Verb,
    json: bool,
    audience: hraness_cli_kit::Audience,
    agent: &gate::AgentMarkers,
    command: &str,
) -> Option<ErrorBody> {
    let human = audience == hraness_cli_kit::Audience::Human;
    if (json && !human) || agent.agent {
        return Some(registry.human_required(verb, command));
    }
    None
}

/// The command a person runs to make this decision: `args` without
/// `--json`, quoted for a shell.
pub(crate) fn command_for_person(args: &[String]) -> String {
    std::iter::once(PRODUCT.to_owned())
        .chain(
            args.iter()
                .filter(|arg| arg.as_str() != "--json")
                .map(|arg| shell_quote(arg)),
        )
        .collect::<Vec<_>>()
        .join(" ")
}

/// The human gate for the `decide` verb at `path` (plan D-5, D-6): refuses
/// at once when no person can answer, then shows `title` and `digest` and
/// asks for a one-time code on `/dev/tty` (T1+T2). `before_prompt` runs
/// only when a person may answer, such as the macOS login-item notice. On
/// refusal it prints the `human-required` (or gate) error and returns the
/// exit status, 3; nothing has changed.
pub(crate) fn require_decision(
    path: &[&str],
    args: &[String],
    json: bool,
    title: &str,
    digest: &str,
    before_prompt: impl FnOnce(),
) -> Result<(), i32> {
    let registry = registry();
    let verb = registry
        .lookup(path)
        .filter(|verb| verb.path.len() == path.len())
        .expect("decide verbs are registered");
    let tier = verb.gate.expect("decide verbs carry a gate");
    let command = command_for_person(args);
    if let Some(error) = unattended_refusal(
        &registry,
        verb,
        json,
        hraness_cli_kit::audience::detect_current(),
        &gate::detect_agent_here(),
        &command,
    ) {
        return Err(fail(json, error));
    }
    before_prompt();
    gate::require_human(title, digest, tier)
        .map(|_| ())
        .map_err(|error| {
            let error = if error.next.is_empty() {
                error.with_next(NextStep::new(
                    &command,
                    "Run this in your own terminal to decide.",
                    Audience::Human,
                ))
            } else {
                error
            };
            fail(json, error)
        })
}

fn shell_quote(text: &str) -> String {
    if text
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "/._-+@:".contains(c))
    {
        text.to_owned()
    } else {
        format!("'{}'", text.replace('\'', "'\\''"))
    }
}

/// Renames each login item that is ours to `<path>.retired-<ms>` after
/// `bootout` unloads its label. Nothing is deleted; items that aren't ours,
/// symlinks and files another user owns are left alone, and no process is
/// signalled. The rules follow desktop-foundation's `retire` module.
pub(crate) fn retire_login_items(
    home: &Path,
    uid: Option<u32>,
    now_ms: u128,
    bootout: &dyn Fn(&str),
) -> Result<Vec<Retired>, ErrorBody> {
    let mut retired = Vec::new();
    for item in find_login_items(home, uid) {
        if !item.ours {
            continue;
        }
        let from = PathBuf::from(&item.path);
        // Check again right before acting: the item must still be ours.
        if !owned_text(&from, uid).is_some_and(|text| launches_menubar(&text)) {
            continue;
        }
        let to = PathBuf::from(format!("{}.retired-{now_ms}", item.path));
        if fs::symlink_metadata(&to).is_ok() {
            return Err(ErrorBody::new(
                ErrorCode::Conflict,
                format!("{} already exists. Nothing was renamed.", to.display()),
            ));
        }
        bootout(&item.label);
        fs::rename(&from, &to).map_err(|error| {
            ErrorBody::new(
                ErrorCode::Internal,
                format!("Couldn't set aside {}.", from.display()),
            )
            .with_detail(error.to_string())
        })?;
        retired.push(Retired {
            restore: format!(
                "mv {} {} && launchctl bootstrap gui/$(id -u) {}",
                shell_quote(&to.display().to_string()),
                shell_quote(&item.path),
                shell_quote(&item.path)
            ),
            label: item.label,
            from: item.path,
            to: to.display().to_string(),
        });
    }
    Ok(retired)
}

/// Unloads one of the retired menu bar's labels so it stops at once. It
/// never signals a process by pid, and only ever names a legacy label.
fn launchctl_bootout(label: &str) {
    if !cfg!(target_os = "macos") || !LEGACY_LABELS.contains(&label) {
        return;
    }
    let Some(uid) = current_uid().filter(|uid| *uid > 0) else {
        return;
    };
    let _ = std::process::Command::new("/bin/launchctl")
        .args(["bootout", &format!("gui/{uid}/{label}")])
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

// ---------------------------------------------------------------------------
// Doctor

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DoctorData {
    pub(crate) collector_home: String,
    pub(crate) collector_status_file: bool,
    pub(crate) last_cycle_file: bool,
    pub(crate) error_log: bool,
    /// `io.aicharts.daemon` LaunchAgent state; see `aicharts service status`.
    pub(crate) service_login_item: bool,
    pub(crate) state: &'static str,
    pub(crate) legacy_login_items: Vec<LoginItem>,
    /// Copies an earlier `doctor retire` set aside.
    pub(crate) retired_login_items: Vec<String>,
    pub(crate) outputs_folder: String,
}

fn doctor_data(paths: &Paths, now: SystemTime) -> DoctorData {
    let health = Health::read(&paths.collector_home);
    DoctorData {
        collector_home: paths.collector_home.display().to_string(),
        collector_status_file: paths
            .collector_home
            .join(health::COLLECTOR_STATUS)
            .is_file(),
        last_cycle_file: paths.collector_home.join(health::LAST_CYCLE).is_file(),
        error_log: health.error_log,
        service_login_item: paths
            .home
            .join("Library/LaunchAgents/io.aicharts.daemon.plist")
            .exists(),
        state: status_data(
            &health,
            empty_outputs(&paths.outputs),
            None,
            Vec::new(),
            now,
        )
        .state,
        legacy_login_items: find_login_items(&paths.home, current_uid()),
        retired_login_items: retired_items(&paths.home),
        outputs_folder: paths.outputs.display().to_string(),
    }
}

fn empty_outputs(folder: &Path) -> OutputsData {
    OutputsData {
        folder: folder.display().to_string(),
        total: 0,
        files: Vec::new(),
    }
}

fn doctor_lines(data: &DoctorData) -> String {
    let yes = |value: bool| if value { "found" } else { "missing" };
    let mut text = format!(
        "Collector folder   {}\nCollector status   {}\nLast publish       {}\nError log          {}\nBackground service {}\nState              {}\n",
        data.collector_home,
        yes(data.collector_status_file),
        yes(data.last_cycle_file),
        yes(data.error_log),
        if data.service_login_item {
            "installed (aicharts service status)"
        } else {
            "not installed (aicharts service install --help)"
        },
        data.state,
    );
    for item in &data.legacy_login_items {
        if item.ours {
            text.push_str(&format!(
                "Retired menu bar login item {} · aicharts doctor retire sets it aside\n",
                item.path
            ));
        } else {
            text.push_str(&format!("Left alone (not ours): {}\n", item.path));
        }
    }
    for path in &data.retired_login_items {
        text.push_str(&format!(
            "Set aside earlier: {path} (rename it back and run launchctl bootstrap gui/$(id -u) <path> to restore)\n"
        ));
    }
    text
}

// ---------------------------------------------------------------------------
// Opening pages and files

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenData {
    pub(crate) target: String,
    pub(crate) url: Option<String>,
    pub(crate) path: Option<String>,
    pub(crate) reveal: bool,
    /// False with `--print`: nothing was opened.
    pub(crate) opened: bool,
}

/// Opens a fixed URL or a path this module chose. Never takes a URL from
/// the command line.
fn system_open(what: &str, reveal: bool) -> Result<(), ErrorBody> {
    let mut command = if cfg!(target_os = "macos") {
        let mut command = std::process::Command::new("/usr/bin/open");
        if reveal {
            command.arg("-R");
        }
        command
    } else if cfg!(target_os = "linux") {
        if reveal {
            return Err(ErrorBody::new(
                ErrorCode::UnsupportedPlatform,
                "Showing a file in a folder works on macOS only.",
            ));
        }
        std::process::Command::new("xdg-open")
    } else {
        return Err(ErrorBody::new(
            ErrorCode::UnsupportedPlatform,
            "Opening pages works on macOS and Linux only.",
        ));
    };
    let status = command
        .arg(what)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    match status {
        Ok(status) if status.success() => Ok(()),
        Ok(_) | Err(_) => Err(ErrorBody::new(
            ErrorCode::Product("aicharts.open-failed".into()),
            format!("Couldn't open {what}."),
        )),
    }
}

// ---------------------------------------------------------------------------
// Command line

struct Paths {
    home: PathBuf,
    collector_home: PathBuf,
    outputs: PathBuf,
}

fn paths() -> Result<Paths, ErrorBody> {
    let env = |name: &str| std::env::var(name).ok();
    let home = std::env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
        .filter(|home| home.is_absolute())
        .ok_or_else(|| {
            ErrorBody::new(
                ErrorCode::NotFound,
                "Couldn't find your home folder. Set HOME.",
            )
        })?;
    let collector_home = health::aicharts_home(&env).ok_or_else(|| {
        ErrorBody::new(ErrorCode::Usage, "AICHARTS_HOME must be an absolute path.")
    })?;
    Ok(Paths {
        outputs: outputs_folder(&home),
        home,
        collector_home,
    })
}

#[derive(Debug, Default)]
struct Flags {
    json: bool,
    snapshot: bool,
    print: bool,
    reveal: bool,
    all: bool,
    width: Option<u16>,
    positional: Vec<String>,
}

fn usage(message: impl Into<String>, command: &str) -> ErrorBody {
    ErrorBody::new(ErrorCode::Usage, message).with_next(NextStep::new(
        format!("aicharts {command} --help"),
        "Show this command's usage",
        Audience::Agent,
    ))
}

fn parse(args: &[String], command: &str, allow: &[&str]) -> Result<Flags, ErrorBody> {
    let mut flags = Flags::default();
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--json" if allow.contains(&"--json") => flags.json = true,
            "--snapshot" if allow.contains(&"--snapshot") => flags.snapshot = true,
            "--print" if allow.contains(&"--print") => flags.print = true,
            "--reveal" if allow.contains(&"--reveal") => flags.reveal = true,
            "--all" if allow.contains(&"--all") => flags.all = true,
            "--width" if allow.contains(&"--width") => {
                match iter.next().and_then(|value| value.parse::<u16>().ok()) {
                    Some(width) if (20..=500).contains(&width) => flags.width = Some(width),
                    _ => return Err(usage("--width takes a number from 20 to 500.", command)),
                }
            }
            flag if flag.starts_with('-') => {
                return Err(usage(format!("Unknown option {flag}."), command));
            }
            value => flags.positional.push(value.to_owned()),
        }
    }
    Ok(flags)
}

fn wants_json(args: &[String]) -> bool {
    args.iter().any(|arg| arg == "--json")
}

/// Prints an envelope as JSON, or its human form, and returns the exit status.
fn finish<T: Serialize>(
    json: bool,
    envelope: Envelope<T>,
    human: impl FnOnce(&T) -> String,
) -> i32 {
    if json {
        let stdout = std::io::stdout();
        return envelope::emit(&mut stdout.lock(), &envelope) as i32;
    }
    let code = envelope.exit_code() as i32;
    match &envelope {
        Envelope::Ok { data, next, .. } => {
            let mut text = human(data);
            for step in next {
                text.push_str(&format!("→ {}\n", step.command));
            }
            let mut out = std::io::stdout().lock();
            match out.write_all(text.as_bytes()).and_then(|()| out.flush()) {
                Ok(()) => code,
                Err(error) if error.kind() == std::io::ErrorKind::BrokenPipe => code,
                Err(_) => 1,
            }
        }
        Envelope::Err { error, .. } => {
            let mut message = format!("✗ {}", error.message);
            if let Some(detail) = &error.detail {
                message.push('\n');
                message.push_str(detail);
            }
            if let Some(next) = error.next.first() {
                message.push_str(&format!("\n→ {}", next.command));
            }
            message.push('\n');
            let _ = std::io::stderr().write_all(message.as_bytes());
            code
        }
    }
}

fn fail(json: bool, error: ErrorBody) -> i32 {
    finish::<()>(json, Envelope::error(error), |_| String::new())
}

fn no_arguments(args: &[String], command: &str, allow: &[&str]) -> Result<Flags, ErrorBody> {
    let flags = parse(args, command, allow)?;
    if let Some(extra) = flags.positional.first() {
        return Err(usage(format!("Unknown argument {extra}."), command));
    }
    Ok(flags)
}

/// Whether `status ARGS` asks about the local ledger (the older `status`
/// with `--state-dir` and `--key-file`) rather than collector health.
pub(crate) fn is_ledger_status(args: &[String]) -> bool {
    args.iter()
        .any(|arg| arg != "--json" && arg != "--help" && arg != "-h")
}

/// Runs `args` when it is one of this module's commands; `None` hands it
/// back to the ordinary runner.
pub(crate) fn dispatch(args: &[String]) -> Option<i32> {
    let first = args.first()?.as_str();
    let second = args.get(1).map(String::as_str);
    Some(match (first, second) {
        ("status", _) if !is_ledger_status(&args[1..]) => status(&args[1..]),
        ("tui", _) => run_tui(&args[1..]),
        ("commands", _) => commands(&args[1..]),
        ("doctor", Some("retire")) => doctor_retire(&args[2..]),
        ("doctor", _) => doctor(&args[1..]),
        ("open", _) => open(&args[1..]),
        ("diagnostics", _) => diagnostics(&args[1..]),
        ("outputs", Some("open")) => outputs_open(&args[2..], false),
        ("outputs", Some("reveal")) => outputs_open(&args[2..], true),
        ("outputs", _) => outputs(&args[1..]),
        _ => return None,
    })
}

fn load_status(paths: &Paths, now: SystemTime) -> Envelope<StatusData> {
    let health = Health::read(&paths.collector_home);
    let error_log = paths.collector_home.join(health::ERROR_LOG);
    let data = status_data(
        &health,
        list_outputs(&paths.outputs, NEWEST_OUTPUTS),
        health.error_log.then_some(error_log.as_path()),
        find_login_items(&paths.home, current_uid()),
        now,
    );
    let next = next_steps(&data);
    let mut envelope = Envelope::ok(STATUS_SCHEMA, data);
    for step in next {
        envelope = envelope.with_next(step);
    }
    envelope
}

fn status(args: &[String]) -> i32 {
    let json = wants_json(args);
    let flags = match no_arguments(args, "status", &["--json"]) {
        Ok(flags) => flags,
        Err(error) => return fail(json, error),
    };
    let paths = match paths() {
        Ok(paths) => paths,
        Err(error) => return fail(flags.json, error),
    };
    finish(flags.json, load_status(&paths, SystemTime::now()), |data| {
        let mut text = status_lines(data, 80).join("\n");
        text.push('\n');
        text
    })
}

fn run_tui(args: &[String]) -> i32 {
    let json = wants_json(args);
    let flags = match no_arguments(args, "tui", &["--json", "--snapshot", "--width"]) {
        Ok(flags) => flags,
        Err(error) => return fail(json, error),
    };
    let paths = match paths() {
        Ok(paths) => paths,
        Err(error) => return fail(flags.json, error),
    };
    let options = RunOptions {
        load: Box::new(move || load_status(&paths, SystemTime::now())),
        views: views(Box::new(SystemTime::now)),
        mode: tui::mode_for_stdout(flags.json, flags.snapshot),
        width: flags.width,
    };
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    i32::from(tui::run(options, &mut out))
}

fn commands(args: &[String]) -> i32 {
    let json = wants_json(args);
    let flags = match no_arguments(args, "commands", &["--json"]) {
        Ok(flags) => flags,
        Err(error) => return fail(json, error),
    };
    let registry = registry();
    if flags.json {
        let stdout = std::io::stdout();
        return envelope::emit(&mut stdout.lock(), &registry.commands_json()) as i32;
    }
    let mut text = String::new();
    for verb in registry.verbs() {
        text.push_str(&format!(
            "{:<20} {:<14} {}\n",
            verb.command(),
            verb.op_class.as_str(),
            verb.summary
        ));
    }
    let mut out = std::io::stdout().lock();
    match out.write_all(text.as_bytes()).and_then(|()| out.flush()) {
        Ok(()) => 0,
        Err(error) if error.kind() == std::io::ErrorKind::BrokenPipe => 0,
        Err(_) => 1,
    }
}

fn doctor(args: &[String]) -> i32 {
    let json = wants_json(args);
    let flags = match no_arguments(args, "doctor", &["--json"]) {
        Ok(flags) => flags,
        Err(error) => return fail(json, error),
    };
    let paths = match paths() {
        Ok(paths) => paths,
        Err(error) => return fail(flags.json, error),
    };
    let data = doctor_data(&paths, SystemTime::now());
    let mut envelope = Envelope::ok(DOCTOR_SCHEMA, data.clone());
    if data.legacy_login_items.iter().any(|item| item.ours) {
        envelope = envelope.with_next(NextStep::new(
            "aicharts doctor retire",
            "Set aside the retired menu bar's login item",
            Audience::Agent,
        ));
    }
    if !data.service_login_item {
        envelope = envelope.with_next(NextStep::new(
            "aicharts service install --help",
            "Run the collector in the background",
            Audience::Human,
        ));
    }
    finish(flags.json, envelope, doctor_lines)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RetireData {
    pub(crate) retired: Vec<Retired>,
    pub(crate) left_alone: Vec<LoginItem>,
}

fn doctor_retire(args: &[String]) -> i32 {
    let json = wants_json(args);
    let flags = match no_arguments(args, "doctor retire", &["--json"]) {
        Ok(flags) => flags,
        Err(error) => return fail(json, error),
    };
    let paths = match paths() {
        Ok(paths) => paths,
        Err(error) => return fail(flags.json, error),
    };
    let uid = current_uid();
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let envelope = match retire_login_items(&paths.home, uid, now_ms, &launchctl_bootout) {
        Ok(retired) => Envelope::ok(
            RETIRE_SCHEMA,
            RetireData {
                retired,
                left_alone: find_login_items(&paths.home, uid)
                    .into_iter()
                    .filter(|item| !item.ours)
                    .collect(),
            },
        ),
        Err(error) => Envelope::error(error),
    };
    finish(flags.json, envelope, |data| {
        let mut text = String::new();
        if data.retired.is_empty() {
            text.push_str("No menu bar login item to set aside.\n");
        }
        for item in &data.retired {
            text.push_str(&format!(
                "Set aside {} as {}\nTo restore it: {}\n",
                item.from, item.to, item.restore
            ));
        }
        for item in &data.left_alone {
            text.push_str(&format!("Left alone (not ours): {}\n", item.path));
        }
        text
    })
}

fn diagnostics(args: &[String]) -> i32 {
    let json = wants_json(args);
    let flags = match no_arguments(args, "diagnostics", &["--json"]) {
        Ok(flags) => flags,
        Err(error) => return fail(json, error),
    };
    let paths = match paths() {
        Ok(paths) => paths,
        Err(error) => return fail(flags.json, error),
    };
    let text = diagnostics_text(
        &Health::read(&paths.collector_home),
        env!("CARGO_PKG_VERSION"),
        SystemTime::now(),
    );
    finish(
        flags.json,
        Envelope::ok(DIAGNOSTICS_SCHEMA, DiagnosticsData { text }),
        |data| data.text.clone(),
    )
}

/// `open` targets.
const OPEN_TARGETS: &str = "dashboard, setup-guide, support, error-log or outputs";

fn open(args: &[String]) -> i32 {
    let json = wants_json(args);
    let flags = match parse(args, "open", &["--json", "--print", "--reveal"]) {
        Ok(flags) => flags,
        Err(error) => return fail(json, error),
    };
    let [target] = flags.positional.as_slice() else {
        return fail(
            flags.json,
            usage(format!("Name what to open: {OPEN_TARGETS}."), "open"),
        );
    };
    let paths = match paths() {
        Ok(paths) => paths,
        Err(error) => return fail(flags.json, error),
    };
    let (url, path) = match target.as_str() {
        "dashboard" => (Some(DASHBOARD_URL), None),
        "setup-guide" => (Some(SETUP_URL), None),
        "support" => (Some(SUPPORT_URL), None),
        "error-log" => {
            let log = paths.collector_home.join(health::ERROR_LOG);
            if !fs::symlink_metadata(&log).is_ok_and(|meta| meta.is_file()) {
                return fail(
                    flags.json,
                    ErrorBody::new(ErrorCode::NotFound, "The collector has no error log.")
                        .with_next(NextStep::new(
                            "aicharts status",
                            "Check collection",
                            Audience::Agent,
                        )),
                );
            }
            (None, Some(log))
        }
        "outputs" => {
            if let Err(error) = fs::create_dir_all(&paths.outputs) {
                return fail(
                    flags.json,
                    ErrorBody::new(ErrorCode::Internal, "Couldn't create the outputs folder.")
                        .with_detail(error.to_string()),
                );
            }
            (None, Some(paths.outputs.clone()))
        }
        other => {
            return fail(
                flags.json,
                usage(
                    format!("Unknown target {other}. Open {OPEN_TARGETS}."),
                    "open",
                ),
            )
        }
    };
    if flags.reveal && path.is_none() {
        return fail(
            flags.json,
            usage("--reveal works with error-log and outputs.", "open"),
        );
    }
    let what = url
        .map(str::to_owned)
        .or_else(|| path.as_ref().map(|path| path.display().to_string()))
        .unwrap_or_default();
    if !flags.print {
        if let Err(error) = system_open(&what, flags.reveal) {
            return fail(flags.json, error);
        }
    }
    let data = OpenData {
        target: target.clone(),
        url: url.map(str::to_owned),
        path: path.map(|path| path.display().to_string()),
        reveal: flags.reveal,
        opened: !flags.print,
    };
    finish(flags.json, Envelope::ok(OPEN_SCHEMA, data), |data| {
        if data.opened {
            String::new()
        } else {
            format!("{what}\n")
        }
    })
}

fn outputs(args: &[String]) -> i32 {
    let json = wants_json(args);
    let flags = match no_arguments(args, "outputs", &["--json", "--all"]) {
        Ok(flags) => flags,
        Err(error) => return fail(json, error),
    };
    let paths = match paths() {
        Ok(paths) => paths,
        Err(error) => return fail(flags.json, error),
    };
    let limit = if flags.all {
        MAX_OUTPUTS_LISTED
    } else {
        NEWEST_OUTPUTS
    };
    let now = SystemTime::now();
    let data = list_outputs(&paths.outputs, limit);
    finish(flags.json, Envelope::ok(OUTPUTS_SCHEMA, data), |data| {
        outputs_lines(data, 80, now).join("\n") + "\n"
    })
}

fn outputs_open(args: &[String], reveal: bool) -> i32 {
    let command = if reveal {
        "outputs reveal"
    } else {
        "outputs open"
    };
    let json = wants_json(args);
    let flags = match parse(args, command, &["--json", "--print"]) {
        Ok(flags) => flags,
        Err(error) => return fail(json, error),
    };
    let [name] = flags.positional.as_slice() else {
        return fail(flags.json, usage("Name one output file.", command));
    };
    if name.is_empty() || name.contains('/') || name.starts_with('.') {
        return fail(
            flags.json,
            usage("Name a file in the outputs folder, not a path.", command),
        );
    }
    let paths = match paths() {
        Ok(paths) => paths,
        Err(error) => return fail(flags.json, error),
    };
    let path = paths.outputs.join(name);
    if !fs::symlink_metadata(&path).is_ok_and(|meta| meta.is_file()) {
        return fail(
            flags.json,
            ErrorBody::new(ErrorCode::NotFound, format!("No output named {name}.")).with_next(
                NextStep::new(
                    "aicharts outputs --all",
                    "List the outputs",
                    Audience::Agent,
                ),
            ),
        );
    }
    let what = path.display().to_string();
    if !flags.print {
        if let Err(error) = system_open(&what, reveal) {
            return fail(flags.json, error);
        }
    }
    let data = OpenData {
        target: format!("output:{name}"),
        url: None,
        path: Some(what.clone()),
        reveal,
        opened: !flags.print,
    };
    finish(flags.json, Envelope::ok(OPEN_SCHEMA, data), |data| {
        if data.opened {
            String::new()
        } else {
            format!("{what}\n")
        }
    })
}

#[cfg(test)]
mod tests;
