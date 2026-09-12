# Contributing

Thanks for helping improve AI Charts.

## Development

Install Bun 1.3.14 and Node.js 24, then run:

```sh
bun install --frozen-lockfile
bun run dev
```

Keep changes focused and include deterministic tests for behavior. Property tests are preferred for parsers, ordering, scale laws, layout geometry, and round trips.

Before opening a pull request, run:

```sh
bun run check
```

The complete gate requires the Rust toolchain and components pinned in `rust-toolchain.toml`, plus a C compiler for bundled SQLite. With rustup installed, `rustup show active-toolchain` installs the pinned toolchain on first use. The usage crates are local-only; tests must use synthetic fixtures and must never read a contributor's sessions, state or credentials. Never reset a real usage ledger to make a test pass.

The complete gate also runs `bun run usage:worker:check`: generated Cloudflare runtime types, separate strict TypeScript checking, and synthetic tests in local `workerd`. Node.js 24 and loopback access are required. No Cloudflare login or remote resources are needed. The runner excludes provider credentials and refuses `.env*` or `.dev.vars*` files in `services/usage-worker/`. Worker tests use `*.worker.ts` and their own runner; ordinary `bun test .` continues to own the existing tests. See [Usage Worker boundaries](docs/usage-worker.md) before changing pairing or staging.

`bun run release:archive:check`, `bun run release:manifest:check` and `bun run release:build:check` check the memory-only release formats with Node.js 24 and synthetic fixtures. All three are included in the complete gate and do not extract files, execute payloads, or publish a release. Keep their `.check.mjs` corpora under the explicit Node runner. See [Release archive bytes](docs/usage-release-archives.md), [Release manifest matching](docs/usage-release-manifest.md) and [BUILD matching](docs/usage-release-build.md) for inventory, size, ownership, and trust constraints.

## Data changes

Do not hand-edit `data/coding-agents.json`. Run `bun run data:refresh`, inspect the diff, and include only a snapshot change supported by the guarded refresh script. Do not weaken retention or coverage checks merely to accept an unexpected upstream shape.

Do not hand-edit `lib/chart-colors.generated.ts`. Regenerate it with `bun run colors:generate`.

## Product boundaries

- Keep the production route independent of live upstream availability.
- Treat file, network, URL, and query-string input as untrusted.
- Preserve keyboard, pointer, touch, and focus behavior together.
- Do not add user accounts, a product database, or identifying analytics without a separately reviewed design.
- Never commit credentials or real PostHog private keys.
