# Contents

- `menubar/` – the `aicharts-menubar` Rust binary: a menu kit v2 status item that shows collector health (`src/health.rs`, `src/menu.rs`), the usage dashboard and the two newest outputs, plus `install | uninstall | status | start` for its login item (`src/lifecycle.rs`).
- `menubar/fixtures/` – one v2 snapshot (`.json`) and text tree (`.txt`) per menu state. `UPDATE_MENU_FIXTURES=1 cargo test` rewrites them; CI lints them with `companion lint-menu --strict`.

# Guidelines

- The menu bar is a disposable client. It reads the collector's `collector-status.json` and `autosubmit-runtime/last-cycle.json` (bounded, read-only), lists the outputs folder, and opens or reveals files. It holds no product authority and never runs the collector.
- Build every menu state through `menu::build` and keep one fixture per state. Menus stay within ten top-level rows, one primary action, sentence case, no paths, IDs or commands; diagnostics live behind ⌥ alternates.
- Login items go through `desktop_foundation::service`; never call `launchctl`. The local `.app` identity stays behind `HRANESS_LOCAL_APP=1` until the clean-account check in desktop-foundation's `docs/identity.md` has run.
- Consume `desktop-foundation` only through its immutable git tag. Product-neutral behavior belongs upstream; keep this crate a thin adapter.
- Keep the binary privilege-free: `bun run menubar:build` is the explicit build step, and `bun run menubar` launches the prebuilt executable in the foreground. No notarization is required.
- Do not put credentials, email, session data, arbitrary query strings, or secret environment values in menu labels, tooltips, logs, or argv. Explicit human browser actions may pass only the fixed public Accounts `product=aicharts&source=desktop` routing parameters through the shared foundation HTTPS helper; never derive them from agent output or environment values.
- `target/` and `menubar/gen/` are ignored. Keep `Cargo.lock` committed for the binary workspace.
