//! `aicharts enroll` — bounded native pairing driver.
//!
//! Pairing links this terminal's collector attempt to the explicit Hraness
//! account chosen in the browser. It installs sealed custody under macOS,
//! performs the once-only HTTPS exchanges and confirms the browser-approved
//! account once. No upload, account list or credential value is exposed; the
//! only browser locator is the public intent identifier.

fn account_label(account_id: &[u8; 16]) -> String {
    let mut label = String::with_capacity(5 + 32);
    label.push_str("acct_");
    for byte in account_id {
        use std::fmt::Write as _;
        let _ = write!(label, "{byte:02x}");
    }
    label
}

#[cfg(target_os = "macos")]
fn run_macos(path: &std::path::Path) -> Result<String, &'static str> {
    use super::attempt::{run_pairing, PairingOutcome};

    let mut notice = |key: &'static str| {
        let line = match key {
            "pairing_initialized" => "Attempt registered with the collector service.",
            "pairing_link_ready" => "Pairing link ready.",
            "pairing_browser_open_failed" => {
                "Could not open a browser; open the link above manually."
            }
            "pairing_waiting_for_browser" => "Waiting for browser approval…",
            "pairing_browser_approved" => "Browser approved; confirming in terminal…",
            "pairing_exchange_retrying" => "Exchange interrupted; completing the same attempt…",
            _ => key,
        };
        eprintln!("aicharts: {line}");
    };
    let present_url = |url: &str| -> bool {
        eprintln!("aicharts: {url}");
        std::process::Command::new("open")
            .arg(url)
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    };
    match run_pairing(path, &mut notice, present_url) {
        Ok(PairingOutcome::Confirmed { account_id }) => Ok(format!(
            "Collector pairing confirmed.\nAccount: {}\nNumeric upload enrollment remains disabled until separately activated.\n",
            account_label(&account_id)
        )),
        Ok(PairingOutcome::Denied) => {
            Ok("Collector pairing was denied. Nothing was connected.\n".to_owned())
        }
        Ok(PairingOutcome::Expired) => Ok(
            "The pairing attempt expired. Run enroll again with a new attempt directory.\n"
                .to_owned(),
        ),
        Err(error) => Err(error.code()),
    }
}

pub(crate) fn run(args: &[String]) -> Result<String, &'static str> {
    if args.len() != 3 || args[0] != "enroll" || args[1] != "--attempt-dir" || args[2].is_empty() {
        return Err("invalid_enroll_arguments");
    }
    let path = std::path::PathBuf::from(&args[2]);
    #[cfg(target_os = "macos")]
    {
        run_macos(&path)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("enroll_requires_macos_custody")
    }
}

#[cfg(test)]
mod tests {
    use super::run;

    #[test]
    fn malformed_enroll_invocations_fail_before_any_effect() {
        for args in [
            vec!["enroll"],
            vec!["enroll", "--attempt-dir"],
            vec!["enroll", "--attempt-dir", ""],
            vec!["enroll", "/tmp/x"],
            vec!["enroll", "--attempt-dir", "/tmp/x", "extra"],
            vec!["enroll", "--json", "--attempt-dir", "/tmp/x"],
        ] {
            let owned: Vec<String> = args.into_iter().map(String::from).collect();
            assert_eq!(run(&owned), Err("invalid_enroll_arguments"));
        }
    }
}
