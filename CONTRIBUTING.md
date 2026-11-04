# Contributing

> This project is retired. The contribution guide below is preserved for historical reference.

Thanks for helping improve aicharts.

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

CI runs the same commands split across parallel jobs and folds them into one `Required` check, which is the only merge gate. Open the pull request with auto-merge enabled (`gh pr merge --auto --squash <number>`); no human review is requested, and the change merges when `Required` passes.

The complete check validates the committed benchmark snapshots and portable agent skill, runs TypeScript, lint, and tests, builds the site, and checks it in a browser. Tests use synthetic fixtures and committed public data.

## Data changes

Do not hand-edit `data/coding-agents.json`. Run `bun run data:refresh`, inspect the diff, and include only a snapshot change supported by the guarded refresh script. Do not weaken retention or coverage checks merely to accept an unexpected upstream shape.

Do not hand-edit `lib/chart-colors.generated.ts`. Regenerate it with `bun run colors:generate`.

## Product boundaries

- Keep the production route independent of live upstream availability.
- Treat file, network, URL, and query-string input as untrusted.
- Preserve keyboard, pointer, touch, and focus behavior together.
- Do not add user accounts, a product database, or identifying analytics without a separately reviewed design.
- Never commit credentials or real PostHog private keys.
