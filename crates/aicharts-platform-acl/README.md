# Descriptor ACL inspection

`require_no_acl(BorrowedFd)` checks an already-open macOS object for extended
access-control entries. It accepts an absent or empty ACL and rejects every
entry, including deny-only and inheritance-only entries. Other Unix targets
return `Unsupported`. Errors contain only fixed codes.

`require_deny_only_acl(BorrowedFd)` is a separate traversal-ancestor predicate.
It accepts absent or empty ACLs, or at most 128 entries all tagged DENY. Any
ALLOW entry is rejected regardless of its principal, permissions or inheritance
flags; unknown tags and incomplete inspection fail closed. It does not replace
`require_no_acl` for private directories, files or newly created children.

The Rust interface borrows its descriptor. A small C shim uses the macOS SDK's
native types, validates the security properties returned alongside descriptor
metadata, and frees its copied ACL. It does not reopen a pathname, move the
descriptor's offset, resolve principals, change permissions, or retain or close
the descriptor. Rust unsafe code is restricted to its macOS FFI module.

## Caller requirements

Check the pinned private directory before creating children. Check each newly
created child descriptor before writing a payload or creating descendants.
Private `0600` and `0700` modes do not suppress inherited macOS ACL entries.
[Apple documents ACL inheritance and its relationship to BSD permissions](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/FileSystemDetails/FileSystemDetails.html).

This check alone does not establish private storage. The caller must separately
validate ownership, mode, object type, hard links, no-follow opens, supported
filesystem semantics, and publication stability. Mounts that ignore ownership
must not be trusted. A descriptor check prevents substitution through a later
pathname lookup; it cannot stop the owner or root from changing an object's
permissions afterward. The crate does not activate a storage adapter or access
credential stores.

## Native boundary

The C result is `0` when the selected predicate passes, `1` for a forbidden entry,
`2` for an unavailable inspection, and `3` for an unsupported operation. Rust
rejects unknown results. The strict predicate's original no-entry behavior is
unchanged; the ancestor predicate additionally checks each native entry tag.

The shim requires present owner, group, and mode properties that match the
native `stat` output before accepting an absent ACL. This catches an allocation
failure path in [Apple's descriptor-stat implementation](https://github.com/apple-oss-distributions/Libc/blob/main/sys/statx_np.c)
that can return success without populating a fresh security object.
[Security-property handling](https://github.com/apple-oss-distributions/Libc/blob/main/gen/filesec.c)
and [ACL iteration](https://github.com/apple-oss-distributions/Libc/blob/main/posix1e/acl_entry.c)
remain native; no private ACL structure is reproduced or decoded in Rust.

## Tests

The synthetic native tests compile the same C function against fixed fault
implementations. They cover allocation, property presence and mismatch,
iteration conventions, pointer ownership, error classification, and cleanup.
Separate disposable-file tests cover absent, empty, allow, deny, inherited, and
inheritance-only ACLs, descriptor lifetime, and rename/path replacement.

The test archive is linked only by Rust `cfg(test)` references. Normal builds
link no fault-injection or ACL-writing fixture symbols. These tests establish
bounded behavior; they are not formal verification or proof against a hostile
process running as the same user.

On a managed development Mac, run the focused commands through the host
scheduler's `mac-native` lane:

```sh
cargo test --locked -p aicharts-platform-acl
cargo clippy --locked -p aicharts-platform-acl --all-targets -- -D warnings
```
