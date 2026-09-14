# Contents

- `menubar/` – the `aicharts-menubar` Rust binary: a Tauri status item that renders the repository `outputs/` directory newest-first with image thumbnails.

# Guidelines

- The menu-bar companion is a disposable client. It reads `outputs/` in this checkout, renders filename stems as menu items, and opens or reveals files. It holds no product authority.
- Consume `desktop-foundation` only through its immutable git tag. Product-neutral behavior belongs upstream; keep this crate a thin adapter.
- Keep the binary unbundled and privilege-free: `bun run menubar` builds with Cargo and spawns the executable directly. No `.app` packaging, signing, or notarization is required.
- Do not put credentials, query strings, or secret environment values in menu labels, tooltips, logs, or argv.
- `target/` and `menubar/gen/` are ignored. Keep `Cargo.lock` committed for the binary workspace.
