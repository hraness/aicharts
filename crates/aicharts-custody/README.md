# AI Charts credential custody

This library supplies immutable, typed secret records, a noninteractive macOS
Keychain adapter, and a dormant reference-manifest state machine. It is not
connected to the CLI, enrollment, uploads, or a daemon. Ordinary tests use
in-memory fakes and owned disposable filesystem fixtures, never a user's keychain.

## Boundary

`Vault::new()` checks that the compiled platform has a backend. It makes no OS call
and proves neither keychain availability nor access permission. Explicit
`insert_immutable` and `read_exact` calls access the User-domain keychain. Other
platforms return `custody_unsupported_platform`; there is no file, environment,
mock, or alternate-platform fallback in the public API.

The private record format permits three purposes:

| Purpose | Fixed identity and secret material | Encoded bytes |
| --- | --- | ---: |
| Checkpoint | Installation/item references and original local key | 104 |
| Pairing | References, intent ID, original distinct polling/upload secrets | 168 |
| Namespace | References, account ID, recovery generation, namespace version 1, account occurrence key | 160 |

References and bindings are checked, nonsecret types. Their constructors and the
private decoder establish syntax only. They do not authenticate a server, prove an
enrollment receipt, grant permission to use a namespace, or establish credential
liveness. Device binding, enrollment receipts, live reference persistence, legacy
key import, ledger promotion, and transport are outside this slice.

Secret types have no `Debug`, `Display`, `Clone`, `Copy`, or serialization
implementation. Typed `with_*` methods make byte access explicit. Callers still
must not copy, log, serialize, export, or pass secrets through argv/environment.
The product does not expose its private binary codec as a wire protocol.

## Immutable operations and uncertain results

Insertion first reads the exact item. An identical existing record returns
`AlreadyPresent`; conflicting or malformed bytes fail without a write. A missing
item permits one create-only insertion of the caller-supplied record. A duplicate
race is read back once. Both successful outcomes require an exact full-record
readback. No setter, update, deletion, random generation, or automatic retry is
present.

Immutability describes this library's operations, not an OS write-once guarantee.
`read_exact` validates identity and syntax; it cannot recognize an externally
replaced valid secret without a separately retained commitment. Future callers
must also verify the existing ledger key fingerprint and server commitments.

Any nonduplicate error after insertion dispatch returns
`custody_outcome_unknown`. A failed postwrite readback does too. A malformed or
conflicting readback returns its fixed refusal and leaves the existing item
untouched. An inaccessible initial read never becomes permission to insert.

Retain the exact record identity and original secret material across uncertainty.
Reconcile that same identity explicitly. A missing lookup does not authorize
reminting a key or pairing proof. A fresh exact insertion after a confirmed missing
read remains a caller decision with the original record, not a library retry.

This is not a crash-safe enrollment workflow yet. Before any future integration,
the caller must durably record nonsecret operation intent before keychain writes,
verify readback before publishing references, and preserve the original pairing
proof before any remote effect. A missing reference or key must close that workflow.
The ledger remains sole owner of frozen upload batches, sequence allocation, and
terminal acknowledgment; custody must not duplicate that authority.

## Dormant reference manifest

`references::ReferenceStore` is deliberately closed. On macOS, every constructor
and operation returns `references_backend_unqualified` before filesystem or vault
access. Other platforms return `references_unsupported_platform`. There is no
public fake backend, raw-byte import, verification setter, or permission-bit-only
fallback. The internal state machine has deterministic tests; it does not yet
provide a usable filesystem store.

The manifest binds one nonzero installation to at most 256 retained references.
Each entry contains the exact `RecordIdentity`, a commitment to the complete
canonical secret record, and either `Prepared` or `CustodyVerified`. Only one
entry may be `Prepared`. Append and that one-way transition are the only changes;
there is no replacement, removal, eviction, or automatic key generation. The
revision equals the entry count plus the verified-entry count.

`RecordIntent::from_record` hashes
`aicharts:custody-record:v1\0` followed by the existing private record encoding.
It retains no secret bytes. A resolved record must match both the retained
identity and this commitment, including after a prior successful resolution.
These high-entropy-secret commitments detect local replacement when the original
manifest is retained. They are not server provenance, credential liveness, or
protection against coordinated manifest/vault replacement or rollback. Existing
ledger fingerprints and server commitments still require independent checking.
Secrets must have independent random entropy; the type checks syntax, and these
commitments can expose guesses of weak caller-supplied values.

The private v1 format is a 64-byte header, 160 bytes per entry, and a 32-byte
checksum, capped at 41,056 bytes. Integers are little-endian. The header contains
`AICF`, version 1, installation ID, revision, count, and reserved zeros. Each entry
contains purpose, state, item ID, the purpose-specific intent or namespace
binding, and the record commitment. Unused slots are zero; item IDs are strictly
sorted and unique across purposes. Unknown versions, incorrect lengths,
noncanonical padding, invalid identities, or inconsistent revisions fail closed.
The checksum covers the header and entries under
`aicharts:credential-manifest:v1\0`; it detects corruption, not tampering by an
authorized writer. A `ManifestToken` binds the revision and the complete encoded
manifest under the separate `aicharts:credential-manifest-token:v1\0` domain.

The internal persistence contract stages an immutable candidate, synchronizes it,
checks the current token again, publishes once, synchronizes the directory, and
reads back the exact committed bytes. All failures after publication dispatch
return `references_outcome_unknown`. Earlier failures preserve committed state
and any candidate. A restart reads only committed state. A retained candidate
can be reused only by an explicit identical operation whose original expected
token still matches; a different candidate requires recovery. No candidate is
automatically adopted or discarded.

Preparation must complete its committed readback before installation can begin.
Before any vault operation, the state machine also synchronizes the current
committed file and directory, then checks the exact token again. This includes
restarts that observe a publication whose earlier synchronization failed.
Installation requires the original record and matching commitment, then uses
the create-only vault operation. Both installation and reconciliation require a
fresh exact vault readback before publishing `CustodyVerified`; they check the
manifest token again after vault work. A missing or inaccessible item preserves
the original prepared entry. Reconciliation never inserts. An explicit install
may reuse the original record while still prepared, but cannot recreate a missing
verified item. A verified marker alone never releases a secret.

Private in-memory tests model candidate writes, synchronization, publication,
reply loss, restart, and concurrent changes. A separate private macOS adapter
uses `rustix` descriptor operations and the narrow
[ACL inspection boundary](../aicharts-platform-acl/README.md). Its tests use only
disposable directories and synthetic records, with a fake vault. The public
`ReferenceStore` remains closed. The private explicit-path integration candidate
and its separately ignored Keychain qualification do not activate that facade.

The adapter accepts an already trusted, owned directory descriptor. It requires
current-user ownership, mode 0700, no ACL entries, and writable local APFS with
ownership enforcement. It creates or opens the fixed `references-v1` child and
checks that this name still resolves to its pinned descriptor before and after
operations. It never resolves user paths, follows symbolic links, repairs modes
or ACLs, or adopts a partially initialized directory.

The separate private path entry accepts an existing absolute anchor, capped at
1,023 bytes and 64 components of at most 255 bytes each. It rejects symbolic
links, empty components, `.` and `..`; it does not expand `HOME`, discover a
fallback, create ancestors or repair permissions. Descriptors from `/` through
the anchor remain pinned, and parent/name bindings are rechecked at storage
checkpoints. Ancestors must be root- or current-user-owned directories without
group/other write permission, on local APFS with ownership enforced. Only absent,
empty or deny-only ancestor ACLs pass. The final anchor retains the stricter
current-user, mode-0700, no-ACL, writable-filesystem rule. A read-only root volume
does not relax the actual write-anchor requirements.

The child contains only `references.lock`, `references.current`, and optionally
`references.pending`. Files must be regular, mode 0600, have one link, and have
no ACL entries. The permanent empty lock is never replaced. Each operation
acquires its own nonblocking exclusive descriptor lock and checks the lock's
name-to-inode binding; error and unwind paths release it. The current file may
legitimately change between operations. Within a durability barrier, its exact
inode and bytes stay pinned through directory synchronization and final readback.

Current and pending files share an `AICM` envelope: a 64-byte header, the existing
canonical `AICF` payload, and a 32-byte checksum, capped at 41,152 bytes. The header
retains the original expected token, its presence flag, payload length, version
1, and reserved zeros. Its checksum domain is
`aicharts:credential-reference-file:v1\0`. Initialization requires an absent
predecessor and an empty revision-zero payload; every later payload has exactly
the next revision. This retains the predecessor but does not independently prove
the replaced file's history. Neither format contains secret record bodies.

New pending files are checked while empty, written once, and read back exactly.
An existing complete pending file is reusable only for the identical original
candidate. A partial or different file is preserved and refused. A complete
initial pending file can resume the identical initialization; an empty directory
or missing lock cannot. Publication renames pending to current once, with
no-replace semantics for initial creation. File and directory `fsync` operations
are followed by `F_FULLFSYNC` on the same device, with no weaker fallback.
[Apple documents the full synchronization guarantee](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/man/man2/fcntl.2).

The private existing-only `reconcile_initialization` path requires the original
installation and either its exact initial pending envelope or an empty
revision-zero current manifest. It reestablishes durability for a committed
retry. A differing installation or advanced manifest is not an initialization
receipt; missing or partial state is preserved. The corresponding public method
remains behind the same closed facade.

Reads, writes, interrupt retries, and directory enumeration have fixed work
bounds. Native disk operations do not have a guaranteed wall-clock timeout.
The locks coordinate cooperating processes; descriptor and metadata checks
conservatively refuse observed replacement. They do not prevent arbitrary
same-user or root mutation, detect coordinated backup rollback, certify that a
folder is not synchronized externally, or prove physical power-loss behavior.
No daemon, credential-store, or public filesystem activation follows from these
private tests.

The manifest has no server receipt, device-active flag, approved account choice,
upload sequence, local measurement, source path, or free-form string. Enrollment
integration must use the existing Worker reservation and receipt authority and
an independently qualified transport. The local `CustodyVerified` state never
authorizes enrollment, upload, namespace promotion, or daemon activation.

## macOS mechanism and limits

The pinned `security-framework` adapter uses `ItemAddOptions::add` (SecItemAdd),
not an upsert. Every operation selects one User-domain file-based keychain and
pins it across lookup, insertion, and readback. Queries include generic-password
class, fixed AI Charts production service, opaque installation/item account,
case-sensitive matching, non-synchronized items, and a maximum of two results.
Anything other than one bounded data result fails closed. Queries never enumerate
the keychain or skip items that require authentication.

A crate-global mutex encloses the entire operation and UI-suppression lifetime.
The dependency's suppression guard unconditionally enables UI when dropped, so it
is used only when UI was originally allowed. A previously disabled policy stays
disabled. Contention returns `custody_busy`; a poisoned lock returns
`custody_unavailable`. No keychain unlock, password prompt, ACL expansion, or
settings change is requested. Locked or consent-required access pauses with a
fixed error. This coordination assumes no unrelated code changes process-wide
Keychain UI policy outside this crate.

The private reference integration uses a lazy vault session. Construction makes
no native call. Only after the manifest's filesystem durability barrier does its
first vault operation acquire the process mutex, suppress UI and select one
keychain. It retains that session through readback, preserving filesystem-to-vault
lock order. Failed selection is retained for the operation, never retried or
treated as a missing item.

This uses the file-based compatibility keychain. It does not claim Data Protection
Keychain accessibility classes, app-group entitlements, Secure Enclave protection,
or OS-enforced reader/uploader separation. The file-based keychain is not iCloud
synchronization, but this library does not prevent OS backup/migration or arbitrary
local restore. Apple's implementation and access-control distinctions are in
[TN3137](https://developer.apple.com/documentation/Technotes/tn3137-on-mac-keychains).

Owned secret buffers are wiped with `zeroize` on normal drop. The OS, Core
Foundation, Rust moves, and dependency search allocations may make other copies;
there is no all-memory wiping, swap, debugger, crash-dump, or compromised-process
guarantee. `SearchResult::Data` itself has a secret-bearing debug formatter, so the
adapter consumes it privately and never formats it. Native errors are reduced to
fixed variants without retaining their messages. See the
[SecItem builder](https://docs.rs/security-framework/3.7.0/security_framework/item/struct.ItemAddOptions.html)
and [zeroize limits](https://docs.rs/zeroize/1.9.0/zeroize/).

## Validation and qualification

Focused commands (use the installed host scheduler where required):

```sh
cargo test --locked -p aicharts-custody
cargo clippy --locked -p aicharts-custody --all-targets -- -D warnings
```

Tests exercise strict record bounds and offsets, purpose/binding confusion,
private projections, create-only races, failed writes/readbacks, and explicit
restart reconciliation against retained in-memory state. Compile-fail doctests
guard the absence of secret debug/clone traits. macOS-only pure tests check native
error classification, result projection, synthetic UI guard behavior, and mutex
refusal before any native call.

The separately ignored `disposable_keychain_reference_roundtrip` test is an
explicit native qualification candidate, not part of ordinary checks. Its parent
validates an explicitly supplied existing private parent before creating one
owned fixture. A bounded child creates a concrete private keychain with synthetic records and no
password in argv or environment; it never selects the default keychain or edits
search lists. It tests exact readback, conflicts, reopening, lost insertion replies,
and noninteractive refusal while that fixture is locked. Only the exact fixture
is unlocked with its synthetic in-memory password. Cleanup removes the parent's
owned directory after child exit and identity revalidation. Its exact child
process group is retained through timeout cleanup, including a fixture-lock
subprocess. An uncertain process-custody result preserves the fixture. It does
not call `delete-keychain`, whose implementation also saves keychain preferences.
Full fixture paths containing `/login.keychain` are refused before creation,
matching [Apple's private-keychain registration distinction](https://raw.githubusercontent.com/apple-oss-distributions/Security/main/OSX/libsecurity_keychain/lib/StorageManager.cpp).

This ignored test has not established signed-application, LaunchAgent, executable
upgrade, user-consent or full credential-recovery qualification. Its presence is
not a live-test receipt. Signed CLI and LaunchAgent artifact qualification must
precede claims of unattended support.
