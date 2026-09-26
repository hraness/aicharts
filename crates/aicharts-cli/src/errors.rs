//! Human error catalog: each fixed code becomes one sentence plus one next
//! command (Hraness CLI style contract § D5).
//!
//! The fixed code stays the machine contract. Scripts, agents and `--json`
//! callers keep the exact `aicharts: CODE` line on stderr with an empty
//! stdout. Only a person at a terminal sees the sentence form;
//! `HRANESS_DEBUG=1` adds the code below it.

use std::io::Write;

use crate::cli_style::{self, Audience, Style};

/// Commands that `invalid_command` can suggest.
const COMMANDS: &[&str] = &[
    "account",
    "autosubmit",
    "capture",
    "collect",
    "collect-prefix",
    "contribution-sync",
    "daemon",
    "enroll",
    "help",
    "init",
    "inspect",
    "keygen",
    "outbox",
    "prefix-enable",
    "refresh",
    "reindex-plan",
    "reindex-prepare",
    "sessions",
    "stats",
    "stats-health",
    "stats-sync",
    "stats-totals",
    "status",
    "support",
    "sync",
    "turns",
    "upgrade",
    "upload",
    "usage",
];

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Explained {
    pub(crate) message: String,
    pub(crate) next: String,
}

fn option_value<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
    args.iter()
        .position(|arg| arg == flag)
        .and_then(|index| args.get(index + 1))
        .map(String::as_str)
        .filter(|value| !value.is_empty() && !value.starts_with("--"))
}

fn quote(value: &str) -> String {
    if !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "/._-~+=:@,".contains(c))
    {
        value.to_owned()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

/// Optimal string alignment distance: edits plus adjacent transpositions.
fn distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut d = vec![vec![0usize; b.len() + 1]; a.len() + 1];
    for (i, row) in d.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, cell) in d[0].iter_mut().enumerate() {
        *cell = j;
    }
    for i in 1..=a.len() {
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            d[i][j] = (d[i - 1][j] + 1)
                .min(d[i][j - 1] + 1)
                .min(d[i - 1][j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                d[i][j] = d[i][j].min(d[i - 2][j - 2] + 1);
            }
        }
    }
    d[a.len()][b.len()]
}

fn closest_command(input: &str) -> Option<&'static str> {
    COMMANDS
        .iter()
        .map(|command| {
            let length_gap = command.len().abs_diff(input.len());
            ((distance(input, command), length_gap), *command)
        })
        .filter(|((score, _), _)| *score <= 2)
        .min()
        .map(|(_, command)| command)
}

/// `stats --json` style: the explicit JSON flag for the command's result.
pub(crate) fn wants_json(args: &[String]) -> bool {
    args.iter()
        .any(|arg| arg == "--json" || arg == "--health-json")
}

fn humanize(code: &str) -> String {
    let words = code.replace('_', " ");
    let mut chars = words.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => "Unknown error".to_owned(),
    }
}

/// Explain one fixed code for the command in `args`.
pub(crate) fn explain(code: &str, args: &[String]) -> Explained {
    let command = args
        .first()
        .map(String::as_str)
        .filter(|command| COMMANDS.contains(command))
        .unwrap_or("");
    let dir = option_value(args, "--state-dir").map_or_else(|| "DIR".to_owned(), quote);
    let key = option_value(args, "--key-file").map_or_else(|| "KEY".to_owned(), quote);
    let help = if command.is_empty() {
        "aicharts --help".to_owned()
    } else {
        format!("aicharts {command} --help")
    };
    let again = if args.is_empty() || args.iter().map(String::len).sum::<usize>() > 160 {
        format!("aicharts {command} …")
    } else {
        let joined: Vec<String> = args.iter().map(|arg| quote(arg)).collect();
        format!("aicharts {}", joined.join(" "))
    };
    let diagnose = format!("aicharts account --state-dir {dir} --diagnose");
    let explained = |message: &str, next: String| Explained {
        message: message.to_owned(),
        next,
    };
    match code {
        // Usage errors point at the command's own page.
        "invalid_command" => {
            let input = args.first().map_or("", String::as_str);
            let message = match closest_command(input) {
                Some(suggestion) => {
                    format!("Unknown command \"{input}\". Did you mean \"{suggestion}\"?")
                }
                None => format!("Unknown command \"{input}\"."),
            };
            Explained {
                message,
                next: "aicharts --help".to_owned(),
            }
        }
        "unknown_help_topic" => Explained {
            message: format!(
                "No help topic named \"{}\".",
                args.get(1..).unwrap_or_default().join(" ")
            ),
            next: "aicharts --help".to_owned(),
        },
        "invalid_option" => explained(
            "One of those options isn't used by this command, or appears twice.",
            help,
        ),
        "missing_option_value" => explained("An option is missing its value.", help),
        "invalid_argument_encoding" => {
            explained("An argument isn't valid UTF-8 text.", help)
        }
        "explicit_key_and_source_required" => explained(
            "Name your key file and at least one session file or folder (--codex, --claude or --devin).",
            help,
        ),
        "explicit_source_required" => explained(
            "Name at least one session file or folder with --codex, --claude or --devin.",
            help,
        ),
        "state_directory_required" => explained(
            "Missing --state-dir, the private folder that holds your AI Charts ledger.",
            help,
        ),
        "key_required" => explained(
            "Missing --key-file, the private key you made with aicharts keygen.",
            help,
        ),
        "output_required" => explained("Missing --output, where to save the new key.", help),
        "occurrence_key_required" => explained("Missing --occurrence-key-file.", help),
        "migration_revision_required" => explained(
            "Missing --revision. Use the ledgerRevision that aicharts status prints.",
            format!("aicharts status --state-dir {dir} --key-file {key}"),
        ),
        "invalid_interval" => explained("--interval-seconds is out of range.", help),
        "invalid_retry_attempts" => explained("--retry-attempts must be 0 to 8.", help),
        "invalid_publish_interval" => explained(
            "--publish-interval-seconds must be at least 300.",
            help,
        ),
        "invalid_batch_limit" => explained("--max-batches must be 1 to 64.", help),
        "invalid_page_limit" => explained("--limit must be 1 to 256.", help),
        "invalid_version_arguments" => explained(
            "--version takes no other options except --json.",
            "aicharts --version".to_owned(),
        ),
        "upload_not_enabled_use_dry_run" => explained(
            "Add --dry-run to preview batches without sending anything.",
            "aicharts upload --help".to_owned(),
        ),
        "too_many_sources" => explained(
            "Too many session files. Name at most 2,048.",
            help,
        ),
        "stats_client_required" => explained(
            "Choose which agents to read: --all, or --client with an ID.",
            "aicharts stats --list-clients".to_owned(),
        ),
        "stats_date_invalid" => explained(
            "Dates must be YYYY-MM-DD, with --since no later than --until, at most 366 days apart.",
            help,
        ),

        // Keys and session files.
        "key_permissions_must_be_private" => explained(
            "The key file can be read by other users, so AI Charts won't use it.",
            format!("chmod 600 {key}"),
        ),
        "invalid_key_file" => explained(
            "That file isn't an AI Charts key. Keys are exactly 32 random bytes.",
            "aicharts help keygen".to_owned(),
        ),
        "key_read_failed" => explained("Couldn't read the key file.", format!("ls -l {key}")),
        "key_create_failed" => explained(
            "Couldn't create the key file. Its folder must already exist, and keygen never overwrites a file.",
            "aicharts help keygen".to_owned(),
        ),
        "no_source_files" => explained(
            "No session files were found where you pointed.",
            help,
        ),
        "source_symlink_not_allowed" => explained(
            "A session path is a symbolic link. Name the real file or folder.",
            help,
        ),
        "source_parse_failed" | "turn_malformed_record" => explained(
            "A session file isn't in a format AI Charts can read.",
            help,
        ),
        "file_not_regular" | "source_not_regular" => explained(
            "A session path isn't a regular file or folder.",
            help,
        ),
        "file_open_failed" | "source_read_failed" | "source_metadata_failed"
        | "source_directory_failed" => {
            explained("Couldn't read one of the session files.", help)
        }
        "source_byte_limit" => explained(
            "The session files add up to more than 256 MB. Name fewer files or a smaller folder.",
            help,
        ),
        "source_file_limit" | "source_entry_limit" | "source_depth_limit" => explained(
            "That folder holds too many files to read in one pass. Name a smaller folder.",
            help,
        ),
        "source_changed_during_scan" | "key_changed_during_scan" | "file_changed_during_open"
        | "source_history_changed" => explained(
            "A file changed while AI Charts was reading it. Nothing was saved from this pass.",
            again,
        ),

        // The local ledger.
        "ledger_busy_retry" | "ledger_unavailable" | "attempt_busy" | "stats_sync_busy"
        | "contribution_sync_busy" | "source_refresh_busy" => explained(
            "Another AI Charts process is using this folder right now.",
            again,
        ),
        "ledger_namespace_mismatch" => explained(
            "This key doesn't match the ledger in that folder.",
            format!("aicharts inspect --state-dir {dir} --key-file {key}"),
        ),
        "ledger_private_state_required" => explained(
            "That folder already has a ledger or files AI Charts didn't create.",
            format!("aicharts status --state-dir {dir} --key-file {key}"),
        ),

        // Enrollment, keychain and publishing.
        "upload_not_enrolled" => explained(
            "This Mac isn't connected to an AI Charts account yet.",
            format!("aicharts enroll --state-dir {dir}"),
        ),
        "attempt_recovery_required" => explained(
            "An earlier connection to your account didn't finish.",
            format!("aicharts enroll --state-dir {dir}"),
        ),
        "custody_interaction_required" => explained(
            "macOS needs you to approve AI Charts' saved keys again, usually after an update.",
            diagnose,
        ),
        "attempt_custody" | "custody" | "local_custody" | "custody_construct" => explained(
            "AI Charts couldn't read its saved keys from your login keychain.",
            diagnose,
        ),
        "upload_recovery_required" => explained(
            "An earlier upload is still waiting for its reply. AI Charts never resends on a guess.",
            format!("aicharts upload --state-dir {dir} --key-file {key} --resume"),
        ),
        "upload_device_revoked" | "stats_sync_revoked" | "contribution_sync_revoked" => {
            explained(
                "This Mac was removed from your AI Charts account.",
                format!("aicharts account --state-dir {dir}"),
            )
        }
        "upload_requires_qualified_macos_custody"
        | "sync_requires_qualified_macos_custody"
        | "persistent_state_requires_qualified_macos_custody"
        | "stats_sync_requires_qualified_macos_custody"
        | "enroll_requires_qualified_macos_custody"
        | "contribution_sync_requires_qualified_macos_custody" => explained(
            "Publishing to AI Charts works only on macOS for now. Local reports work everywhere.",
            "aicharts stats --list-clients".to_owned(),
        ),
        "upload_transport_unauthorized" => explained(
            "AI Charts didn't accept this Mac's saved sign-in.",
            format!("aicharts account --state-dir {dir} --diagnose"),
        ),
        "upload_transport_uncertain" => explained(
            "The connection dropped before AI Charts replied. The same batch is kept to resend.",
            format!("aicharts upload --state-dir {dir} --key-file {key} --resume"),
        ),
        "stats_sync_exchange_uncertain" | "contribution_sync_exchange_uncertain" => explained(
            "The connection dropped before AI Charts replied. The same batch is kept to resend.",
            again,
        ),
        "upload_transport_blocked" => explained(
            "AI Charts isn't accepting uploads from this Mac right now. Nothing was sent.",
            format!("aicharts account --state-dir {dir} --diagnose"),
        ),
        _ if code.contains("transport") || code.ends_with("_timeout") => explained(
            "Couldn't reach the service. Check your internet connection and try again.",
            again,
        ),
        _ => Explained {
            message: format!("{}.", humanize(code)),
            next: if command.is_empty() {
                "aicharts --help".to_owned()
            } else {
                format!("aicharts help {command}")
            },
        },
    }
}

/// The stderr lines for `code`, for the given audience and style.
pub(crate) fn render(
    code: &str,
    args: &[String],
    audience: Audience,
    style: Style,
    debug: bool,
) -> String {
    match audience {
        Audience::Human => {
            let explained = explain(code, args);
            let mut text = format!(
                "{} {}\n{} {}\n",
                style.fail(),
                explained.message,
                style.next(),
                explained.next
            );
            if debug {
                text.push_str(&format!("  code: {code}\n"));
            }
            text
        }
        // Scripts and agents keep the fixed one-line contract.
        Audience::Agent | Audience::Quiet => format!("aicharts: {code}\n"),
    }
}

fn debug_enabled(args: &[String]) -> bool {
    args.iter().any(|arg| arg == "--debug")
        || std::env::var("HRANESS_DEBUG").is_ok_and(|value| value == "1")
}

/// Write the stderr form of `code` for the current process.
pub(crate) fn report_stderr(code: &str, args: &[String]) {
    let text = render(
        code,
        args,
        cli_style::detect_current(),
        Style::stderr(),
        debug_enabled(args),
    );
    let _ = std::io::stderr().write_all(text.as_bytes());
}

/// Report a command failure. With `--json` the fixed one-line code is the
/// whole contract (stdout stays empty, as every refusal test pins); otherwise
/// stderr gets the form for the current audience.
pub(crate) fn report(code: &str, args: &[String]) {
    if wants_json(args) {
        let _ = writeln!(std::io::stderr(), "aicharts: {code}");
        return;
    }
    report_stderr(code, args);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    fn human(code: &str, values: &[&str]) -> String {
        render(code, &args(values), Audience::Human, Style::plain(), false)
    }

    #[test]
    fn usage_errors_name_the_problem_and_the_command_page() {
        assert_eq!(
            human("state_directory_required", &["status"]),
            "✗ Missing --state-dir, the private folder that holds your AI Charts ledger.\n→ aicharts status --help\n"
        );
        assert_eq!(
            human("invalid_command", &["stauts"]),
            "✗ Unknown command \"stauts\". Did you mean \"status\"?\n→ aicharts --help\n"
        );
        assert_eq!(
            human("invalid_command", &["zzzzzzzz"]),
            "✗ Unknown command \"zzzzzzzz\".\n→ aicharts --help\n"
        );
        assert_eq!(
            human("stats_client_required", &["stats", "--home", "/h"]),
            "✗ Choose which agents to read: --all, or --client with an ID.\n→ aicharts stats --list-clients\n"
        );
    }

    #[test]
    fn next_steps_reuse_the_folders_the_person_typed() {
        assert_eq!(
            human(
                "upload_recovery_required",
                &["upload", "--state-dir", "/p/my state", "--key-file", "/p/key"]
            ),
            "✗ An earlier upload is still waiting for its reply. AI Charts never resends on a guess.\n→ aicharts upload --state-dir '/p/my state' --key-file /p/key --resume\n"
        );
        assert_eq!(
            human("custody_interaction_required", &["sync", "--state-dir", "/s"]),
            "✗ macOS needs you to approve AI Charts' saved keys again, usually after an update.\n→ aicharts account --state-dir /s --diagnose\n"
        );
        assert_eq!(
            human("key_permissions_must_be_private", &["init", "--key-file", "/k"]),
            "✗ The key file can be read by other users, so AI Charts won't use it.\n→ chmod 600 /k\n"
        );
        assert_eq!(
            human("source_changed_during_scan", &["collect", "--state-dir", "/s"]),
            "✗ A file changed while AI Charts was reading it. Nothing was saved from this pass.\n→ aicharts collect --state-dir /s\n"
        );
    }

    #[test]
    fn upload_failures_point_at_the_right_recovery() {
        let upload = ["upload", "--state-dir", "/s", "--key-file", "/k"];
        assert_eq!(
            explain("upload_transport_uncertain", &args(&upload)).next,
            "aicharts upload --state-dir /s --key-file /k --resume"
        );
        let blocked = explain("upload_transport_blocked", &args(&upload));
        assert!(!blocked.message.contains("internet"), "{blocked:?}");
        assert_eq!(blocked.next, "aicharts account --state-dir /s --diagnose");
    }

    #[test]
    fn network_and_unknown_codes_still_read_as_sentences() {
        assert_eq!(
            explain("warp_refresh_timeout", &args(&["refresh", "warp"])).message,
            "Couldn't reach the service. Check your internet connection and try again."
        );
        assert_eq!(
            explain("stats_sync_limit", &args(&["stats-sync"])),
            Explained {
                message: "Stats sync limit.".into(),
                next: "aicharts help stats-sync".into()
            }
        );
    }

    #[test]
    fn every_code_renders_one_sentence_and_one_next_command() {
        for code in [
            "invalid_option",
            "missing_option_value",
            "explicit_key_and_source_required",
            "key_required",
            "ledger_namespace_mismatch",
            "upload_not_enrolled",
            "attempt_custody",
            "upload_requires_qualified_macos_custody",
            "something_new",
        ] {
            let text = human(code, &["collect"]);
            let lines: Vec<&str> = text.lines().collect();
            assert_eq!(lines.len(), 2, "{code}: {text}");
            assert!(
                lines[0].starts_with("✗ ") && lines[0].ends_with(['.', '?']),
                "{text}"
            );
            assert!(lines[1].starts_with("→ "), "{text}");
            assert!(!text.contains('_') || text.contains("--"), "{code}: {text}");
        }
    }

    #[test]
    fn scripts_and_agents_keep_the_fixed_code_line() {
        for audience in [Audience::Agent, Audience::Quiet] {
            assert_eq!(
                render(
                    "invalid_option",
                    &args(&["status"]),
                    audience,
                    Style::plain(),
                    false
                ),
                "aicharts: invalid_option\n"
            );
        }
        let debug = render(
            "invalid_option",
            &args(&["status"]),
            Audience::Human,
            Style::plain(),
            true,
        );
        assert!(debug.ends_with("  code: invalid_option\n"));
    }

    #[test]
    fn ascii_terminals_get_the_fallback_symbols() {
        let style = Style {
            color: false,
            ascii: true,
        };
        assert_eq!(
            render("key_required", &args(&["status"]), Audience::Human, style, false),
            "FAIL Missing --key-file, the private key you made with aicharts keygen.\n-> aicharts status --help\n"
        );
    }
}
