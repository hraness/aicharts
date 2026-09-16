//! `aicharts-menubar` — the AI Charts menu-bar companion.
//!
//! AI Charts' agent interface is a directory: agents drop finished outputs
//! (chart exports, images, data) into the repository `outputs/` directory and
//! the status item renders them newest-first, with image thumbnails, so a
//! user can open a result straight from the menu bar. The binary holds no
//! authority of its own — it only reads that directory.
//!
//! Runs unbundled: `bun run menubar:build` builds it and `bun run menubar`
//! launches the prebuilt executable in the foreground.

use std::fs::{File, OpenOptions};
use std::os::unix::io::AsRawFd;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use desktop_foundation::browser::{BrowserOpener, BrowserStatus};
use desktop_foundation::outputs::OutputsSection;
use desktop_foundation::{
    AccessibilityMetadata, DispatchOutcome, Host, MenuItem, MenuModel, MenuNode, Options,
    RenderError, RgbaIcon,
};

/// Bar-chart status mark. macOS renders `STATUS_MARK` as native colored emoji
/// text; icon-only trays use this pre-rendered 32px Twemoji bitmap
/// (U+1F4CA, CC-BY 4.0 — https://twemoji.twitter.com).
const STATUS_MARK: &str = "\u{1f4ca}";
fn mark_icon() -> RgbaIcon {
    RgbaIcon {
        rgba: include_bytes!("../icons/mark.rgba").to_vec(),
        width: 32,
        height: 32,
    }
}
const UPDATES_URL: &str =
    "https://account.hraness.com/support?product=aicharts&source=desktop#updates";
const SUPPORT_URL: &str =
    "https://account.hraness.com/support?product=aicharts&source=desktop#support";

/// The outputs directory agents write into: `AICHARTS_OUTPUTS`, an explicit
/// `--outputs <dir>` argument, or `outputs/` under the working directory
/// (the launch script runs from the repository root).
fn outputs_dir() -> Option<PathBuf> {
    if let Some(value) = std::env::var_os("AICHARTS_OUTPUTS") {
        if !value.is_empty() {
            return Some(PathBuf::from(value));
        }
    }
    let args: Vec<String> = std::env::args().collect();
    if let Some(index) = args.iter().position(|arg| arg == "--outputs") {
        if let Some(dir) = args.get(index + 1) {
            return Some(PathBuf::from(dir));
        }
    }
    std::env::current_dir().ok().map(|cwd| cwd.join("outputs"))
}

/// One status item per working tree; a second launch exits quietly.
fn acquire_instance_lock(outputs: &std::path::Path) -> Option<File> {
    std::fs::create_dir_all(outputs).ok()?;
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(outputs.join(".menubar.lock"))
        .ok()?;
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
        Some(file)
    } else {
        None
    }
}

struct AiChartsHost {
    outputs: OutputsSection,
    browser: BrowserOpener,
}

impl Host for AiChartsHost {
    fn snapshot(&self) -> MenuModel {
        let mut nodes = vec![MenuNode::disabled("AI Charts Outputs"), MenuNode::Separator];
        nodes.extend(self.outputs.nodes());
        nodes.push(MenuNode::Separator);
        nodes.push(MenuNode::item(
            "product.updates",
            "Get AI Charts updates (free)…",
        ));
        nodes.push(MenuNode::item(
            "product.support",
            "Support AI Charts development (optional paid)…",
        ));
        if matches!(self.browser.status(), BrowserStatus::Failed(_)) {
            nodes.push(MenuNode::disabled(
                "Browser unavailable — use account.hraness.com",
            ));
        }
        nodes.push(MenuNode::Separator);
        nodes.push(MenuNode::interactive(
            MenuItem::action(desktop_foundation::QUIT_ACTION_ID, "Quit AI Charts")
                .with_shortcut("CmdOrCtrl+Q")
                .with_accessibility(AccessibilityMetadata {
                    label: Some("Quit AI Charts".to_owned()),
                    value: None,
                    hint: Some("Exit the AI Charts menu bar companion".to_owned()),
                }),
        ));
        let mut model = MenuModel {
            tooltip: Some("AI Charts — agent outputs".to_owned()),
            nodes,
            ..MenuModel::default()
        };
        model.mark(STATUS_MARK, Some(mark_icon()));
        model
    }

    fn dispatch_result(&self, id: &str) -> DispatchOutcome {
        let address = match id {
            "product.updates" => Some(UPDATES_URL),
            "product.support" => Some(SUPPORT_URL),
            _ => None,
        };
        if let Some(address) = address {
            return if self.browser.open(address).is_ok() {
                DispatchOutcome::Accepted
            } else {
                DispatchOutcome::Rejected
            };
        }
        if self.outputs.dispatch(id) {
            DispatchOutcome::Accepted
        } else {
            DispatchOutcome::Rejected
        }
    }

    fn render_failed(&self, error: RenderError) {
        eprintln!("aicharts-menubar: render failed: {error:?}");
    }
}

fn main() {
    let Some(dir) = outputs_dir() else {
        eprintln!("aicharts-menubar: cannot resolve the outputs directory");
        std::process::exit(2);
    };
    let _instance = match acquire_instance_lock(&dir) {
        Some(lock) => lock,
        None => return,
    };
    let outputs = OutputsSection::new(dir);
    let _ = std::fs::create_dir_all(outputs.dir());
    let host = Arc::new(AiChartsHost {
        outputs,
        browser: BrowserOpener::new(),
    });
    let options = Options {
        refresh: Duration::from_secs(3),
        companion_window: false,
    };
    if let Err(error) = desktop_foundation::run(tauri::generate_context!(), host, options, |b| b) {
        eprintln!("aicharts-menubar: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod invitation_tests {
    use super::*;

    #[test]
    fn unavailable_product_still_offers_explicit_browser_actions_without_launching() {
        let host = AiChartsHost {
            outputs: OutputsSection::new("/dev/null/absent-outputs"),
            browser: BrowserOpener::new(),
        };
        let model = host.snapshot();
        for expected in ["product.updates", "product.support"] {
            assert!(model.nodes.iter().any(|node| matches!(node,
                MenuNode::Item { id: Some(id), enabled: true, .. } if id == expected)));
        }
        assert_eq!(host.browser.status(), BrowserStatus::Idle);
        assert!(matches!(
            host.dispatch_result("unknown.action"),
            DispatchOutcome::Rejected
        ));
        assert_eq!(host.browser.status(), BrowserStatus::Idle);
    }
}
