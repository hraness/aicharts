# AI Charts credential custody

This library supplies immutable, typed secret records, a noninteractive macOS
Keychain adapter, and a dormant reference-manifest state machine. It is not
connected to the CLI, enrollment, uploads, or a daemon. Ordinary tests use
in-memory fakes and do not access a user's keychain.

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

These tests model candidate writes, synchronization, publication, reply loss,
restart, and concurrent changes through private in-memory ports. They do not
prove filesystem atomicity, permissions, crash durability, or operating-system
locking. A production adapter remains blocked on reviewed descriptor-bound ACL
checks, owner/mode/link validation, nofollow path handling, stable lock custody,
atomic publication, and native synchronization qualification. The path-only
[exacl interface](https://docs.rs/exacl/latest/exacl/fn.getfacl.html) does not supply
that descriptor-bound contract. No unsafe shim or new filesystem dependency is
included here.

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

These tests do not qualify a live keychain, a signed application, a LaunchAgent,
an executable upgrade, or a full credential recovery flow. A later separately
admitted disposable-keychain test must prove native create/readback, consent and
locked behavior without modifying the user's normal keychain. Signed CLI and
LaunchAgent artifact qualification must precede claims of unattended support.
