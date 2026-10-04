//! `aicharts mcp`: read-only usage tools over Model Context Protocol stdio.
//!
//! An agent asks for token use by day, agent, provider and model. Answers
//! come from the local history record, or from a fresh read of local session
//! files when the record is empty or the caller asks for `fresh`. No tool
//! writes a file, starts collection, enrolls, publishes or contacts a network
//! service. Transport is newline-delimited JSON-RPC 2.0 on stdin and stdout.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufRead, Write};
use std::path::PathBuf;

use serde::de::{MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{json, Map, Value};

use crate::history;
use crate::stats::{self, Report, Row};

pub(crate) const PROTOCOL_VERSION: &str = "2025-06-18";
const SUPPORTED_VERSIONS: [&str; 3] = ["2024-11-05", "2025-03-26", PROTOCOL_VERSION];
const MAX_FRAME_BYTES: usize = 64 * 1024;
const MAX_RESULT_BYTES: usize = 1024 * 1024;
const MAX_SAFE: u128 = 9_007_199_254_740_991;

const INSTRUCTIONS: &str = "Token use by coding agents on this computer, from aicharts. Every tool is read-only: nothing is written, collected or uploaded. Answers come from the local usage history (aicharts history), or from the agents' session files when the history is empty or fresh is true. Token buckets (input, cacheRead, cacheWrite, output, reasoning) are disjoint and total is their sum. Costs are separate: reported by the tool or estimated from public prices, and null means unknown, not zero. An agent whose files could not be read completely, or that was not found, may have more usage than shown. Days without rows have no recorded usage. Use usage_daily for charts and usage_summary for totals.";

/// What the tools may read. Tests substitute a synthetic record and scan.
pub(crate) struct Context<'a> {
    pub(crate) dir: PathBuf,
    pub(crate) home: PathBuf,
    pub(crate) clock: &'a dyn Fn() -> Result<u64, &'static str>,
    pub(crate) scan: &'a dyn Fn(&stats::Options, u64) -> Result<Report, &'static str>,
}

/// Read at most one bounded newline-delimited request.
fn read_frame(input: &mut impl BufRead) -> std::io::Result<Option<Vec<u8>>> {
    let mut frame = Vec::new();
    loop {
        let chunk = input.fill_buf()?;
        if chunk.is_empty() {
            return if frame.is_empty() {
                Ok(None)
            } else {
                Err(std::io::ErrorKind::InvalidData.into())
            };
        }
        let count = chunk
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(chunk.len(), |index| index + 1);
        if count > MAX_FRAME_BYTES - frame.len() {
            return Err(std::io::ErrorKind::InvalidData.into());
        }
        frame.extend_from_slice(&chunk[..count]);
        input.consume(count);
        if frame.last() == Some(&b'\n') {
            return Ok(Some(frame));
        }
    }
}

/// JSON with duplicate object keys refused, so no argument is ambiguous.
struct Strict(Value);

impl<'de> Deserialize<'de> for Strict {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct StrictVisitor;
        impl<'de> Visitor<'de> for StrictVisitor {
            type Value = Strict;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("unambiguous JSON")
            }
            fn visit_bool<E: serde::de::Error>(self, value: bool) -> Result<Strict, E> {
                Ok(Strict(Value::Bool(value)))
            }
            fn visit_i64<E: serde::de::Error>(self, value: i64) -> Result<Strict, E> {
                Ok(Strict(value.into()))
            }
            fn visit_u64<E: serde::de::Error>(self, value: u64) -> Result<Strict, E> {
                Ok(Strict(value.into()))
            }
            fn visit_f64<E: serde::de::Error>(self, value: f64) -> Result<Strict, E> {
                serde_json::Number::from_f64(value)
                    .map(|number| Strict(Value::Number(number)))
                    .ok_or_else(|| E::custom("invalid number"))
            }
            fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Strict, E> {
                Ok(Strict(value.into()))
            }
            fn visit_string<E: serde::de::Error>(self, value: String) -> Result<Strict, E> {
                Ok(Strict(value.into()))
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Strict, E> {
                Ok(Strict(Value::Null))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Strict, A::Error> {
                let mut values = Vec::new();
                while let Some(Strict(value)) = seq.next_element()? {
                    values.push(value);
                }
                Ok(Strict(Value::Array(values)))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Strict, A::Error> {
                let mut values = Map::new();
                while let Some(key) = map.next_key::<String>()? {
                    if values.contains_key(&key) {
                        return Err(serde::de::Error::custom("duplicate JSON field"));
                    }
                    values.insert(key, map.next_value::<Strict>()?.0);
                }
                Ok(Strict(Value::Object(values)))
            }
        }
        deserializer.deserialize_any(StrictVisitor)
    }
}

pub(crate) fn serve(
    ctx: &Context,
    input: &mut impl BufRead,
    out: &mut impl Write,
) -> std::io::Result<()> {
    loop {
        let frame = match read_frame(input) {
            Ok(Some(frame)) => frame,
            Ok(None) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::InvalidData => {
                write_message(
                    out,
                    &error_response(Value::Null, -32600, "invalid or oversized request frame"),
                )?;
                // Never treat the tail of an oversized frame as a request.
                return Ok(());
            }
            Err(error) => return Err(error),
        };
        if frame.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        match serde_json::from_slice::<Strict>(&frame) {
            Ok(Strict(message)) => {
                if let Some(response) = handle(ctx, &message) {
                    write_message(out, &response)?;
                }
            }
            Err(_) => write_message(
                out,
                &error_response(Value::Null, -32700, "invalid JSON request"),
            )?,
        }
    }
}

fn write_message(out: &mut impl Write, message: &Value) -> std::io::Result<()> {
    serde_json::to_writer(&mut *out, message)?;
    out.write_all(b"\n")?;
    out.flush()
}

fn result(id: &Value, result: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "result": result})
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
}

fn valid_id(id: &Value) -> bool {
    id.as_i64().is_some()
        || id.as_u64().is_some()
        || id.as_str().is_some_and(|text| {
            !text.is_empty() && text.len() <= 128 && !text.chars().any(char::is_control)
        })
}

fn only_meta(params: Option<&Value>) -> bool {
    params.is_none_or(|params| {
        params
            .as_object()
            .is_some_and(|object| object.keys().all(|key| key == "_meta"))
            && params.get("_meta").is_none_or(Value::is_object)
    })
}

fn is_dated_version(version: &str) -> bool {
    let bytes = version.as_bytes();
    bytes.len() == 10
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 => *byte == b'-',
            _ => byte.is_ascii_digit(),
        })
}

pub(crate) fn handle(ctx: &Context, message: &Value) -> Option<Value> {
    let valid = message.as_object().is_some_and(|object| {
        object
            .keys()
            .all(|key| matches!(key.as_str(), "jsonrpc" | "id" | "method" | "params"))
    }) && message.get("jsonrpc").and_then(Value::as_str) == Some("2.0")
        && message
            .get("method")
            .and_then(Value::as_str)
            .is_some_and(|method| {
                !method.is_empty() && method.len() <= 128 && !method.chars().any(char::is_control)
            })
        && message.get("id").is_none_or(valid_id)
        && message.get("params").is_none_or(Value::is_object);
    if !valid {
        return Some(error_response(
            Value::Null,
            -32600,
            "invalid request envelope",
        ));
    }
    let method = message["method"].as_str().unwrap_or_default();
    // Notifications never run a tool and never get an answer.
    let id = message.get("id")?.clone();
    let params = message.get("params");
    Some(match method {
        "initialize" => {
            let requested = params
                .and_then(|params| params.get("protocolVersion"))
                .and_then(Value::as_str);
            let version = match requested {
                Some(version) if SUPPORTED_VERSIONS.contains(&version) => Some(version),
                Some(version) if is_dated_version(version) => Some(PROTOCOL_VERSION),
                _ => None,
            };
            let malformed = params.is_none_or(|params| {
                params.as_object().is_none_or(|object| {
                    object.iter().any(|(key, value)| match key.as_str() {
                        "protocolVersion" => !value.is_string(),
                        "capabilities" | "clientInfo" | "_meta" => !value.is_object(),
                        _ => true,
                    })
                })
            });
            match version.filter(|_| !malformed) {
                None => error_response(
                    id,
                    -32602,
                    "unsupported protocol version or initialization parameters",
                ),
                Some(version) => result(
                    &id,
                    json!({
                        "protocolVersion": version,
                        "capabilities": {"tools": {"listChanged": false}},
                        "serverInfo": {"name": "aicharts", "version": env!("CARGO_PKG_VERSION")},
                        "instructions": INSTRUCTIONS,
                    }),
                ),
            }
        }
        "ping" | "tools/list" | "resources/list" | "prompts/list" => {
            if !only_meta(params) {
                error_response(id, -32602, "invalid method parameters")
            } else {
                match method {
                    "tools/list" => result(&id, json!({"tools": tools()})),
                    "resources/list" => result(&id, json!({"resources": []})),
                    "prompts/list" => result(&id, json!({"prompts": []})),
                    _ => result(&id, json!({})),
                }
            }
        }
        "tools/call" => call_tool(ctx, &id, params),
        _ => error_response(id, -32601, "unknown method"),
    })
}

fn period_properties() -> Value {
    json!({
        "days": {"type": "integer", "minimum": 1, "maximum": 366, "description": "The last N UTC days including today (default 30). Do not combine with since or until."},
        "since": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$", "description": "First UTC day, YYYY-MM-DD (with until; at most 366 days)."},
        "until": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$", "description": "Last UTC day, YYYY-MM-DD; no later than today."},
        "clients": {"type": "array", "items": {"type": "string"}, "maxItems": 64, "uniqueItems": true, "description": "Agent IDs such as claude, codex, cursor or devin-cli (see usage_clients). Default: every agent in the record."},
        "fresh": {"type": "boolean", "description": "Also read the agents' session files now (slower). Default false: answer from the history record, or from the files when the record is empty."}
    })
}

fn tool(name: &str, description: &str, extra: Value) -> Value {
    let mut properties = period_properties();
    if let (Some(properties), Some(extra)) = (properties.as_object_mut(), extra.as_object()) {
        for (key, value) in extra {
            properties.insert(key.clone(), value.clone());
        }
    }
    json!({
        "name": name,
        "description": description,
        "inputSchema": {"type": "object", "properties": properties, "additionalProperties": false},
        "annotations": {"readOnlyHint": true, "idempotentHint": true, "openWorldHint": false},
    })
}

fn tools() -> Value {
    json!([
        tool(
            "usage_summary",
            "Total token use for a period, grouped by agent (client), model, provider, or agent and model, with known costs and which agents were read. Read-only.",
            json!({"group_by": {"type": "string", "enum": ["client", "model", "provider", "client_model", "total"], "description": "Default client."}}),
        ),
        tool(
            "usage_daily",
            "Token use per UTC day for charts, optionally split by agent, model or provider. Read-only.",
            json!({"group_by": {"type": "string", "enum": ["total", "client", "model", "provider"], "description": "Default total: one row per day."}}),
        ),
        tool(
            "usage_report",
            "The full report rows (day, agent, provider, model, token buckets, records, costs) as JSON in the client-stats-v2 format aicharts.io/usage/details opens, or as CSV. Read-only.",
            json!({"format": {"type": "string", "enum": ["json", "csv"], "description": "Default json."}}),
        ),
        {
            "name": "usage_clients",
            "description": "The agent IDs aicharts can read and the ones the local history has recorded. Read-only.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
            "annotations": {"readOnlyHint": true, "idempotentHint": true, "openWorldHint": false},
        },
        {
            "name": "usage_history_status",
            "description": "Whether scheduled local history collection is on, what the record holds and when it last collected. Read-only.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
            "annotations": {"readOnlyHint": true, "idempotentHint": true, "openWorldHint": false},
        },
    ])
}

fn call_tool(ctx: &Context, id: &Value, params: Option<&Value>) -> Value {
    let Some(params) = params.and_then(Value::as_object) else {
        return error_response(id.clone(), -32602, "invalid tool parameters");
    };
    if params
        .keys()
        .any(|key| !matches!(key.as_str(), "name" | "arguments" | "_meta"))
        || params.get("_meta").is_some_and(|meta| !meta.is_object())
    {
        return error_response(id.clone(), -32602, "invalid tool parameters");
    }
    let Some(name) = params.get("name").and_then(Value::as_str) else {
        return error_response(id.clone(), -32602, "invalid tool name");
    };
    let empty = Map::new();
    let arguments = match params.get("arguments") {
        None => &empty,
        Some(Value::Object(arguments)) => arguments,
        Some(_) => return error_response(id.clone(), -32602, "invalid tool arguments"),
    };
    let outcome = match name {
        "usage_summary" => summary(ctx, arguments),
        "usage_daily" => daily(ctx, arguments),
        "usage_report" => full_report(ctx, arguments),
        "usage_clients" => clients(ctx, arguments),
        "usage_history_status" => history_status(ctx, arguments),
        _ => return error_response(id.clone(), -32602, "unknown tool"),
    };
    match outcome {
        Ok(Content::Json(value)) => {
            text(id, serde_json::to_string(&value).unwrap_or_default(), false)
        }
        Ok(Content::Text(body)) => text(id, body, false),
        // Fixed codes only: no paths, file names or source text.
        Err(code) => text(id, format!("{code}: {}", explain(code)), true),
    }
}

fn text(id: &Value, body: String, is_error: bool) -> Value {
    if body.len() > MAX_RESULT_BYTES {
        return text(
            id,
            format!("mcp_result_too_large: {}", explain("mcp_result_too_large")),
            true,
        );
    }
    let mut value = json!({"content": [{"type": "text", "text": body}]});
    if is_error {
        value["isError"] = Value::Bool(true);
    }
    result(id, value)
}

fn explain(code: &str) -> &'static str {
    match code {
        "invalid_option" => "an argument is unknown, repeated or out of range",
        "stats_range_invalid" | "stats_date_invalid" => {
            "choose dates as YYYY-MM-DD, at most 366 days, ending no later than today"
        }
        "history_store_invalid" => {
            "the local history record is damaged; run aicharts history status"
        }
        "history_store_full" => "the local history record reached its size limit",
        "history_window_too_large" | "mcp_result_too_large" => {
            "the answer is too large; choose fewer days or agents"
        }
        "home_required" => "HOME is not an absolute folder",
        _ => "the usage read failed; run aicharts history status",
    }
}

enum Content {
    Json(Value),
    Text(String),
}

struct Query {
    first: u64,
    count: u64,
    clients: Option<BTreeSet<String>>,
    fresh: bool,
}

fn query(arguments: &Map<String, Value>, extra: &[&str], now: u64) -> Result<Query, &'static str> {
    let allowed = ["days", "since", "until", "clients", "fresh"];
    if arguments
        .keys()
        .any(|key| !allowed.contains(&key.as_str()) && !extra.contains(&key.as_str()))
    {
        return Err("invalid_option");
    }
    let days = arguments
        .get("days")
        .map(|value| value.as_u64().ok_or("invalid_option"))
        .transpose()?;
    let date = |name: &str| -> Result<Option<&str>, &'static str> {
        arguments
            .get(name)
            .map(|value| value.as_str().ok_or("invalid_option"))
            .transpose()
    };
    let (first, count) = history::window(days, date("since")?, date("until")?, now)?;
    let clients = match arguments.get("clients") {
        None => None,
        Some(Value::Array(values)) if values.len() <= history::MAX_HISTORY_CLIENTS => {
            let mut set = BTreeSet::new();
            for value in values {
                let client = value.as_str().ok_or("invalid_option")?;
                if !aicharts_import::clients().contains(&client) || !set.insert(client.to_owned()) {
                    return Err("invalid_option");
                }
            }
            (!set.is_empty()).then_some(set)
        }
        Some(_) => return Err("invalid_option"),
    };
    let fresh = match arguments.get("fresh") {
        None => false,
        Some(Value::Bool(fresh)) => *fresh,
        Some(_) => return Err("invalid_option"),
    };
    Ok(Query {
        first,
        count,
        clients,
        fresh,
    })
}

fn choice<'a>(
    arguments: &'a Map<String, Value>,
    name: &str,
    allowed: &[&'a str],
    default: &'a str,
) -> Result<&'a str, &'static str> {
    match arguments.get(name) {
        None => Ok(default),
        Some(Value::String(value)) => allowed
            .iter()
            .find(|candidate| **candidate == value.as_str())
            .copied()
            .ok_or("invalid_option"),
        Some(_) => Err("invalid_option"),
    }
}

/// The report for one query and where it came from: `history`, `files`
/// (no record yet) or `history+files` (the record plus a fresh read, merged
/// in memory and never written).
fn load(ctx: &Context, query: &Query) -> Result<(Report, &'static str), &'static str> {
    let now = (ctx.clock)()?;
    let store = history::read_store(&ctx.dir, now)?;
    let recorded = store
        .as_ref()
        .is_some_and(|store| !store.rows.is_empty() || !store.clients.is_empty());
    if !query.fresh && recorded {
        let store = store.as_ref().ok_or("history_store_invalid")?;
        return Ok((
            history::report(store, query.first, query.count, query.clients.as_ref(), now)?,
            "history",
        ));
    }
    let scanned = match &query.clients {
        Some(clients) => clients.iter().cloned().collect(),
        None => history::all_clients(),
    };
    let options = history::scan_options(&ctx.home, scanned, query.first, query.count);
    let fresh = (ctx.scan)(&options, now)?;
    stats::validate_report(&fresh)?;
    match store.filter(|_| recorded) {
        Some(store) => {
            let generated = (ctx.clock)()?.max(fresh.generated_at_ms);
            let (merged, _) = history::merge(&store, &fresh, generated)?;
            Ok((
                history::report(
                    &merged,
                    query.first,
                    query.count,
                    query.clients.as_ref(),
                    generated,
                )?,
                "history+files",
            ))
        }
        None => Ok((fresh, "files")),
    }
}

fn number(value: u128) -> Value {
    if value <= MAX_SAFE {
        json!(value as u64)
    } else {
        json!(value.to_string())
    }
}

fn usd(microusd: u128) -> String {
    format!("{}.{:06}", microusd / 1_000_000, microusd % 1_000_000)
}

#[derive(Default, Clone)]
struct Sum {
    tokens: [u128; 5],
    records: u128,
    reported: u128,
    reported_records: u128,
    estimated: u128,
    estimated_records: u128,
}

fn decimal(text: &str) -> Result<u128, &'static str> {
    text.parse::<u128>().map_err(|_| "stats_report_invalid")
}

impl Sum {
    fn add(&mut self, row: &Row) -> Result<(), &'static str> {
        let add = |target: &mut u128, value: u128| -> Result<(), &'static str> {
            *target = target.checked_add(value).ok_or("stats_value_limit")?;
            Ok(())
        };
        for (target, value) in self.tokens.iter_mut().zip([
            &row.tokens.input,
            &row.tokens.cache_read,
            &row.tokens.cache_write,
            &row.tokens.output,
            &row.tokens.reasoning,
        ]) {
            add(target, decimal(value)?)?;
        }
        add(&mut self.records, u128::from(row.records))?;
        if let Some(cost) = &row.reported_cost_microusd {
            add(&mut self.reported, decimal(cost)?)?;
            add(
                &mut self.reported_records,
                u128::from(row.reported_cost_records),
            )?;
        }
        if let Some(cost) = &row.estimated_cost_microusd {
            add(&mut self.estimated, decimal(cost)?)?;
            add(
                &mut self.estimated_records,
                u128::from(row.estimated_cost_records),
            )?;
        }
        Ok(())
    }

    fn total(&self) -> Result<u128, &'static str> {
        self.tokens
            .iter()
            .try_fold(0u128, |sum, value| sum.checked_add(*value))
            .ok_or("stats_value_limit")
    }

    fn json(&self) -> Result<Value, &'static str> {
        Ok(json!({
            "tokens": {
                "input": number(self.tokens[0]),
                "cacheRead": number(self.tokens[1]),
                "cacheWrite": number(self.tokens[2]),
                "output": number(self.tokens[3]),
                "reasoning": number(self.tokens[4]),
                "total": number(self.total()?),
            },
            "records": number(self.records),
            "reportedCostUsd": (self.reported_records > 0).then(|| usd(self.reported)),
            "reportedCostRecords": number(self.reported_records),
            "estimatedCostUsd": (self.estimated_records > 0).then(|| usd(self.estimated)),
            "estimatedCostRecords": number(self.estimated_records),
        }))
    }

    /// Flat day fields for charting.
    fn flat(&self) -> Result<Map<String, Value>, &'static str> {
        let mut map = Map::new();
        map.insert("total".to_owned(), number(self.total()?));
        for (name, value) in ["input", "cacheRead", "cacheWrite", "output", "reasoning"]
            .iter()
            .zip(self.tokens)
        {
            map.insert((*name).to_owned(), number(value));
        }
        map.insert("records".to_owned(), number(self.records));
        Ok(map)
    }
}

fn period(report: &Report) -> Result<Value, &'static str> {
    Ok(json!({
        "first": history::utc_date(report.first_utc_day)?,
        "last": history::utc_date(report.first_utc_day + report.day_count - 1)?,
        "days": report.day_count,
    }))
}

fn coverage(report: &Report) -> Value {
    let read: Vec<Value> = report
        .sources
        .iter()
        .filter(|source| source.status != "not_found")
        .map(|source| {
            json!({
                "client": source.client,
                "status": source.status,
                "tokenBasis": source.token_basis,
                "records": source.records,
            })
        })
        .collect();
    let not_found = report
        .sources
        .iter()
        .filter(|source| source.status == "not_found")
        .count();
    json!({"clients": read, "notFound": not_found})
}

/// The named key fields of one group, and its running sum.
type Group = (Vec<(&'static str, Value)>, Sum);

fn group_key(row: &Row, group_by: &str) -> Vec<(&'static str, Value)> {
    let client = || ("client", json!(row.client));
    let model = || ("model", json!(row.model));
    let provider = || ("provider", json!(row.provider));
    match group_by {
        "client" => vec![client()],
        "model" => vec![model()],
        "provider" => vec![provider()],
        "client_model" => vec![client(), model()],
        _ => Vec::new(),
    }
}

fn summary(ctx: &Context, arguments: &Map<String, Value>) -> Result<Content, &'static str> {
    let now = (ctx.clock)()?;
    let query = query(arguments, &["group_by"], now)?;
    let group_by = choice(
        arguments,
        "group_by",
        &["client", "model", "provider", "client_model", "total"],
        "client",
    )?;
    let (report, source) = load(ctx, &query)?;
    let mut groups: BTreeMap<String, Group> = BTreeMap::new();
    let mut total = Sum::default();
    for row in &report.rows {
        let fields = group_key(row, group_by);
        let identity = serde_json::to_string(
            &fields
                .iter()
                .map(|(_, value)| value.clone())
                .collect::<Vec<_>>(),
        )
        .map_err(|_| "stats_encode_failed")?;
        groups
            .entry(identity)
            .or_insert_with(|| (fields, Sum::default()))
            .1
            .add(row)?;
        total.add(row)?;
    }
    let mut ranked: Vec<(u128, Value)> = Vec::with_capacity(groups.len());
    for (fields, sum) in groups.into_values() {
        let mut value = sum.json()?;
        for (name, field) in fields {
            value[name] = field;
        }
        ranked.push((sum.total()?, value));
    }
    ranked.sort_by_key(|(total, _)| std::cmp::Reverse(*total));
    Ok(Content::Json(json!({
        "period": period(&report)?,
        "source": source,
        "groupBy": group_by,
        "total": total.json()?,
        "groups": ranked.into_iter().map(|(_, value)| value).collect::<Vec<_>>(),
        "coverage": coverage(&report),
        "uploaded": false,
    })))
}

fn daily(ctx: &Context, arguments: &Map<String, Value>) -> Result<Content, &'static str> {
    let now = (ctx.clock)()?;
    let query = query(arguments, &["group_by"], now)?;
    let group_by = choice(
        arguments,
        "group_by",
        &["total", "client", "model", "provider"],
        "total",
    )?;
    let (report, source) = load(ctx, &query)?;
    let mut days: BTreeMap<(u64, String), Group> = BTreeMap::new();
    for row in &report.rows {
        let fields = group_key(row, group_by);
        let identity = serde_json::to_string(
            &fields
                .iter()
                .map(|(_, value)| value.clone())
                .collect::<Vec<_>>(),
        )
        .map_err(|_| "stats_encode_failed")?;
        days.entry((row.utc_day, identity))
            .or_insert_with(|| (fields, Sum::default()))
            .1
            .add(row)?;
    }
    let mut series = Vec::with_capacity(days.len());
    for ((day, _), (fields, sum)) in days {
        let mut point = Map::new();
        point.insert("date".to_owned(), json!(history::utc_date(day)?));
        for (name, field) in fields {
            point.insert(name.to_owned(), field);
        }
        point.extend(sum.flat()?);
        series.push(Value::Object(point));
    }
    Ok(Content::Json(json!({
        "period": period(&report)?,
        "source": source,
        "groupBy": group_by,
        "series": series,
        "coverage": coverage(&report),
        "uploaded": false,
    })))
}

fn full_report(ctx: &Context, arguments: &Map<String, Value>) -> Result<Content, &'static str> {
    let now = (ctx.clock)()?;
    let query = query(arguments, &["format"], now)?;
    let format = choice(arguments, "format", &["json", "csv"], "json")?;
    let (report, _) = load(ctx, &query)?;
    match format {
        "csv" => Ok(Content::Text(history::csv(&report)?)),
        _ => Ok(Content::Json(
            serde_json::to_value(&report).map_err(|_| "stats_encode_failed")?,
        )),
    }
}

fn no_arguments(arguments: &Map<String, Value>) -> Result<(), &'static str> {
    if arguments.is_empty() {
        Ok(())
    } else {
        Err("invalid_option")
    }
}

fn clients(ctx: &Context, arguments: &Map<String, Value>) -> Result<Content, &'static str> {
    no_arguments(arguments)?;
    let now = (ctx.clock)()?;
    let store = history::read_store(&ctx.dir, now)?;
    let recorded: Vec<Value> = store
        .iter()
        .flat_map(|store| store.clients.iter())
        .map(|client| {
            let days: Vec<u64> = store
                .iter()
                .flat_map(|store| store.rows.iter())
                .filter(|row| row.client == client.client)
                .map(|row| row.utc_day)
                .collect();
            json!({
                "client": client.client,
                "firstDate": days.iter().min().map(|day| history::utc_date(*day).unwrap_or_default()),
                "lastDate": days.iter().max().map(|day| history::utc_date(*day).unwrap_or_default()),
            })
        })
        .collect();
    Ok(Content::Json(json!({
        "supported": aicharts_import::clients(),
        "recorded": recorded,
    })))
}

fn history_status(ctx: &Context, arguments: &Map<String, Value>) -> Result<Content, &'static str> {
    no_arguments(arguments)?;
    let now = (ctx.clock)()?;
    Ok(Content::Json(
        serde_json::to_value(history::status_data(&ctx.dir, now)?)
            .map_err(|_| "stats_encode_failed")?,
    ))
}

const HELP: &str = "Usage: aicharts mcp

Serve read-only usage tools to an agent over the Model Context Protocol
(stdio). Tools answer from your local usage history (aicharts history), or
from your agents' session files when the history is empty. Nothing is
written, collected or uploaded.

Tools
  usage_summary          Totals by agent, model or provider
  usage_daily            Token use per day, for charts
  usage_report           Every report row as JSON or CSV
  usage_clients          The agents aicharts reads and has recorded
  usage_history_status   Whether scheduled collection is on

Register it once
  claude mcp add aicharts -- aicharts mcp
  codex mcp add aicharts -- aicharts mcp
  devin mcp add -s user aicharts -- aicharts mcp
";

pub(crate) fn help() -> &'static str {
    HELP
}

pub(crate) fn run(args: &[String]) -> i32 {
    if args.len() > 1 {
        crate::errors::report("invalid_option", args);
        return 2;
    }
    let (dir, home) = match (
        history::live_directory(),
        std::env::var_os("HOME").map(PathBuf::from),
    ) {
        (Ok(dir), Some(home)) if home.is_absolute() => (dir, home),
        _ => {
            crate::errors::report("home_required", args);
            return 2;
        }
    };
    let ctx = Context {
        dir,
        home,
        clock: &stats::now_ms,
        scan: &history::live_scan,
    };
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    match serve(&ctx, &mut stdin.lock(), &mut stdout.lock()) {
        Ok(()) => 0,
        Err(_) => 1,
    }
}

#[cfg(test)]
mod tests;
