# Exact Git source reads

`scripts/release/git-source.mjs` reads the complete regular-file inventory of an explicitly selected local Git commit and tree for [release assembly](usage-release-assembly.md). It verifies raw Git object hashes and reconciles the full tree graph before returning bytes. This establishes internal consistency with the supplied object identities, not authenticated repository origin, approved release provenance or executable correspondence.

The release boundary also contains `scripts/release/hydrate-source.mjs`. It copies a checked source inventory into a new child of an already-owned mode-0700 scratch parent for a later Linux build. Hydration owns all source bytes before filesystem effects, creates only absent paths, refuses symlinks and collisions, rechecks complete membership and metadata, and returns only a frozen numeric inventory. It has no overwrite, cleanup, compiler, network, environment, provenance or publication interface. Run `bun run release:source:hydrate:check`; focused evidence is a local Node filesystem qualification, not Linux executable or notice qualification.

## API and result

```js
readGitSource({ repositoryDirectory, commit, expectedTree })
```

The input has exactly these three own data fields. `repositoryDirectory` is an absolute path to a trusted normal checkout; `commit` and `expectedTree` are independently selected nonzero 40-character lowercase SHA-1 object IDs. The module accepts no command, Git executable, environment, network or clock override through its public API.

Success is `{ok:true,value:{source,sourceFiles}}`. `source` contains the checked commit, tree and UTC committer time. `sourceFiles` contains every regular file, sorted by ASCII path, as `{path,mode,bytes}`. Metadata is frozen; each mutable byte buffer owns exact-sized, unpooled backing independent of sibling files. Preserve that byte custody or rehash after modification before assembly or publication.

The caller can pass `source` and `sourceFiles` to `assembleLinuxRelease` alongside independently established version, build/run facts, executable and complete notices. No binary, compiler fact or license qualification is derived by this reader. Assembly still applies its mandatory inventory and exact padded archive limits.

Failures return only a fixed code: `invalid_input`, `unsupported_repository`, `repository_changed`, `missing_object`, `invalid_object`, `invalid_source`, `limit_exceeded`, `git_failed` or `deadline_exceeded`. No partial inventory, path, commit message, identity or child-process stderr is returned on failure.

## Supported repository boundary

The reader targets POSIX hosts with trusted `/usr/bin/git` and supports an existing normal SHA-1 checkout. Both the selected checkout directory and its real `.git` directory must be owned by the current user. It checks original path components and selected metadata without accepting symlinks. Linked worktrees, `.git` indirection files, bare repositories, alternates, grafts, worktree configuration, partial/promisor stores and unsupported configuration are refused. It does not repair, clone or adopt a repository.

Local configuration is parsed before the first Git process. Only the fixed ordinary repository fields, optional exact `origin` URL for `hraness/aicharts`, standard fetch mapping, `main` tracking fields and disabled automatic-maintenance settings are admitted. Includes, custom hooks, arbitrary remotes and other configuration are refused. A matching configured remote is not origin authentication.

A shallow normal checkout is supported when the selected commit and every reachable tree/blob object are present locally. Parent history is not needed for this source inventory. A missing selected object fails closed without fetching. This does not waive a separate repository gate that requires complete Git history.

The selected commit need not equal HEAD. Dirty working files or index state do not change the result because source contents come only from the requested raw objects. Filters, working-tree conversions and replacement refs are not used. This reader does not validate or clean the developer's working tree.

## Object and process checks

The reader makes at most six bounded synchronous calls to trusted `/usr/bin/git`, using generated object-ID input and fixed `cat-file`/`ls-tree` arguments. It supplies a small fixed environment, disables system/global configuration, hooks, replacement objects, lazy fetch, optional locks and automatic maintenance, and permits no Git network protocol. It runs no shell, checkout, source executable or package script.

Each raw commit, tree and blob is hashed with its Git type/length header and matched against the requested object ID. The commit must identify exactly the expected tree and one valid committer timestamp. Every raw tree entry must agree with the recursive listing, including parent directories, mode and object identity; omissions and extras are refused. Duplicate blob contents may serve multiple paths, but each path counts toward the source byte budget.

Only regular modes 0644 and 0755 are returned. Symlinks, submodules, devices, empty trees, duplicate paths, case-fold collisions and file/parent conflicts are refused. Paths use the release format's restricted ASCII component alphabet, with at most 256 characters per full path and 255 per component. Absolute or traversing source paths, reserved device names and components ending in a period are unsupported.

Before return, the reader rechecks its observed directory and Git metadata, including configuration and pack inventory. A detected replacement or metadata change invalidates the entire result. These checks do not isolate a hostile same-user process or root, attest historical rollback, or authenticate a claimed source commit.

| Resource | Bound |
| --- | --- |
| Regular files / entries including root and directories | 2,048 / 8,192 |
| Aggregate per-path source bytes | 64 MiB |
| Commit / commit headers | 1 MiB / 64 KiB |
| Individual tree / aggregate unique trees | 1 MiB / 4 MiB |
| Recursive listing | 3 MiB |
| Local configuration | 64 KiB and 256 lines |
| Pack-directory entries | 1,024 |
| Git processes | At most six; 15 seconds each, capped by remaining time |
| Total elapsed budget | 50 seconds, checked throughout the operation |

Git output sizes are planned and capped before contents are requested. The elapsed budget does not preempt synchronous filesystem work or guarantee a peak-memory ceiling. The archive's headers, directories and padding consume additional space, so a source inventory within the raw-byte cap may still exceed assembly's expanded archive cap.

## Validation and release limits

Run `bun run release:source:check` with Node.js 24 and trusted `/usr/bin/git`; it is included in the complete repository gate. The corpus creates disposable synthetic normal repositories and exercises real raw-object reads, shallow stores, absent objects, ignored HEAD/index/working-tree differences, unsupported configuration, malformed protocols, complete graph membership, metadata changes, deadlines and the join into the real assembler. It never executes a packaged payload or publishes an asset.

Authenticated GitHub acquisition, selected-source approval, Linux ELF/runtime and notice qualification, signing/attestation, immutable publication and safe installation remain separate requirements. Neither this reader nor assembly enables authentication, collection, native credential custody, enrollment, uploads or updates.
