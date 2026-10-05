# aicharts commands for status, outputs and support

The aicharts menu bar is retired. Everything it showed or did is now an
`aicharts` command. Add `--json` to any command below and it prints one JSON
object with `ok`, `schema`, `generatedAt` and either `data` or `error`.
`aicharts commands --json` prints the list for an agent to read.

## Who runs what

The background collector (`aicharts daemon`, installed with
`aicharts service install`) does the work. These commands read the files it
writes in `~/.aicharts` (or `AICHARTS_HOME`), open fixed pages, and never
start, stop or signal it.

Each command has one of three kinds:

- **read** only looks. It never changes anything.
- **operate** opens a page or file, or sets aside a retired login item. An
  agent may run it.
- **decide** changes what starts at login, so a person makes the call. The
  command shows what it will change and asks for a one-time code on your
  terminal (`/dev/tty`). Run from an agent, from a script with no terminal,
  or with `--json` outside a person's terminal, it stops with
  `human-required` (exit 3), changes nothing, and names the command to run
  yourself. `aicharts setup` asks the same way before its collector step.
  After it is set up, macOS shows a notice, and System Settings › General ›
  Login Items turns it off.

There are no desktop notifications.

Error codes and exit statuses: `usage` 2, `not-found` 1, `conflict` 5,
`unsupported-platform` 1, `human-required`, `gate-failed` and
`gate-expired` 3.

## Every menu item

| Menu item | Id | Command | Kind |
| --- | --- | --- | --- |
| Collection status rows and the attention dot | `status` | `aicharts status` | read |
| Open usage dashboard | `dashboard` | `aicharts open dashboard` | operate |
| Setup guide (first run) | `setup.guide` | `aicharts open setup-guide` | operate |
| Show error log | `errors.open` | `aicharts open error-log` | operate |
| Show error log in Finder | `errors.reveal` | `aicharts open error-log --reveal` | operate |
| An output file | `outputs.open.fileN` | `aicharts outputs open NAME` | operate |
| Show the output file in Finder | `outputs.reveal.fileN` | `aicharts outputs reveal NAME` | operate |
| Open outputs folder | `outputs.folder` | `aicharts open outputs` | operate |
| Show all N outputs | `outputs.all` | `aicharts outputs --all` | read |
| Open at login | `login` | `aicharts service install` and `aicharts service uninstall` | decide |
| Updates & support | `support` | `aicharts open support` | operate |
| Copy diagnostics | `support.diagnostics` | `aicharts diagnostics` | read |
| Quit AI Charts | none | Nothing to quit: the collector keeps running. `aicharts service uninstall` stops it at login. | n/a |

`aicharts open … --print` prints the address or path instead of opening it.

## Every command

| Command | Kind | What it does |
| --- | --- | --- |
| `status` | read | Collector and publishing health: last pass, last sync, failures, error log, newest outputs |
| `status --state-dir DIR --key-file KEY` | read | The local ledger, as before |
| `commands` | read | Every command with its kind |
| `doctor` | read | Collector files, the background collector and retired login items |
| `doctor retire` | operate | Set aside the retired menu bar's login item |
| `open TARGET` | operate | Open `dashboard`, `setup-guide`, `support`, `error-log` or `outputs` |
| `outputs` | read | The newest files in the outputs folder (`--all` for up to 500) |
| `outputs open NAME` | operate | Open one output file |
| `outputs reveal NAME` | operate | Show one output file in Finder |
| `diagnostics` | read | Version and error codes to paste into a support request |
| `service status` | read | Whether the background collector is installed and running |
| `service install` | decide | Run the collector at login |
| `service uninstall` | decide | Stop running the collector at login |

## Moving off the menu bar

The menu bar opened at login through `~/Library/LaunchAgents/app.hraness.aicharts.plist`
(or the older `app.hraness.companion.aicharts.plist`). `aicharts status` and
`aicharts doctor` say when one is still there, and `aicharts doctor retire`:

1. checks that the file is a regular file you own that starts the menu bar,
2. unloads that one login item with `launchctl bootout`,
3. renames the file to `NAME.retired-TIME` in the same folder, and
4. prints the command that puts it back.

It never deletes a file, never signals a process, and leaves the collector's
`io.aicharts.daemon` login item and any file that starts something else alone.
If the renamed copy already exists, it stops with `conflict` and changes
nothing.
