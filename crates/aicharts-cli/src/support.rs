use hraness_support_foundation::{run_support_command, Options, SupportProfile};
use std::collections::BTreeMap;
use std::io::Write;

fn profile() -> SupportProfile {
    SupportProfile {
        id: "aicharts".into(),
        name: "AI Charts".into(),
        updates: true,
        value_proposition:
            "Support ongoing development of sourced AI comparisons and private local usage tools."
                .into(),
    }
}

pub fn options() -> Options {
    Options {
        command: vec![std::env::current_exe()
            .ok()
            .and_then(|path| path.into_os_string().into_string().ok())
            .unwrap_or_else(|| "aicharts".into())],
        env: Some(
            std::env::vars_os()
                .filter_map(|(key, value)| {
                    Some((key.into_string().ok()?, value.into_string().ok()?))
                })
                .collect::<BTreeMap<_, _>>(),
        ),
        ..Options::default()
    }
}

pub fn execute(args: &[String], options: &Options) -> i32 {
    let result = run_support_command(&profile(), args, options);
    if std::io::stdout()
        .write_all(result.stdout.as_bytes())
        .and_then(|()| std::io::stdout().flush())
        .is_err()
        || std::io::stderr()
            .write_all(result.stderr.as_bytes())
            .and_then(|()| std::io::stderr().flush())
            .is_err()
    {
        return 1;
    }
    result.exit_code
}

/// Only successful, explicitly selected numeric reads qualify. Control,
/// background, authentication, upload and future commands remain quiet.
pub fn useful_read(args: &[String]) -> bool {
    !args
        .iter()
        .any(|arg| matches!(arg.as_str(), "--help" | "-h" | "--version"))
        && matches!(
            args.first().map(String::as_str),
            Some("usage" | "inspect" | "turns" | "sessions")
        )
}

pub fn completed(options: &Options) {
    let _ = hraness_support_foundation::maybe_show_support_invitation(&profile(), true, options);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_four_completed_read_commands_qualify() {
        for command in ["usage", "inspect", "turns", "sessions"] {
            assert!(useful_read(&[command.into(), "--json".into()]));
            for flag in ["--help", "-h", "--version"] {
                assert!(!useful_read(&[command.into(), flag.into()]));
            }
        }
        for command in [
            "daemon",
            "enroll",
            "upload",
            "keygen",
            "init",
            "collect",
            "collect-prefix",
            "prefix-enable",
            "status",
            "outbox",
            "reindex-plan",
            "reindex-prepare",
            "support",
            "unknown",
            "--version",
            "--help",
            "-h",
        ] {
            assert!(!useful_read(&[command.into()]));
        }
        assert!(!useful_read(&[]));
    }

    #[test]
    fn protocol_is_product_scoped_and_keeps_the_actual_executable() {
        let options = Options {
            command: vec!["/reviewed installation/aicharts".into()],
            env: Some(BTreeMap::new()),
            ..Options::default()
        };
        let result =
            run_support_command(&profile(), &["protocol".into(), "--json".into()], &options);
        assert_eq!(result.exit_code, 0);
        assert!(result.stderr.is_empty());
        let protocol: serde_json::Value = serde_json::from_str(&result.stdout).unwrap();
        assert_eq!(protocol["offer"]["product"]["id"], "aicharts");
        assert_eq!(protocol["offer"]["actions"].as_array().unwrap().len(), 2);
        for command in protocol["commands"].as_object().unwrap().values() {
            assert_eq!(command[0], "/reviewed installation/aicharts");
        }
    }
}
