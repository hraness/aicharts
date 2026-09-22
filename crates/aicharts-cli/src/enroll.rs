//! `aicharts enroll` — enroll this installation for AI Charts Usage. Local
//! credential custody is prepared, then one intent-bound browser sign-in pairs
//! the account. Nothing is uploaded and no transcript, source or secret leaves
//! the device; enrollment only prepares the option to upload later.

use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Terminal I/O for the sealed driver: wall clock, the one-time pairing
/// handoff, paced waits and status lines. Diagnostics go to stderr so stdout
/// stays the machine-readable result.
struct CliIo;

impl crate::enrollment::EnrollIo for CliIo {
    fn now_ms(&mut self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_millis() as u64)
            .unwrap_or(0)
    }
    fn pairing_url(&mut self, url: &str) {
        eprintln!("aicharts: open this URL in your browser to connect this collector:");
        eprintln!("aicharts: {url}");
    }
    fn wait_ms(&mut self, ms: u64) {
        std::thread::sleep(Duration::from_millis(ms.min(60_000)));
    }
    fn step(&mut self, name: &'static str) {
        eprintln!("aicharts: {name}");
    }
}

fn parse_options(args: &[String]) -> Result<PathBuf, &'static str> {
    let mut directory = None;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--state-dir" if directory.is_none() => {
                i += 1;
                let value = args
                    .get(i)
                    .filter(|value| !value.is_empty())
                    .ok_or("missing_option_value")?;
                directory = Some(PathBuf::from(value));
            }
            _ => return Err("invalid_option"),
        }
        i += 1;
    }
    directory.ok_or("state_directory_required")
}

pub(super) fn run(args: &[String]) -> Result<String, &'static str> {
    let directory = parse_options(args)?;
    let outcome = crate::enrollment::enroll(&directory, &mut CliIo)?;
    Ok(format!(
        "Enrolled this installation for AI Charts Usage.\nAccount: {}\nDevice: {}\nNothing was uploaded; telemetry stays local until you enable upload.\n",
        hex(&outcome.account_id),
        hex(&outcome.device_id)
    ))
}
