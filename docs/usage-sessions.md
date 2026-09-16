# Session usage and time

The local session view at `/usage/sessions` groups numeric observations by
provider session and, when the source establishes it, conversation. It shows
observed token totals, output, cache usage, reasoning coverage, model mix and
time breakdowns. Reports remain in browser memory. The page does not upload a
report, store it in an account, or include its values in analytics.

## Export a historical session

Build the CLI as described in [local usage](usage-local.md). Use an existing
private occurrence key and explicit regular files:

```sh
umask 077
./target/debug/aicharts sessions \
  --occurrence-key-file /absolute/private/aicharts.key \
  --codex /absolute/path/to/session.jsonl \
  --claude /absolute/path/to/another-session.jsonl \
  --devin /absolute/path/to/atif-session.json \
  --json > /absolute/private/sessions.json
```

Open the resulting report using **Open session report**. Repeat source flags
for additional files. This command does not discover provider directories,
read credentials, enroll a device, or change the existing AICU v1 ledger and
upload format. Keyed session and occurrence IDs let supported copies be
deduplicated without revealing native identifiers. Keep the key stable.

Historical token accounting follows the existing collector: cumulative Codex
snapshots are not separate token purchases, and Claude cache reads are not
subtracted from its already uncached input field. Devin ATIF sources are
complete documents rather than lines: only `agent` steps contribute, and
`final_metrics` disagreement surfaces `devin_totals_mismatch`. Reasoning is a
subset of output and is never added twice. Missing reasoning detail remains
unknown.

An actual response model may populate a reviewed display allowlist. Custom or
unsupported model labels become unknown. Codex's requested turn model does
not prove its actual response model. When the native history contains an
allowlisted session model, the report records it as `Request tag`; if the
setting is absent or changes ambiguously, model attribution remains unknown.
Devin steps carry an effective response-model tag in `extra.generation_model`;
the report records an allowlisted value as `Response` attribution and discards
any other label. The response usage record in the reviewed
[Codex protocol](https://github.com/openai/codex/blob/4d205c7a4dc36b719679a0356a45b23133732265/codex-rs/protocol/src/protocol.rs)
does not contain an effective model identifier.

Instrumented request telemetry can also supply a model tag. The report marks
its `modelBasis` as `request`, and the viewer labels it **Request tag** instead
of claiming an effective response model. Response and request attribution
remain separate in model totals. A missing model always has `unknown` basis.

## Time states

| Name | Evidence required |
| --- | --- |
| Inference | An observed model stream lifecycle, covering response or reasoning delivery. |
| Reply wait | An explicit request for human input and its matching human response. |
| Approval wait | An explicit human permission request and its matching decision. |
| Tool wait | Actual tool execution start and completion, excluding overlapping human waits. |
| Unknown | Unobserved gaps, unsupported evidence, or conflicting human wait states. |

Model-request time is reported separately. It can include prefill, network
delay, retries, provider queues, buffering and pauses. Neither request duration
nor a turn's total duration establishes streaming time. Tool output streaming
is not model inference. Automatic approval review is not human approval wait.

An ordinary response wait between turns can be measured only while the source
continues to observe the session and can match the next human input. Closing
the observer, losing events, or reaching the end of a file never creates an
unbounded wait extending to the present. The report always carries a finite
selected window. Historical imports do not establish continuous observation
and therefore contain no phase spans.

These are application observations, not GPU utilization or a claim that a
provider is computing during every millisecond of a stream. A collector must
document its stream boundaries; arbitrary silence thresholds and token-count
estimates cannot produce `stream_lifecycle` evidence.

## Concurrent work

The time breakdown partitions a session's selected window. Inference takes
precedence over concurrent waits because inference is active. Human waits take
precedence over a tool whose overall lifetime includes the dialog. Conflicting
reply and approval waits become unknown. Model requests do not fill gaps.

Two measures answer different questions:

- **Session inference share:** sum of measured inference milliseconds divided
  by the sum of selected session-window milliseconds. Longer sessions carry
  proportionally more weight.
- **Net inference share:** elapsed milliseconds with at least one session
  inferring, divided by the union of selected session windows. Overlapping
  sessions never count the same elapsed millisecond twice.

For example, two ten-minute sessions that each infer for six minutes have a
60% session inference share. If their inference covers the full ten-minute
elapsed window, net inference share is 100%. Observed mean and peak inference
concurrency show how much of that work overlaps.

Unknown time stays in the denominator. An exact utilization share is absent
when unknown time could change it; the viewer shows a measured lower bound
when there is positive inference evidence, or **Unknown** when there is none.
For net share, a fully observed inference interval remains busy even if
another concurrent session is unobserved. Source coverage remains partial;
these numbers are neither a bill nor a productivity score.

## Report boundary

`session-observations-v1` is a separate local report, not a new AICU frame.
The browser accepts only its fixed schema: opaque 128-bit identifiers,
reviewed model labels, provider enums, safe integer counters, bounded epoch
times and evidence-tagged spans. It rejects extra fields, conflicting record
identities, impossible counters, malformed spans and historical phase claims.
Limits are 8 MiB, 2,000 sessions, 50,000 usage/span records and a maximum
366-day window per session. These are parser bounds, not coverage guarantees.

The **Explore an example** control loads explicitly labeled synthetic data.
**Follow a report**, in browsers supporting the file-access picker, rereads
the selected file every three seconds. It needs a collector that updates that
report. Other browsers can open fresh snapshots. A failed refresh retains the
last valid reading with an error; it does not silently accept a partial write.

## Source capabilities and remaining work

[Codex app-server](https://learn.chatgpt.com/docs/app-server) exposes turn,
item, reasoning/message delta, token-usage and approval events to connected
clients. A separately started app-server is not an observer for an existing
desktop app-server. Connecting a source adapter must preserve that ownership
boundary and strip content before retaining measurement records.

[Codex OpenTelemetry](https://learn.chatgpt.com/docs/config-file/config-advanced)
includes request/tool events and aggregate timing metrics. SSE event-processing
duration is not the elapsed duration of a model stream. Some raw telemetry can
contain tool-result snippets, so it must never be persisted wholesale.

[Claude Code monitoring](https://code.claude.com/docs/en/monitoring-usage)
documents optional enhanced traces for requests, blocked-on-user spans and
actual tool execution. Their exact source version and attributes determine
which states can be measured. An LLM request span is still not proof of
streaming, and subagent spans must retain their own execution identity to
avoid double-counting a parent's tool lifetime as child inference.

Account synchronization of session reports, attribution of historical Codex
tokens to effective models, and automatic observation of existing desktop
sessions require further source integration. They are not enabled by this
report format or the local viewer. The separate
[activation runbook](usage-activation.md) tracks live sign-in, native upload,
private query and recovery qualification.

## Run the local Claude telemetry monitor

Claude Code can export OTLP/HTTP JSON traces when `CLAUDE_CODE_ENABLE_TELEMETRY=1`
and its exporter endpoint is configured by the operator. Start the local monitor
with an owner-only 32-byte key and report path:

```sh
bun scripts/usage-session-monitor.ts \
  --key-file ~/.config/aicharts/session-monitor.key \
  --output ~/.local/state/aicharts/session-report.json
```

The monitor accepts only loopback `POST /v1/traces` JSON requests. It persists
HMAC identifiers and bounded numeric usage; prompt and tool content never enters
the report. It recognizes `claude_code.llm_request` as a request window and
records its documented token/model fields, but request duration is not inference
or proof of streaming. Token observations require all four documented counters;
missing cache counters are not assumed to be zero. `claude_code.tool.execution`
is tool wait except for `AskUserQuestion`, whose human boundary is not established;
`claude_code.tool.blocked_on_user` is approval wait only for documented
`user_*` decisions with its parent `claude_code.tool` present in the same packet.
The current Claude trace schema has no separate proof of assistant reply wait or
token streaming, so those periods remain unclassified.

Create the report's parent directory with owner-only permissions before starting
the monitor. It retains a single-writer lock, resumes only a valid private report,
and replaces that report atomically. Use the same private key when resuming.
An uncertain write stops further batches until the operator reconciles it.
The monitor neither changes Claude settings nor bypasses a managed telemetry
destination. Set the documented trace exporter to `otlp`, protocol to
`http/json`, and trace endpoint to `http://127.0.0.1:12701/v1/traces` only in an
operator-controlled session. Keep all content logging gates off.

Child tool spans require their parent tool in the same export batch; unmatched
children are omitted. Request spans retain their own agent identity and can
arrive before their parent interaction finishes. The live and historical
adapters use separate ID domains: they are alternative views of overlapping
usage, not reports to concatenate for a combined token total.
