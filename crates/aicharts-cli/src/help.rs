//! Human help: the bare overview, grouped root help, topics and the
//! per-command pages that runners do not own themselves.
//!
//! Layout follows the Hraness CLI style contract (SPEC § D2/D3): bare
//! invocation stays within 25 lines, root help within 60, and every
//! `COMMAND --help`, `COMMAND -h` and `help COMMAND` prints the same page and
//! exits 0.

pub(crate) const TAGLINE: &str =
    "AI Charts measures your coding agents' token use on this computer.";

pub(crate) fn overview() -> String {
    format!(
        "{TAGLINE}

Start here
  aicharts stats --list-clients     List the agents AI Charts can read
  aicharts stats --home ~ --all     Show the last 30 days of token use
  aicharts help publish             Publish your usage to aicharts.io

Everyday
  aicharts stats [options]          Token use by day, agent and model
  aicharts sync [options]           Collect and publish once
  aicharts status [options]         Check your local usage ledger

All commands: aicharts --help · Topics: aicharts help <topic>
aicharts {}
",
        env!("CARGO_PKG_VERSION")
    )
}

pub(crate) fn root() -> String {
    format!(
        "Usage: aicharts <command> [options]

{TAGLINE}

Start here
  stats --list-clients     List the agents AI Charts can read
  stats --home ~ --all     Show the last 30 days of token use
  help publish             Publish your usage to aicharts.io

Reports (read-only; nothing is uploaded)
  stats                    Token use by day, agent and model
  stats-health             Check which session files a report could read
  turns                    Runtime and partial token counts per turn
  sessions                 Token counts per session
  usage                    Token totals from session files you name

Publish to aicharts.io (macOS)
  keygen                   Create the private key for your local ledger
  enroll                   Connect this Mac to your AI Charts account
  init                     Create the local usage ledger
  prefix-enable            Let collection skip lines it already read
  sync                     Collect and publish once
  status                   Check the local usage ledger
  account                  Show which account this Mac is connected to

Automatic publishing
  daemon                   Keep collecting every 15 minutes
  autosubmit               Run one scheduled publishing cycle
  refresh                  Save usage from a provider account (Cursor, Warp)

Options
  -h, --help               Show help (also: aicharts help <command>)
  -V, --version            Show the version
  --json                   Print machine-readable output (most commands)

Topics: aicharts help publish · aicharts help advanced
Optional support: aicharts support · Turn off: HRANESS_SUPPORT=off
"
    )
}

const PUBLISH: &str = "Publish your usage to aicharts.io

Publishing needs macOS and an AI Charts account. Nothing is sent until you run
sync or upload, and only token counts leave this Mac, never prompts or code.

Steps, in order (use the same private folder and key every time):
  1. mkdir -m 700 ~/.aicharts
  2. aicharts keygen --output ~/.aicharts/key
  3. aicharts enroll --state-dir ~/.aicharts/state
  4. aicharts init --state-dir ~/.aicharts/state --key-file ~/.aicharts/key
  5. aicharts prefix-enable --state-dir ~/.aicharts/state
       --key-file ~/.aicharts/key --revision N   (N from aicharts status)
  6. aicharts collect-prefix --state-dir ~/.aicharts/state
       --key-file ~/.aicharts/key --claude ~/.claude/projects
  7. aicharts upload --state-dir ~/.aicharts/state --key-file ~/.aicharts/key
  8. aicharts sync --complete-prefix --state-dir ~/.aicharts/state
       --key-file ~/.aicharts/key --claude ~/.claude/projects

Keep the key file. Changing it changes how your sessions are counted.
To publish on a schedule: aicharts help autosubmit
Guide: https://github.com/hraness/aicharts/blob/main/docs/usage-local.md
";

const ADVANCED: &str = "Advanced and maintenance commands

Ledger maintenance
  collect             Read session files into the local ledger
  collect-prefix      Collect completed lines only (after prefix-enable)
  inspect             Read ledger totals without scanning or changing files
  outbox              Preview the batches waiting to be sent
  upgrade             Upgrade an older ledger after inspect
  reindex-plan        Check whether a ledger can move to a new key
  reindex-prepare     Build a new ledger under a new key, leaving the old one

Publishing internals
  upload              Send one waiting batch, or preview one (--dry-run)
  stats-sync          Publish one agent's report snapshot
  stats-totals        Read your account's lifetime totals
  contribution-sync   Send contribution batches for a configured source
  capture mcode       Run mcode and keep its token counts

Agents and scripts
  support protocol --json   Machine-readable support handoff

Every command answers aicharts help <command>.
";

/// Pages for commands whose runners do not print their own focused help.
fn command_page(command: &str) -> Option<&'static str> {
    Some(match command {
        "usage" => {
            "Usage: aicharts usage --key-file KEY (--codex | --claude | --devin) PATH ... [--json]

Add up the tokens in session files you name. Nothing is uploaded and no ledger
is opened. Directories are scanned for .jsonl files (.json ATIF files for
--devin); symbolic links are skipped.

Options
  --key-file KEY     Your 32-byte private key (see aicharts keygen)
  --codex PATH       Codex session file or folder (repeatable)
  --claude PATH      Claude Code project file or folder (repeatable)
  --devin PATH       Devin ATIF export file or folder (repeatable)
  --json             Print machine-readable output

Example
  aicharts usage --key-file ~/.aicharts/key --claude ~/.claude/projects
"
        }
        "upload" => {
            "Usage: aicharts upload --state-dir DIR --key-file KEY [--resume]
       aicharts upload --dry-run --key-file KEY (--codex | --claude | --devin) PATH ...

Send at most one waiting batch of token counts to AI Charts. This needs an
enrolled Mac (aicharts enroll). The local ledger changes only after the service
confirms the batch. If the reply is lost, the same batch is kept for --resume;
nothing is ever resent on a guess.

--dry-run reads the files you name and prints the batches that would be sent,
as hex JSON. It never contacts the service.

Options
  --state-dir DIR    Your private AI Charts folder
  --key-file KEY     The key you created with aicharts keygen
  --resume           Resend the batch kept after an uncertain reply
  --dry-run          Preview batches from the named files only

Example
  aicharts upload --state-dir ~/.aicharts/state --key-file ~/.aicharts/key
"
        }
        "keygen" => {
            "Usage: aicharts keygen --output PATH

Create a new private key file (32 random bytes, readable only by you). It never
overwrites an existing file and reads no data.

Keep this file. Changing the key changes how your sessions are counted.

Example
  aicharts keygen --output ~/.aicharts/key
"
        }
        "init" => {
            "Usage: aicharts init --state-dir DIR --key-file KEY

Create the local usage ledger in DIR. On an enrolled Mac the ledger is tied to
your account. It refuses if a ledger already exists there.

Example
  aicharts init --state-dir ~/.aicharts/state --key-file ~/.aicharts/key
"
        }
        "collect" | "collect-prefix" => {
            "Usage: aicharts collect --state-dir DIR --key-file KEY (--codex | --claude | --devin) PATH ... [--rescan] [--json]
       aicharts collect-prefix --state-dir DIR --key-file KEY (--codex | --claude | --devin) PATH ... [--rescan] [--json]

Read session files into the local ledger. Unchanged files are skipped. Files
that are still being written wait until a later pass. Nothing is uploaded.

collect-prefix reads only completed lines and leaves an unfinished last line
for later. Run aicharts prefix-enable once before using it.

Options
  --codex PATH       Codex session file or folder (repeatable)
  --claude PATH      Claude Code project file or folder (repeatable)
  --devin PATH       Devin ATIF export file or folder (repeatable)
  --rescan           Re-read every file instead of skipping unchanged ones
  --json             Print machine-readable output

Example
  aicharts collect --state-dir ~/.aicharts/state --key-file ~/.aicharts/key --claude ~/.claude/projects
"
        }
        "prefix-enable" => {
            "Usage: aicharts prefix-enable --state-dir DIR --key-file KEY --revision N

Let the ledger remember how far each file was read, so later collection can skip
completed lines. N is the ledgerRevision from your last collect or status. After
this, use collect-prefix or sync --complete-prefix. It uploads nothing.

Example
  aicharts prefix-enable --state-dir ~/.aicharts/state --key-file ~/.aicharts/key --revision 3
"
        }
        "upgrade" => {
            "Usage: aicharts upgrade --state-dir DIR --key-file KEY --revision N --backup-dir NEW_DIR [--occurrence-key-file KEY]

Upgrade a ledger made by an older version. Run aicharts inspect first and pass
its revision. A full copy goes to NEW_DIR first. Ledgers with conflicting
history are left untouched and stay blocked; never delete them to get unstuck.

Example
  aicharts upgrade --state-dir ~/.aicharts/state --key-file ~/.aicharts/key --revision 3 --backup-dir ~/aicharts-backup
"
        }
        "status" => {
            "Usage: aicharts status --state-dir DIR --key-file KEY [--json]

Show what the local ledger holds and how many batches are waiting to be sent.
It can finish an interrupted database write, but never scans files or uploads.

Example
  aicharts status --state-dir ~/.aicharts/state --key-file ~/.aicharts/key
"
        }
        "outbox" => {
            "Usage: aicharts outbox --dry-run --state-dir DIR --key-file KEY [--limit 1..256] [--after ID --revision N]

List batches waiting to be sent, one page at a time. It never sends or marks
anything as sent. To see the next page, pass the previous page's nextAfter as
--after and its ledgerRevision as --revision.

Example
  aicharts outbox --dry-run --state-dir ~/.aicharts/state --key-file ~/.aicharts/key
"
        }
        "inspect" => {
            "Usage: aicharts inspect --state-dir DIR --key-file KEY [--occurrence-key-file KEY] [--json] [--export-dir NEW_DIR]

Read the totals in an existing ledger without scanning files, repairing the
database or writing anything. It also explains history conflicts that block an
older ledger.

Options
  --export-dir NEW_DIR   Write a private copy of the ledger's numbers there
  --json                 Print machine-readable output

Example
  aicharts inspect --state-dir ~/.aicharts/state --key-file ~/.aicharts/key
"
        }
        "account" => {
            "Usage: aicharts account --state-dir ABSOLUTE_DIR [--json]
       aicharts account --state-dir ABSOLUTE_DIR --diagnose [--json]

Show the AI Charts account and device this Mac is connected to. It reads your
keychain and local files only: it never contacts a server or changes anything. Compare the account ID
with the one on your usage dashboard before publishing.

--diagnose runs the same check and explains what blocks it, without IDs. Use it
when another command says your keychain needs attention.

Example
  aicharts account --state-dir ~/.aicharts/state
"
        }
        "enroll" => {
            "Usage: aicharts enroll --state-dir DIR

Connect this Mac to your AI Charts account. AI Charts saves its keys in your
login keychain and prints a link to approve in your browser. Enrolling uploads
nothing; it only lets you publish later.

Example
  aicharts enroll --state-dir ~/.aicharts/state
"
        }
        "reindex-plan" | "reindex-prepare" => {
            "Usage: aicharts reindex-plan --dry-run --state-dir OLD --key-file KEY (--codex | --claude | --devin) PATH ... [--json]
       aicharts reindex-prepare --state-dir OLD --key-file KEY --shadow-dir NEW --occurrence-key-file KEY (--codex | --claude | --devin) PATH ... [--json]

Move a ledger to a new occurrence key. reindex-plan checks, without writing,
whether every old measurement can be matched again from the files you name.
reindex-prepare builds a new ledger in NEW only when all of them match. Neither
command changes or replaces the old ledger.

Example
  aicharts reindex-plan --dry-run --state-dir ~/.aicharts/state --key-file ~/.aicharts/key --claude ~/.claude/projects
"
        }
        "daemon" => {
            "Usage: aicharts daemon --state-dir DIR --key-file KEY (--codex | --claude | --devin) PATH ... [options]

Keep collecting in the foreground, one pass every 15 minutes. It does not
install a background service; run it from launchd or a terminal you keep open.
Failed passes are reported and retried at the next interval.

Options
  --once                         Run one pass and exit (with its error, if any)
  --complete-prefix              Use collect-prefix (after prefix-enable)
  --interval-seconds N           Wait N seconds between passes
  --retry-attempts 0..8          Retries when the ledger is busy (default 3)
  --publish-config PATH          Also run autosubmit from this configuration
  --publish-interval-seconds N   How often to publish (default 3600, min 300)
  --json                         Machine-readable result (needs --once)

Example
  aicharts daemon --once --state-dir ~/.aicharts/state --key-file ~/.aicharts/key --claude ~/.claude/projects
"
        }
        "stats-health" => {
            "Usage: aicharts stats-health --state-dir DIR --home DIR --client ID [--since YYYY-MM-DD --until YYYY-MM-DD]

Show how the last scans of one agent's files went: what was read, skipped or
left unfinished. It reads only the saved scan record and writes nothing.

Example
  aicharts stats-health --state-dir ~/.aicharts/state --home ~ --client claude
"
        }
        _ => return None,
    })
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Help {
    /// Print this text on stdout and exit 0.
    Page(String),
    /// Rewritten arguments for a runner that owns its own help page.
    Delegate(Vec<String>),
    /// `help` named something that has no page.
    UnknownTopic(String),
}

fn is_help_flag(arg: &str) -> bool {
    matches!(arg, "--help" | "-h")
}

/// Resolve every help form. `None` means the arguments are not a help request.
pub(crate) fn resolve(args: &[String]) -> Option<Help> {
    if args.is_empty() {
        return Some(Help::Page(overview()));
    }
    if args.len() == 1 && (is_help_flag(&args[0]) || args[0] == "help") {
        return Some(Help::Page(root()));
    }
    let (path, _) = if args[0] == "help" {
        (&args[1..], true)
    } else if args.len() >= 2
        && is_help_flag(&args[args.len() - 1])
        // After `--` the arguments belong to another program (capture mcode).
        && !args[..args.len() - 1].iter().any(|arg| arg == "--")
    {
        (&args[..args.len() - 1], false)
    } else {
        return None;
    };
    match path.first().map(String::as_str) {
        Some("publish") if path.len() == 1 => return Some(Help::Page(PUBLISH.to_owned())),
        Some("advanced") if path.len() == 1 => return Some(Help::Page(ADVANCED.to_owned())),
        Some(command) if path.len() == 1 => {
            if let Some(page) = command_page(command) {
                return Some(Help::Page(page.to_owned()));
            }
        }
        _ => {}
    }
    let known = matches!(
        path.first().map(String::as_str),
        Some(
            "stats"
                | "stats-sync"
                | "stats-totals"
                | "turns"
                | "sessions"
                | "sync"
                | "autosubmit"
                | "capture"
                | "contribution-sync"
                | "refresh"
                | "support"
        )
    );
    if !known {
        // `COMMAND --help` for an unknown command stays an ordinary
        // invalid-command error; only `help NAME` reports a missing topic.
        return (args[0] == "help").then(|| Help::UnknownTopic(path.join(" ")));
    }
    let mut delegated = path.to_vec();
    delegated.push("--help".to_owned());
    Some(Help::Delegate(delegated))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    fn page(values: &[&str]) -> String {
        match resolve(&args(values)) {
            Some(Help::Page(text)) => text,
            other => panic!("expected a page for {values:?}, got {other:?}"),
        }
    }

    #[test]
    fn overview_fits_the_first_screen() {
        let text = overview();
        assert!(text.lines().count() <= 25, "{text}");
        assert!(
            text.lines().all(|line| line.chars().count() <= 80),
            "{text}"
        );
        assert!(text.starts_with(TAGLINE));
        assert!(text.ends_with(&format!("aicharts {}\n", env!("CARGO_PKG_VERSION"))));
    }

    #[test]
    fn root_help_is_grouped_and_short() {
        let text = page(&["--help"]);
        assert_eq!(text, page(&["-h"]));
        assert_eq!(text, page(&["help"]));
        assert!(text.starts_with("Usage: aicharts <command> [options]\n"));
        assert!(text.lines().count() <= 60, "{text}");
        assert!(
            text.lines().all(|line| line.chars().count() <= 80),
            "{text}"
        );
        for group in ["Start here", "Reports", "Publish to aicharts.io", "Options"] {
            assert!(text.contains(group), "{group}");
        }
        // Internal vocabulary stays out of root help.
        for jargon in [
            "frozen flight",
            "ATIF",
            "custody",
            "quarantined",
            "canonical frames",
        ] {
            assert!(!text.contains(jargon), "{jargon}");
        }
    }

    #[test]
    fn every_command_form_prints_the_same_page() {
        for command in [
            "usage",
            "upload",
            "keygen",
            "init",
            "collect",
            "collect-prefix",
            "prefix-enable",
            "upgrade",
            "status",
            "outbox",
            "inspect",
            "account",
            "enroll",
            "reindex-plan",
            "reindex-prepare",
            "daemon",
            "stats-health",
        ] {
            let text = page(&[command, "--help"]);
            assert_eq!(text, page(&[command, "-h"]), "{command}");
            assert_eq!(text, page(&["help", command]), "{command}");
            assert!(text.starts_with("Usage: aicharts "), "{command}");
            assert!(text.contains(&format!("aicharts {command}")), "{command}");
            assert!(text.contains("\nExample\n"), "{command}");
        }
    }

    #[test]
    fn runner_owned_pages_are_delegated() {
        assert_eq!(
            resolve(&args(&["help", "stats"])),
            Some(Help::Delegate(args(&["stats", "--help"])))
        );
        assert_eq!(
            resolve(&args(&["help", "refresh", "cursor"])),
            Some(Help::Delegate(args(&["refresh", "cursor", "--help"])))
        );
        assert_eq!(
            resolve(&args(&["sync", "-h"])),
            Some(Help::Delegate(args(&["sync", "--help"])))
        );
        // Arguments after `--` belong to the wrapped program.
        assert_eq!(
            resolve(&args(&[
                "capture",
                "mcode",
                "--cache-dir",
                "/c",
                "--",
                "exec",
                "-h"
            ])),
            None
        );
    }

    #[test]
    fn unknown_topics_and_ordinary_commands_are_not_pages() {
        assert_eq!(
            resolve(&args(&["help", "stauts"])),
            Some(Help::UnknownTopic("stauts".into()))
        );
        assert_eq!(resolve(&args(&["stauts", "--help"])), None);
        assert_eq!(resolve(&args(&["stats", "--home", "/x", "--all"])), None);
        assert_eq!(
            page(&["help", "publish"]).lines().next(),
            Some("Publish your usage to aicharts.io")
        );
        assert!(page(&["help", "advanced"]).contains("reindex-prepare"));
    }
}
