---
title: Repository seams
type: concept
tags:
  - architecture
  - dependencies
  - repositories
repository_scopes:
  - AGENTS.md
  - package.json
---

# Repository seams

AI Charts owns the checked benchmark snapshot, chart mathematics, interactive comparison compositions, evidence pages, and public search surface. Those product-specific datasets and chart compositions stay here even when stable visual primitives are shared.

The app currently declares no Hraness package dependency. If it adopts a shared design kit or `@hraness/ui`, pin an immutable release and use it only for stable, portable primitives and tokens. Keep chart geometry, evidence presentation, page composition, and the local visual contract product-owned.

Do not connect development through sibling paths, Git submodules, or coordinated `main` workflows. Extract a shared package only after two concrete consumers need the same stable, product-neutral interface. Freeze data and UI contracts before parallel lanes and give generated snapshots, manifests, and other convergence files one owner.

## Related

The normative rules remain in the root `AGENTS.md`. [[documentation-ownership|Documentation ownership]] explains how those rules relate to executable contracts and this pull-based context.

