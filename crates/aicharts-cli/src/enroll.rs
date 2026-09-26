//! `aicharts enroll` — enroll this installation for AI Charts. Local
//! credential custody is prepared, then one intent-bound browser sign-in pairs
//! the account. Nothing is uploaded and no transcript, source or secret leaves
//! the device; enrollment only prepares the option to upload later.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::cli_style::{self, Audience, Style};

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Terminal I/O for the sealed driver: wall clock, the one-time pairing
/// handoff, paced waits and status lines. Diagnostics go to stderr so stdout
/// stays the machine-readable result.
struct CliIo {
    audience: Audience,
    style: Style,
}

/// The human line for one durable enrollment step. Scripts keep the fixed
/// step name (`aicharts: initialized`).
fn step_line(name: &str, style: Style) -> Option<String> {
    let (done, text) = match name {
        "pairing-reconciled" => (true, "Saved this Mac's keys in your login keychain"),
        "initialized" => (false, "Connecting to your AI Charts account…"),
        "confirmed" => (true, "You approved this Mac"),
        "reserved" => (false, "Adding this Mac to your account…"),
        "enrolled" => (true, "This Mac is on your account"),
        "namespace" => (true, "Saved the key that keeps your usage private"),
        _ => return None,
    };
    let symbol = if done { style.ok() } else { style.progress() };
    Some(format!("{symbol} {text}"))
}

fn pairing_lines(url: &str, audience: Audience, style: Style) -> String {
    match audience {
        Audience::Human => format!(
            "{} Open this link in your browser and approve this Mac:\n  {url}\n{} Waiting for your approval…\n",
            style.next(),
            style.progress()
        ),
        Audience::Agent | Audience::Quiet => format!(
            "aicharts: open this URL in your browser to connect this collector:\naicharts: {url}\n"
        ),
    }
}

impl crate::enrollment::EnrollIo for CliIo {
    fn now_ms(&mut self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_millis() as u64)
            .unwrap_or(0)
    }
    fn pairing_url(&mut self, url: &str) {
        eprint!("{}", pairing_lines(url, self.audience, self.style));
    }
    fn wait_ms(&mut self, ms: u64) {
        std::thread::sleep(Duration::from_millis(ms.min(60_000)));
    }
    fn step(&mut self, name: &'static str) {
        match (self.audience, step_line(name, self.style)) {
            (Audience::Human, Some(line)) => eprintln!("{line}"),
            _ => eprintln!("aicharts: {name}"),
        }
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

/// The stdout result. People get what happened and one next step; scripts
/// keep the fixed lines with both identifiers.
fn summary(account: &[u8], device: &[u8], directory: &Path, audience: Audience) -> String {
    match audience {
        Audience::Human => format!(
            "Connected this Mac to your AI Charts account. Nothing was uploaded; your usage stays here until you publish.\nTo see the account: aicharts account --state-dir {}\n",
            directory.display()
        ),
        Audience::Agent | Audience::Quiet => format!(
            "Enrolled this installation for AI Charts.\nAccount: {}\nDevice: {}\nNothing was uploaded; telemetry stays local until you enable upload.\n",
            hex(account),
            hex(device)
        ),
    }
}

pub(super) fn run(args: &[String]) -> Result<String, &'static str> {
    let directory = parse_options(args)?;
    let audience = cli_style::detect_current();
    let mut io = CliIo {
        audience,
        style: Style::stderr(),
    };
    let outcome = crate::enrollment::enroll(&directory, &mut io)?;
    if audience == Audience::Human {
        eprintln!("Next: aicharts help publish");
    }
    Ok(summary(
        &outcome.account_id,
        &outcome.device_id,
        &directory,
        audience,
    ))
}

#[cfg(test)]
mod copy_tests {
    use super::*;

    const PLAIN: Style = Style {
        color: false,
        ascii: false,
    };

    #[test]
    fn every_durable_step_has_plain_progress_copy() {
        for name in [
            "pairing-reconciled",
            "initialized",
            "confirmed",
            "reserved",
            "enrolled",
            "namespace",
        ] {
            let line = step_line(name, PLAIN).unwrap();
            assert!(line.starts_with("✓ ") || line.starts_with("↻ "), "{line}");
            assert!(!line.contains(name), "{line}");
        }
        assert_eq!(step_line("unknown-step", PLAIN), None);
        assert_eq!(
            step_line(
                "confirmed",
                Style {
                    color: false,
                    ascii: true
                }
            )
            .unwrap(),
            "OK You approved this Mac"
        );
    }

    #[test]
    fn the_pairing_link_reads_as_one_step_for_people_and_stays_fixed_for_scripts() {
        assert_eq!(
            pairing_lines("https://example.test/p", Audience::Human, PLAIN),
            "→ Open this link in your browser and approve this Mac:\n  https://example.test/p\n↻ Waiting for your approval…\n"
        );
        assert_eq!(
            pairing_lines("https://example.test/p", Audience::Quiet, PLAIN),
            "aicharts: open this URL in your browser to connect this collector:\naicharts: https://example.test/p\n"
        );
    }

    #[test]
    fn people_see_no_raw_identifiers() {
        let human = summary(&[0xab; 16], &[0xcd; 32], Path::new("/s"), Audience::Human);
        assert!(
            !human.contains("abab") && !human.contains("cdcd"),
            "{human}"
        );
        assert!(human.contains("aicharts account --state-dir /s"));
        let quiet = summary(&[0xab; 16], &[0xcd; 32], Path::new("/s"), Audience::Quiet);
        assert!(quiet.contains(&format!("Account: {}", "ab".repeat(16))));
    }
}
