//! Bounded local projections. No source identity or free text crosses this boundary.
use aicharts_import::{CostSource, LocalImport};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::OnceLock;
mod health;
mod pricing;
pub(super) use health::run_retained_health;
use health::CollectedStats;
#[cfg(target_os = "macos")]
pub(super) use health::{collect_persisted, observation_scope};

pub(super) const DAY_MS: u64 = 86_400_000;
pub(super) const MAX_ROWS: usize = 65_536;
pub(super) const MAX_BYTES: usize = 32 * 1024 * 1024;
const MAX_RECORDS: u64 = 10_000_000;
const MAX_DECIMAL: u128 = aicharts_metrics::MAX_DECIMAL;
const HELP: &str = "AI Charts detailed stats: local, read-only\n\n  aicharts stats --home DIR (--all | --client ID ...) [--source-root DIR ...] [--since YYYY-MM-DD --until YYYY-MM-DD] [--json | --health-json]\n  aicharts stats --list-clients\n\nThe default period is the last 30 UTC days, including today. Select up to 366\ndays. --home is an explicit absolute directory. To read one configured profile,\nselect one client and supply its exclusive absolute --source-root directories.\nWithout those roots, discovery uses the selected home and stays within it.\nLocal parser support includes every client in the pinned Tokscale registry.\nSome clients require an existing local export or API cache. This command does\nnot refresh credentials or contact providers. It never uploads anything.\n\nJSON contains day/client/model aggregates, disjoint token buckets, known costs\nand coverage. Unknown identities are withheld. Unknown costs stay unknown;\nreported charges and estimates are separate. Failed scans are incomplete, never\na successful empty replacement. --health-json emits separate measured source\nhealth, including parsing work, partial tails and fixed warning codes. It keeps\nunknown counters null and does not create persistent state.\nRedirect --json output to import at /usage/details.\n";

#[derive(Deserialize)]
struct Registry {
    clients: Vec<ClientIdentity>,
    models: BTreeSet<String>,
    providers: BTreeSet<String>,
}
#[derive(Deserialize)]
struct ClientIdentity {
    id: String,
}
fn registry() -> &'static Registry {
    static VALUE: OnceLock<Registry> = OnceLock::new();
    VALUE.get_or_init(|| {
        serde_json::from_str(include_str!("../../../data/usage-registry.json"))
            .expect("checked usage registry")
    })
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Tokens {
    pub input: String,
    pub cache_read: String,
    pub cache_write: String,
    pub output: String,
    pub reasoning: String,
}
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Row {
    pub utc_day: u64,
    pub client: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub tokens: Tokens,
    pub records: u64,
    pub reported_cost_microusd: Option<String>,
    pub reported_cost_records: u64,
    pub estimated_cost_microusd: Option<String>,
    pub estimated_cost_records: u64,
    pub duration_ms: Option<String>,
    pub timed_records: u64,
    pub timed_tokens: String,
    pub token_basis: String,
    pub breakdown_coverage: String,
}
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Source {
    pub client: String,
    pub status: String,
    pub token_basis: String,
    pub records: u64,
    pub warnings: u64,
    pub latest_at_ms: Option<u64>,
}
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Report {
    pub schema_version: u8,
    pub profile: String,
    pub registry_revision: u8,
    pub first_utc_day: u64,
    pub day_count: u64,
    pub generated_at_ms: u64,
    pub revision: u64,
    pub updated_at_ms: Option<u64>,
    pub sources: Vec<Source>,
    pub rows: Vec<Row>,
}

pub(super) struct Options {
    pub home: PathBuf,
    pub clients: Vec<String>,
    pub source_roots: Vec<PathBuf>,
    pub first_utc_day: u64,
    pub day_count: u64,
    pub json: bool,
    pub health_json: bool,
}
fn decimal(value: &str) -> Option<u128> {
    if value.is_empty()
        || value.len() > 24
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return None;
    }
    value.parse().ok()
}
fn row_key(row: &Row) -> (u64, &str, Option<&str>, Option<&str>, &str) {
    (
        row.utc_day,
        &row.client,
        row.provider.as_deref(),
        row.model.as_deref(),
        &row.token_basis,
    )
}
/// Mirrors the shared browser/Worker report contract at the persistent native
/// boundary. Source strings are never trusted merely because serde parsed them.
pub(super) fn validate_report(report: &Report) -> Result<(), &'static str> {
    let invalid = "stats_report_invalid";
    if report.schema_version != 2
        || report.profile != "client-stats-v2"
        || report.registry_revision != 1
        || report.first_utc_day > 99_999_999
        || !(1..=366).contains(&report.day_count)
        || report.first_utc_day + report.day_count - 1 > 99_999_999
        || report.generated_at_ms > 8_640_000_000_000_000
        || report.revision > 9_007_199_254_740_991
        || (report.revision == 0) != report.updated_at_ms.is_none()
        || report
            .updated_at_ms
            .is_some_and(|time| time > 8_640_000_000_000_000)
        || report.sources.len() > 64
        || report.rows.len() > MAX_ROWS
    {
        return Err(invalid);
    }
    let mut sources = BTreeMap::new();
    let mut previous = "";
    for source in &report.sources {
        if source.client.as_str() <= previous
            || !registry().clients.iter().any(|c| c.id == source.client)
            || ![
                "observed",
                "empty",
                "not_found",
                "incomplete",
                "unavailable",
            ]
            .contains(&source.status.as_str())
            || !["reported", "estimated", "mixed", "unavailable"]
                .contains(&source.token_basis.as_str())
            || source.records > MAX_RECORDS
            || source.warnings > MAX_RECORDS
            || source
                .latest_at_ms
                .is_some_and(|time| time > report.generated_at_ms)
            || (["empty", "not_found", "unavailable"].contains(&source.status.as_str())
                && (source.records != 0 || source.latest_at_ms.is_some()))
        {
            return Err(invalid);
        }
        previous = &source.client;
        sources.insert(source.client.as_str(), source);
    }
    let mut totals: BTreeMap<&str, u64> = BTreeMap::new();
    let mut bases: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    let mut previous = None;
    for row in &report.rows {
        let key = row_key(row);
        let source = sources.get(row.client.as_str()).ok_or(invalid)?;
        if previous.is_some_and(|before| key <= before)
            || row.utc_day < report.first_utc_day
            || row.utc_day >= report.first_utc_day + report.day_count
            || !["observed", "incomplete"].contains(&source.status.as_str())
            || row
                .provider
                .as_ref()
                .is_some_and(|p| !registry().providers.contains(p))
            || row
                .model
                .as_ref()
                .is_some_and(|m| !registry().models.contains(m))
            || !(1..=MAX_RECORDS).contains(&row.records)
            || row.reported_cost_records > row.records
            || row.estimated_cost_records > row.records
            || row.timed_records > row.records
            || row.reported_cost_records + row.estimated_cost_records > row.records
            || !["reported", "estimated", "unavailable"].contains(&row.token_basis.as_str())
            || !["partial", "complete"].contains(&row.breakdown_coverage.as_str())
        {
            return Err(invalid);
        }
        previous = Some(key);
        for (amount, count) in [
            (&row.reported_cost_microusd, row.reported_cost_records),
            (&row.estimated_cost_microusd, row.estimated_cost_records),
            (&row.duration_ms, row.timed_records),
        ] {
            if match amount {
                Some(value) => count == 0 || decimal(value).is_none(),
                None => count != 0,
            } {
                return Err(invalid);
            }
        }
        let mut total = 0u128;
        for value in [
            &row.tokens.input,
            &row.tokens.cache_read,
            &row.tokens.cache_write,
            &row.tokens.output,
            &row.tokens.reasoning,
        ] {
            total += decimal(value).ok_or(invalid)?;
        }
        let timed = decimal(&row.timed_tokens).ok_or(invalid)?;
        if timed > total
            || (row.timed_records == 0 && timed != 0)
            || (row.token_basis == "unavailable"
                && (total != 0 || timed != 0 || row.breakdown_coverage != "partial"))
        {
            return Err(invalid);
        }
        let count = totals.entry(&row.client).or_default();
        *count = count
            .checked_add(row.records)
            .filter(|count| *count <= MAX_RECORDS && *count <= source.records)
            .ok_or(invalid)?;
        bases
            .entry(&row.client)
            .or_default()
            .insert(&row.token_basis);
    }
    for source in &report.sources {
        if totals.get(source.client.as_str()).copied().unwrap_or(0) != source.records {
            return Err(invalid);
        }
        if let Some(basis) = bases.get(source.client.as_str()) {
            let expected = if basis.len() > 1 {
                "mixed"
            } else {
                basis.first().copied().ok_or(invalid)?
            };
            if source.token_basis != expected {
                return Err(invalid);
            }
        }
    }
    if serde_json::to_vec(report).map_err(|_| invalid)?.len() > MAX_BYTES {
        return Err(invalid);
    }
    Ok(())
}
pub(super) fn now_ms() -> Result<u64, &'static str> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|time| time.as_millis().try_into().ok())
        .filter(|time| *time <= 8_640_000_000_000_000)
        .ok_or("stats_clock_invalid")
}
fn date_day(value: &str) -> Result<u64, &'static str> {
    if value.len() != 10 || !value.is_ascii() {
        return Err("stats_date_invalid");
    }
    let format = time::format_description::parse_borrowed::<2>("[year]-[month]-[day]")
        .map_err(|_| "stats_date_invalid")?;
    let date = time::Date::parse(value, &format).map_err(|_| "stats_date_invalid")?;
    u64::try_from(date.midnight().assume_utc().unix_timestamp() / 86_400)
        .map_err(|_| "stats_date_invalid")
}
pub(super) fn options(args: &[String], now: u64) -> Result<Options, &'static str> {
    let mut home = None;
    let mut clients = BTreeSet::new();
    let mut source_roots = Vec::new();
    let (mut all, mut json, mut health_json) = (false, false, false);
    let (mut since, mut until) = (None, None);
    let mut args = args.iter();
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--json" if !json && !health_json => json = true,
            "--health-json" if !json && !health_json => health_json = true,
            "--all" if !all && clients.is_empty() => all = true,
            "--home" | "--client" | "--since" | "--until" | "--source-root" => {
                let value = args
                    .next()
                    .filter(|v| !v.is_empty() && !v.starts_with("--"))
                    .ok_or("missing_option_value")?;
                match flag.as_str() {
                    "--home" if home.is_none() => home = Some(PathBuf::from(value)),
                    "--source-root"
                        if source_roots.len() < 128 && PathBuf::from(value).is_absolute() =>
                    {
                        let path = PathBuf::from(value);
                        if source_roots.contains(&path) {
                            return Err("invalid_option");
                        }
                        source_roots.push(path);
                    }
                    "--client" if !all && aicharts_import::clients().contains(&value.as_str()) => {
                        if !clients.insert(value.clone()) {
                            return Err("invalid_option");
                        }
                    }
                    "--since" if since.is_none() => since = Some(date_day(value)?),
                    "--until" if until.is_none() => until = Some(date_day(value)?),
                    _ => return Err("invalid_option"),
                }
            }
            _ => return Err("invalid_option"),
        }
    }
    if all {
        clients.extend(
            aicharts_import::all_clients()
                .iter()
                .map(|s| (*s).to_owned()),
        );
    }
    if clients.contains("gjc") && clients.contains("9router") {
        return Err("stats_overlapping_clients");
    }
    if clients.is_empty() {
        return Err("stats_client_required");
    }
    if !source_roots.is_empty()
        && (clients.len() != 1
            || !aicharts_import::profile_clients()
                .contains(&clients.first().ok_or("stats_client_required")?.as_str()))
    {
        return Err("stats_source_profile_unsupported");
    }
    let home = home
        .filter(|p| p.is_absolute())
        .ok_or("stats_home_required")?;
    let end = until.unwrap_or(now / DAY_MS);
    let start = since.unwrap_or(end.saturating_sub(29));
    let day_count = end
        .checked_sub(start)
        .and_then(|n| n.checked_add(1))
        .filter(|n| *n <= 366)
        .ok_or("stats_range_invalid")?;
    if end > now / DAY_MS || end > 99_999_999 {
        return Err("stats_range_invalid");
    }
    Ok(Options {
        home,
        clients: clients.into_iter().collect(),
        source_roots,
        first_utc_day: start,
        day_count,
        json,
        health_json,
    })
}

#[derive(Default)]
struct Aggregate {
    tokens: [u128; 5],
    records: u64,
    reported_cost: u128,
    reported_records: u64,
    estimated_cost: u128,
    estimated_records: u64,
    duration: u128,
    timed_records: u64,
    timed_tokens: u128,
}
fn add(target: &mut u128, value: u128) -> Result<(), &'static str> {
    *target = aicharts_metrics::checked_add_bounded(*target, value, MAX_DECIMAL)
        .map_err(|_| "stats_value_limit")?;
    Ok(())
}
fn add_records(target: &mut u64, value: u64) -> Result<(), &'static str> {
    *target = aicharts_metrics::checked_add_bounded(
        u128::from(*target),
        u128::from(value),
        u128::from(MAX_RECORDS),
    )
    .map_err(|_| "stats_record_limit")? as u64;
    Ok(())
}
fn model_identity(value: &str, known: &BTreeSet<String>) -> Option<String> {
    // The fixed public registry is the only permitted name vocabulary. Never
    // send source model aliases, custom endpoints, workspaces or session IDs.
    if value.len() > 160 {
        return None;
    }
    let value = value.to_ascii_lowercase();
    known.contains(&value).then_some(value)
}
fn cost_microusd(value: f64) -> Result<u128, &'static str> {
    // Retain micro-dollar precision only where the source float represents it.
    if !value.is_finite() || !(0.0..=9_007_199_254.0).contains(&value) {
        return Err("stats_cost_invalid");
    }
    Ok((value * 1_000_000.0).round() as u128)
}
type RowKey = (u64, String, Option<String>, Option<String>, String);
fn project(
    client: &str,
    import: LocalImport,
    options: &Options,
    now: u64,
) -> Result<(Source, Vec<Row>), &'static str> {
    let mut rows: BTreeMap<RowKey, Aggregate> = BTreeMap::new();
    let mut records = 0;
    let mut latest = None;
    let mut bases = BTreeSet::new();
    for message in import.messages {
        let basis = aicharts_import::token_basis(&message);
        if message.timestamp < 0 {
            return Err("stats_timestamp_invalid");
        }
        let timestamp = message.timestamp as u64;
        let day = timestamp / DAY_MS;
        if day < options.first_utc_day || day >= options.first_utc_day + options.day_count {
            continue;
        }
        if timestamp > now {
            return Err("stats_timestamp_invalid");
        }
        let count = u64::try_from(message.message_count)
            .map_err(|_| "stats_record_invalid")?
            // Some sources allocate a session's message count only to its
            // first model, or record spending without a request count. Each
            // normalized row is still one observation, never a claimed prompt.
            .max(1);
        let mut tokens = [0u128; 5];
        for (target, value) in tokens.iter_mut().zip([
            message.tokens.input,
            message.tokens.cache_read,
            message.tokens.cache_write,
            message.tokens.output,
            message.tokens.reasoning,
        ]) {
            // Saturated upstream counters cannot be accepted as measurements.
            if !(0..i64::MAX).contains(&value) {
                return Err("stats_token_invalid");
            }
            *target = value as u128;
        }
        let total = tokens.iter().sum::<u128>();
        if basis == "unavailable" && total != 0 {
            return Err("stats_token_basis_invalid");
        }
        bases.insert(basis);
        let model = (!message.model_attribution_conflicted)
            .then(|| model_identity(&message.model_id, &registry().models))
            .flatten();
        let provider = model_identity(&message.provider_id, &registry().providers);
        let estimate = if message.cost_source == CostSource::Unknown
            && !message.model_attribution_conflicted
            && basis != "unavailable"
        {
            pricing::estimate(provider.as_deref(), model.as_deref(), tokens)
        } else {
            None
        };
        let key = (day, client.to_owned(), provider, model, basis.to_owned());
        if !rows.contains_key(&key) && rows.len() >= MAX_ROWS {
            return Err("stats_row_limit");
        }
        let row = rows.entry(key).or_default();
        for (target, value) in row.tokens.iter_mut().zip(tokens) {
            add(target, value)?;
        }
        add_records(&mut row.records, count)?;
        add_records(&mut records, count)?;
        latest = Some(latest.map_or(timestamp, |t: u64| t.max(timestamp)));
        match message.cost_source {
            CostSource::Unknown => {
                if let Some(cost) = estimate {
                    add(&mut row.estimated_cost, cost)?;
                    add_records(&mut row.estimated_records, count)?;
                }
            }
            CostSource::ProviderReported => {
                add(&mut row.reported_cost, cost_microusd(message.cost)?)?;
                add_records(&mut row.reported_records, count)?;
            }
            CostSource::Estimated => {
                add(&mut row.estimated_cost, cost_microusd(message.cost)?)?;
                add_records(&mut row.estimated_records, count)?;
            }
        }
        if let Some(duration) = message.duration_ms {
            if duration < 0 {
                return Err("stats_duration_invalid");
            }
            add(&mut row.duration, duration as u128)?;
            add(&mut row.timed_tokens, total)?;
            add_records(&mut row.timed_records, count)?;
        }
    }
    let status = if records > 0 {
        "observed"
    } else if import.receipt.files > 0 {
        "empty"
    } else {
        "not_found"
    };
    let source = Source {
        client: client.to_owned(),
        status: status.to_owned(),
        token_basis: if bases.len() > 1 {
            "mixed"
        } else {
            bases.first().copied().unwrap_or("unavailable")
        }
        .to_owned(),
        records,
        warnings: 0,
        latest_at_ms: latest,
    };
    let rows = rows
        .into_iter()
        .map(|((day, client, provider, model, basis), row)| Row {
            utc_day: day,
            client,
            provider,
            model,
            tokens: Tokens {
                input: row.tokens[0].to_string(),
                cache_read: row.tokens[1].to_string(),
                cache_write: row.tokens[2].to_string(),
                output: row.tokens[3].to_string(),
                reasoning: row.tokens[4].to_string(),
            },
            records: row.records,
            reported_cost_microusd: (row.reported_records > 0)
                .then(|| row.reported_cost.to_string()),
            reported_cost_records: row.reported_records,
            estimated_cost_microusd: (row.estimated_records > 0)
                .then(|| row.estimated_cost.to_string()),
            estimated_cost_records: row.estimated_records,
            duration_ms: (row.timed_records > 0).then(|| row.duration.to_string()),
            timed_records: row.timed_records,
            timed_tokens: row.timed_tokens.to_string(),
            token_basis: basis,
            breakdown_coverage: "partial".to_owned(),
        })
        .collect();
    Ok((source, rows))
}
pub(super) fn collect(options: &Options, now: u64) -> Result<Report, &'static str> {
    collect_with_clock(options, now, now_ms)
}
fn collect_with_clock(
    options: &Options,
    now: u64,
    clock: impl FnMut() -> Result<u64, &'static str>,
) -> Result<Report, &'static str> {
    Ok(collect_detailed_with_clock(options, now, clock, None)?.report)
}
fn collect_detailed_with_clock(
    options: &Options,
    now: u64,
    mut clock: impl FnMut() -> Result<u64, &'static str>,
    mut persistence: Option<&mut health::Persistence>,
) -> Result<CollectedStats, &'static str> {
    let mut report = Report {
        schema_version: 2,
        profile: "client-stats-v2".to_owned(),
        registry_revision: 1,
        first_utc_day: options.first_utc_day,
        day_count: options.day_count,
        generated_at_ms: now,
        revision: 0,
        updated_at_ms: None,
        sources: Vec::new(),
        rows: Vec::new(),
    };
    let mut observations = Vec::new();
    for client in &options.clients {
        let (approved, source_roots) = if options.source_roots.is_empty() {
            (std::slice::from_ref(&options.home), None)
        } else {
            (
                options.source_roots.as_slice(),
                Some(options.source_roots.as_slice()),
            )
        };
        let started_at_ms = report.generated_at_ms;
        let mut imported = aicharts_import::collect_observed(
            &options.home,
            client,
            approved,
            source_roots,
            options.first_utc_day * DAY_MS,
            persistence.as_mut().and_then(|store| store.checkpoint()),
        );
        // Sources can append while a long scan is running. The report's time
        // describes completion, so those valid observations are not rejected
        // merely because they occurred after discovery began.
        let completed_at = clock()?;
        if completed_at < report.generated_at_ms || completed_at > 8_640_000_000_000_000 {
            return Err("stats_clock_regressed");
        }
        report.generated_at_ms = completed_at;
        let result = imported
            .result
            .map_err(|codes| {
                // The importer returns only fixed source-owned error codes.
                // Keep actionable local diagnostics out of the numeric DTO;
                // never format the source error, path or raw record itself.
                for code in codes.iter().take(8) {
                    diagnostic(client, code);
                }
                "stats_import_incomplete"
            })
            .and_then(|import| project(client, import, options, completed_at));
        match result {
            Ok((mut source, rows)) => {
                let warnings = health::publication_warnings(&imported.health);
                if imported.health.outcome != aicharts_import::ImportOutcome::Complete
                    || warnings > 0
                {
                    source.status = "incomplete".to_owned();
                    source.warnings = warnings.max(1);
                }
                if warnings > 0
                    && imported.health.outcome == aicharts_import::ImportOutcome::Complete
                {
                    health::projection_refused(&mut imported.health);
                }
                if source.status == "not_found" {
                    // A complete discovery with no available source cannot
                    // replace the last good measurement in retained health.
                    health::projection_refused(&mut imported.health);
                }
                report.sources.push(source);
                report.rows.extend(rows);
            }
            Err(code) => {
                health::projection_refused(&mut imported.health);
                diagnostic(client, code);
                report.sources.push(Source {
                    client: client.clone(),
                    status: "incomplete".to_owned(),
                    token_basis: "unavailable".to_owned(),
                    records: 0,
                    warnings: 1,
                    latest_at_ms: None,
                });
            }
        }
        if !imported.health.validate() {
            return Err("stats_source_health_invalid");
        }
        let observation = crate::source_health::Observation {
            started_at_ms,
            completed_at_ms: completed_at,
            health: imported.health,
        };
        let binding = persistence
            .as_mut()
            .map(|store| store.record(client, options, &observation))
            .transpose()?;
        observations.push(health::SourceObservation {
            client: client.clone(),
            observation,
            binding,
        });
        if report.rows.len() > MAX_ROWS {
            return Err("stats_row_limit");
        }
    }
    report.rows.sort_by(|a, b| {
        (&a.utc_day, &a.client, &a.provider, &a.model, &a.token_basis).cmp(&(
            &b.utc_day,
            &b.client,
            &b.provider,
            &b.model,
            &b.token_basis,
        ))
    });
    validate_report(&report)?;
    let health = health::HealthReport {
        schema_version: 1,
        profile: "source-health-v1".to_owned(),
        registry_revision: 1,
        first_utc_day: options.first_utc_day,
        day_count: options.day_count,
        started_at_ms: now,
        completed_at_ms: report.generated_at_ms,
        sources: observations,
    };
    health.validate()?;
    Ok(CollectedStats { report, health })
}
fn diagnostic(client: &str, code: &str) {
    if aicharts_import::clients().contains(&client)
        && (code.starts_with("import_") || code.starts_with("stats_"))
        && code.len() <= 100
        && code.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
    {
        eprintln!("aicharts: source={client} code={code}");
    }
}
pub(super) fn run(args: &[String]) -> Result<String, &'static str> {
    if args == ["stats", "--help"] || args == ["stats", "-h"] {
        return Ok(HELP.to_owned());
    }
    if args == ["stats", "--list-clients"] {
        return Ok(aicharts_import::clients().join("\n") + "\n");
    }
    let now = now_ms()?;
    let options = options(&args[1..], now)?;
    let collected = collect_detailed_with_clock(&options, now, now_ms, None)?;
    if options.health_json {
        return serde_json::to_string(&collected.health).map_err(|_| "stats_encode_failed");
    }
    let report = collected.report;
    if options.json {
        return serde_json::to_string(&report).map_err(|_| "stats_encode_failed");
    }
    let mut output = "AI Charts detailed stats: local only; nothing uploaded\nUTC period; token buckets are disjoint. Costs may be unmeasured.\n".to_owned();
    for source in &report.sources {
        let total: u128 = report
            .rows
            .iter()
            .filter(|r| r.client == source.client)
            .map(|row| {
                [
                    &row.tokens.input,
                    &row.tokens.cache_read,
                    &row.tokens.cache_write,
                    &row.tokens.output,
                    &row.tokens.reasoning,
                ]
                .iter()
                .map(|n| n.parse::<u128>().unwrap_or(0))
                .sum::<u128>()
            })
            .sum();
        use std::fmt::Write;
        let _ = writeln!(
            output,
            "{}: {} tokens · {} records · {} · {} · {} warnings",
            source.client,
            total,
            source.records,
            source.token_basis,
            source.status,
            source.warnings
        );
    }
    output
        .push_str("Use --json for breakdowns at aicharts.io/usage/details; --health-json for measured source health.\n");
    Ok(output)
}

#[cfg(test)]
mod tests;
