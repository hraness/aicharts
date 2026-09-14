//! `aicharts-menubar` — the AI Charts menu-bar companion.
//!
//! AI Charts' agent interface is a directory: agents drop finished outputs
//! (chart exports, images, data) into the repository `outputs/` directory and
//! the status item renders them newest-first, with image thumbnails, so a
//! user can open a result straight from the menu bar. The binary holds no
//! authority of its own — it only reads that directory.
//!
//! Runs unbundled: `bun run menubar` builds and spawns this executable.

use std::fs::{File, OpenOptions};
use std::os::unix::io::AsRawFd;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use desktop_foundation::outputs::OutputsSection;
use desktop_foundation::{Host, MenuModel, MenuNode, Options};

const STATUS_MARK: &str = "AI";

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
}

impl Host for AiChartsHost {
    fn snapshot(&self) -> MenuModel {
        let mut nodes = vec![MenuNode::disabled("AI Charts Outputs"), MenuNode::Separator];
        nodes.extend(self.outputs.nodes());
        nodes.push(MenuNode::Separator);
        nodes.push(MenuNode::quit("Quit AI Charts"));
        MenuModel {
            title: Some(STATUS_MARK.to_owned()),
            tooltip: Some("AI Charts — agent outputs".to_owned()),
            icon: None,
            nodes,
        }
    }

    fn dispatch(&self, id: &str) {
        self.outputs.dispatch(id);
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
    let host = Arc::new(AiChartsHost { outputs });
    let options = Options { refresh: Duration::from_secs(3), companion_window: false };
    if let Err(error) = desktop_foundation::run(tauri::generate_context!(), host, options, |b| b) {
        eprintln!("aicharts-menubar: {error}");
        std::process::exit(1);
    }
}
