//! The notice before macOS asks to re-approve AI Charts' saved keys.
//!
//! Normal commands read the keychain with prompts suppressed. Only an explicit
//! `AICHARTS_CUSTODY_INTERACTION=allow` lets macOS show its dialog, so that is
//! the one place a person needs to hear what is coming. The copy follows the
//! shared `keychain` template (Hraness permissions kit, Appendix B).
//! TODO(df-0.8): render through `hraness-cli-kit` permissions once 0.8.0 ships.

use std::io::{BufRead, IsTerminal, Write};

use crate::cli_style::{self, Audience, Style};

const CONSENT_VARIABLE: &str = "AICHARTS_CUSTODY_INTERACTION";

/// Commands that read AI Charts' saved keys.
const KEYCHAIN_COMMANDS: &[&str] = &[
    "account",
    "autosubmit",
    "contribution-sync",
    "daemon",
    "enroll",
    "init",
    "stats-sync",
    "stats-totals",
    "sync",
    "upload",
];

pub(crate) fn render(style: Style, confirm: bool) -> String {
    let mut text = format!(
        "{} macOS will ask to let aicharts use its saved keys from your keychain for AI Charts.\n   AI Charts reads the keys it saved when this Mac was connected. Enter your Mac password if asked, then choose Always Allow so macOS doesn't ask again.\n",
        style.notice()
    );
    if confirm {
        text.push_str("   Press Enter to continue · s to skip\n");
    }
    text
}

/// What the person chose.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Outcome {
    Continue,
    Skip,
}

pub(crate) fn applies(args: &[String], consent: Option<&str>) -> bool {
    consent == Some("allow")
        && args
            .first()
            .is_some_and(|command| KEYCHAIN_COMMANDS.contains(&command.as_str()))
        && !args
            .iter()
            .any(|arg| matches!(arg.as_str(), "--help" | "-h"))
}

/// Show the notice for a person at a terminal and wait for Enter or `s`
/// when stdin is a terminal too. Scripts and agents see nothing.
pub(crate) fn before_keychain(args: &[String]) -> Outcome {
    let consent = std::env::var(CONSENT_VARIABLE).ok();
    if !applies(args, consent.as_deref()) || cli_style::detect_current() != Audience::Human {
        return Outcome::Continue;
    }
    let confirm = std::io::stdin().is_terminal() && std::io::stderr().is_terminal();
    let _ = std::io::stderr().write_all(render(Style::stderr(), confirm).as_bytes());
    if !confirm {
        return Outcome::Continue;
    }
    let mut answer = String::new();
    match std::io::stdin().lock().read_line(&mut answer) {
        Ok(_) if answer.trim().eq_ignore_ascii_case("s") => Outcome::Skip,
        _ => Outcome::Continue,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn the_notice_follows_the_keychain_template() {
        assert_eq!(
            render(Style::plain(), true),
            "🔐 macOS will ask to let aicharts use its saved keys from your keychain for AI Charts.\n   AI Charts reads the keys it saved when this Mac was connected. Enter your Mac password if asked, then choose Always Allow so macOS doesn't ask again.\n   Press Enter to continue · s to skip\n"
        );
        let ascii = Style {
            color: false,
            ascii: true,
        };
        assert!(render(ascii, false).starts_with("NOTE macOS will ask"));
        assert!(!render(ascii, false).contains("Press Enter"));
    }

    #[test]
    fn only_an_explicit_allow_on_a_keychain_command_shows_it() {
        let account = args(&["account", "--state-dir", "/s", "--diagnose"]);
        assert!(applies(&account, Some("allow")));
        assert!(!applies(&account, None));
        assert!(!applies(&account, Some("")));
        assert!(!applies(&account, Some("yes")));
        assert!(!applies(&args(&["stats", "--all"]), Some("allow")));
        assert!(!applies(&args(&["account", "--help"]), Some("allow")));
    }
}
