# Contents

- `app/` – Next.js App Router chart, sourced benchmark notes, metadata, error states, and product stylesheet.
- `components/` – interactive scatter chart, update timeline, linked summaries, sharing, export, and UI primitives.
- `lib/` – strict data and update boundaries, chart math, layout, analytics, and property tests.
- `data/` – deterministic checked-in benchmark snapshot.
- `scripts/` – guarded snapshot refresh and generated color workflows.
- `styles/` – portable plain-site and publication styling for the benchmark notes.
- `.github/workflows/` – continuous integration and daily data refresh automation.
- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `NOTICE.md` – public project documentation.

# Guidelines

- Keep CodingChart a static-data Next.js product with a checked chart snapshot, sourced benchmark notes, and no runtime dependency on the upstream benchmark page.
- Treat network, file, URL, and query-string values as `unknown` until an owned schema or predicate narrows them.
- Prefer explicit `Result` values for recoverable domain failures and reserve throwing for invalid checked-in invariants.
- Update `data/coding-agents.json` only through `bun run data:refresh`; preserve duplicate, retention, stable-key, metric-coverage, material-change, and bounded-history guards.
- Regenerate `lib/chart-colors.generated.ts` through the checked iWantHue script. Do not hand-edit generated files.
- Keep pointer, keyboard, focus, and touch behavior equivalent. Preserve semantic landmarks, accessible names, visible focus, and responsive horizontal chart panning.
- Keep analytics cookieless and production-only. Add only allowlisted events with controlled properties; do not send URLs, query strings, free-form text, identities, or persistent identifiers.
- Never expose `POSTHOG_API_KEY`, commit credentials, or provider secrets in browser variables, source, logs, fixtures, or documentation.
- Run narrow tests while iterating and `bun run check` before handoff.
