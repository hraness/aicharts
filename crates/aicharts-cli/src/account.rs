//! Project the non-secret identity of an existing, custody-verified enrollment.
//! This does not advance enrollment or open the ledger, sources or transport.
use std::path::{Path, PathBuf};

struct Options {
    directory: PathBuf,
    json: bool,
    diagnose: bool,
}

struct Identity {
    account: [u8; 16],
    device: [u8; 32],
}

fn options(args: &[String]) -> Result<Options, &'static str> {
    if args.first().map(String::as_str) != Some("account") {
        return Err("invalid_command");
    }
    let mut directory = None;
    let mut json = false;
    let mut diagnose = false;
    let mut args = args[1..].iter();
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--json" if !json => json = true,
            "--diagnose" if !diagnose => diagnose = true,
            "--state-dir" if directory.is_none() => {
                let value = args
                    .next()
                    .filter(|value| !value.is_empty() && !value.starts_with("--"))
                    .ok_or("missing_option_value")?;
                let path = PathBuf::from(value);
                if !path.is_absolute() {
                    return Err("state_directory_absolute_required");
                }
                directory = Some(path);
            }
            _ => return Err("invalid_option"),
        }
    }
    Ok(Options {
        directory: directory.ok_or("state_directory_required")?,
        json,
        diagnose,
    })
}

#[cfg(target_os = "macos")]
fn identity(directory: &Path) -> Result<Identity, &'static str> {
    // Keep the existing lock and durable-read checks. This may flush existing
    // state while verifying custody; it never initializes or repairs an anchor.
    let enrolled = crate::enrollment::enrolled(directory)?;
    Ok(Identity {
        account: enrolled.account_id,
        device: enrolled.device_id,
    })
}

#[cfg(not(target_os = "macos"))]
fn identity(_: &Path) -> Result<Identity, &'static str> {
    Err("persistent_state_requires_qualified_macos_custody")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn render(identity: &Identity, json: bool) -> Result<String, &'static str> {
    let account = format!("acct_{}", hex(&identity.account));
    let device = hex(&identity.device);
    if json {
        serde_json::to_string_pretty(&serde_json::json!({
            "schemaVersion": 1, "operation": "account", "access": "read_only",
            "verification": "local_custody", "accountId": account, "deviceId": device,
        }))
        .map_err(|_| "summary_encode_failed")
    } else {
        Ok(format!(
            "AI Charts enrolled account\nAccount: {account}\nDevice: {device}\nVerified against both retained local credentials.\nServer access has not been checked. No enrollment state was advanced or repaired; nothing was uploaded.\n"
        ))
    }
}

fn render_diagnostic(diagnostic: crate::enrollment::AccountDiagnostic, json: bool) -> String {
    if json {
        // Keep this projection fixed and deliberately free of account IDs,
        // paths, native messages and credential material.
        format!(
            "{{\"schemaVersion\":1,\"operation\":\"account_diagnostic\",\"access\":\"read_only\",\"outcome\":\"{}\",\"stage\":\"{}\",\"reason\":\"{}\"}}\n",
            if diagnostic.is_qualified() { "qualified" } else { "refused" },
            diagnostic.stage(),
            diagnostic.reason(),
        )
    } else {
        format!(
            "AI Charts account diagnostic\nOutcome: {}\nStage: {}\nReason: {}\n{}\n",
            if diagnostic.is_qualified() {
                "qualified"
            } else {
                "refused"
            },
            diagnostic.stage(),
            diagnostic.reason(),
            diagnostic.guidance(),
        )
    }
}

pub(super) fn run(args: &[String]) -> Result<String, &'static str> {
    let options = options(args)?;
    if options.diagnose {
        return Err("account_diagnostic_requires_dispatch");
    }
    render(&identity(&options.directory)?, options.json)
}

pub(super) fn run_diagnostic(args: &[String]) -> Result<(String, i32), &'static str> {
    let options = options(args)?;
    if !options.diagnose {
        return Err("account_diagnostic_required");
    }
    let diagnostic = crate::enrollment::diagnose_account(&options.directory);
    Ok((
        render_diagnostic(diagnostic, options.json),
        if diagnostic.is_qualified() { 0 } else { 2 },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arguments(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn rejects_incomplete_ambiguous_and_effect_bearing_options_before_custody() {
        for values in [
            vec![],
            vec!["enroll"],
            vec!["account"],
            vec!["account", "--state-dir"],
            vec!["account", "--state-dir", "--json"],
            vec!["account", "--state-dir", "relative"],
            vec![
                "account",
                "--state-dir",
                "/private/example",
                "--diagnose",
                "--diagnose",
            ],
            vec![
                "account",
                "--state-dir",
                "/private/example",
                "--state-dir",
                "/private/other",
            ],
            vec![
                "account",
                "--state-dir",
                "/private/example",
                "--json",
                "--json",
            ],
            vec!["account", "--state-dir", "/private/example", "--resume"],
            vec![
                "account",
                "--state-dir",
                "/private/example",
                "--key-file",
                "/private/key",
            ],
            vec![
                "account",
                "--state-dir",
                "/private/example",
                "--codex",
                "/private/source",
            ],
        ] {
            assert!(options(&arguments(&values)).is_err());
        }
        let parsed = options(&arguments(&[
            "account",
            "--json",
            "--state-dir",
            "/private/example",
        ]))
        .expect("explicit account options");
        assert_eq!(parsed.directory, Path::new("/private/example"));
        assert!(parsed.json);
        assert!(parsed.diagnose == false);
    }

    #[test]
    fn identity_projection_is_exact_bounded_and_not_server_authority() {
        let identity = Identity {
            account: [0x5a; 16],
            device: [0xd3; 32],
        };
        let encoded = render(&identity, true).expect("encode identity");
        assert!(encoded.len() < 512);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&encoded).unwrap(),
            serde_json::json!({
                "schemaVersion": 1, "operation": "account", "access": "read_only", "verification": "local_custody",
                "accountId": format!("acct_{}", "5a".repeat(16)), "deviceId": "d3".repeat(32),
            })
        );
        let text = render(&identity, false).expect("render identity");
        assert!(text.contains(&format!("Account: acct_{}", "5a".repeat(16))));
        assert!(text.contains("Server access has not been checked."));
        assert!(text.contains("nothing was uploaded."));
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn unsupported_custody_refuses_without_opening_the_supplied_directory() {
        assert_eq!(
            run(&arguments(&[
                "account",
                "--state-dir",
                "/path/never/opened",
                "--json"
            ]))
            .err(),
            Some("persistent_state_requires_qualified_macos_custody")
        );
    }
}
