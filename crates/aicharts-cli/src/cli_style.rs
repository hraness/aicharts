//! Audience detection and terminal symbols from the Hraness CLI style contract.
//!
//! TODO(df-0.8): use detectAudience and the symbol helpers from the
//! `hraness-cli-kit` crate in hraness/desktop-foundation once 0.8.0 ships.
//! This is a verbatim copy of the shared rule so AI Charts reads like every
//! other Hraness CLI until then.

use std::io::IsTerminal;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Audience {
    Human,
    Agent,
    Quiet,
}

/// Exact agent markers. Prefixes never count: `CODEX_HOME` is human configuration.
const AGENT_MARKERS: &[&str] = &[
    "AI_AGENT",
    "CLAUDECODE",
    "CODEX_SANDBOX",
    "CODEX_SANDBOX_NETWORK_DISABLED",
    "CURSOR_AGENT",
    "GEMINI_CLI",
];

pub(crate) fn detect(env: &dyn Fn(&str) -> Option<String>, stderr_is_tty: bool) -> Audience {
    match env("HRANESS_AUDIENCE").as_deref() {
        Some("human") => return Audience::Human,
        Some("agent") => return Audience::Agent,
        Some("quiet" | "off") => return Audience::Quiet,
        _ => {}
    }
    if AGENT_MARKERS
        .iter()
        .any(|name| env(name).is_some_and(|value| !value.is_empty()))
    {
        return Audience::Agent;
    }
    if stderr_is_tty {
        Audience::Human
    } else {
        Audience::Quiet
    }
}

pub(crate) fn detect_current() -> Audience {
    detect(
        &|name| std::env::var(name).ok(),
        std::io::stderr().is_terminal(),
    )
}

/// How symbols and color render on one stream.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Style {
    pub(crate) color: bool,
    pub(crate) ascii: bool,
}

// `ok`, `warn`, `progress` and `notice` serve enroll progress and keychain
// notices, which land in a follow-up change.
#[allow(dead_code)]
impl Style {
    pub(crate) fn plain() -> Self {
        Style {
            color: false,
            ascii: false,
        }
    }

    pub(crate) fn detect(env: &dyn Fn(&str) -> Option<String>, stream_is_tty: bool) -> Self {
        let term = env("TERM");
        let dumb = term.as_deref() == Some("dumb");
        let forced = env("FORCE_COLOR").as_deref() == Some("1");
        let no_color = env("NO_COLOR").is_some_and(|value| !value.is_empty());
        let color = forced || (stream_is_tty && !dumb && !no_color);
        let utf8 = ["LC_ALL", "LC_CTYPE", "LANG"].iter().any(|name| {
            env(name).is_some_and(|value| {
                let value = value.to_ascii_lowercase();
                value.contains("utf-8") || value.contains("utf8")
            })
        });
        let ascii = dumb || !utf8 || env("HRANESS_ASCII").as_deref() == Some("1");
        Style { color, ascii }
    }

    pub(crate) fn stderr() -> Self {
        Self::detect(
            &|name| std::env::var(name).ok(),
            std::io::stderr().is_terminal(),
        )
    }

    fn paint(self, symbol: &str, ascii: &str, code: &str) -> String {
        let text = if self.ascii { ascii } else { symbol };
        if self.color && !code.is_empty() {
            format!("\x1b[{code}m{text}\x1b[0m")
        } else {
            text.to_owned()
        }
    }

    pub(crate) fn ok(self) -> String {
        self.paint("✓", "OK", "32")
    }
    pub(crate) fn fail(self) -> String {
        self.paint("✗", "FAIL", "31")
    }
    pub(crate) fn warn(self) -> String {
        self.paint("⚠", "WARN", "33")
    }
    pub(crate) fn next(self) -> String {
        self.paint("→", "->", "2")
    }
    pub(crate) fn progress(self) -> String {
        self.paint("↻", "...", "")
    }
    pub(crate) fn notice(self) -> String {
        self.paint("🔐", "NOTE", "")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: BTreeMap<String, String> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        move |name| map.get(name).cloned()
    }

    #[test]
    fn audience_follows_the_shared_rule() {
        assert_eq!(detect(&env(&[]), true), Audience::Human);
        assert_eq!(detect(&env(&[]), false), Audience::Quiet);
        assert_eq!(detect(&env(&[("CLAUDECODE", "1")]), true), Audience::Agent);
        assert_eq!(detect(&env(&[("CLAUDECODE", "")]), true), Audience::Human);
        assert_eq!(detect(&env(&[("CODEX_HOME", "/x")]), true), Audience::Human);
        assert_eq!(
            detect(
                &env(&[("CLAUDECODE", "1"), ("HRANESS_AUDIENCE", "human")]),
                false
            ),
            Audience::Human
        );
        assert_eq!(
            detect(&env(&[("HRANESS_AUDIENCE", "off")]), true),
            Audience::Quiet
        );
        assert_eq!(
            detect(&env(&[("HRANESS_AUDIENCE", "robot")]), true),
            Audience::Human
        );
    }

    #[test]
    fn symbols_respect_no_color_dumb_terminals_and_locale() {
        let utf8 = [("LANG", "en_US.UTF-8")];
        let style = Style::detect(&env(&utf8), true);
        assert_eq!(style.fail(), "\x1b[31m✗\x1b[0m");
        let style = Style::detect(&env(&[("LANG", "en_US.UTF-8"), ("NO_COLOR", "1")]), true);
        assert_eq!(style.fail(), "✗");
        assert_eq!(style.next(), "→");
        let style = Style::detect(&env(&utf8), false);
        assert_eq!(style.ok(), "✓");
        let style = Style::detect(&env(&[("LANG", "en_US.UTF-8"), ("TERM", "dumb")]), true);
        assert_eq!((style.fail(), style.next()), ("FAIL".into(), "->".into()));
        let style = Style::detect(&env(&[]), false);
        assert_eq!(style.warn(), "WARN");
        let style = Style::detect(&env(&[("LANG", "C.UTF-8"), ("HRANESS_ASCII", "1")]), false);
        assert_eq!(style.notice(), "NOTE");
    }
}
