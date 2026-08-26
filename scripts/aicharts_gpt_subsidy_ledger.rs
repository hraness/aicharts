// Local Codex usage ledger for the AI Charts GPT subsidy series.
//
// This source is compiled as an example inside the pinned Tokscale checkout so
// it can reuse Tokscale's incremental Codex parser, persistent source cache,
// global fork/replay event deduplication without vendoring Tokscale into this
// repository. API-equivalent cost is calculated from the checked AI Charts
// price manifest embedded into this binary at compile time.

use chrono::{DateTime, Days, NaiveDate, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::path::PathBuf;
use tokscale_core::{
    parse_local_unified_messages_with_pricing, LocalParseOptions, TokenBreakdown, UnifiedMessage,
};

const TOKSCALE_VERSION: &str = "4.13.0";
const TOKSCALE_COMMIT: &str = "0149a44329fb89865837dde40adb8cd9bc06bead";
const DEDUPLICATION: &str = "tokscale-global-event-identity";
const MAX_DAYS: usize = 366;
const MAX_MODELS: usize = 128;
const MAX_SAFE_JSON_INTEGER: i64 = 9_007_199_254_740_991;
const MEASUREMENT_MANIFEST_KIND: &str = "aicharts-gpt-subsidy-measurement";
const MEASUREMENT_MANIFEST_BYTES: &[u8] = include_bytes!("../data/gpt-subsidy-measurement.json");
const PRICING_MANIFEST_KIND: &str = "aicharts-openai-rate-manifest";
const PRICING_MANIFEST_BYTES: &[u8] = include_bytes!("../data/gpt-subsidy-pricing.json");
const TOKENS_PER_MILLION: f64 = 1_000_000.0;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicTokens {
    uncached_input: i64,
    cached_input: i64,
    output: i64,
    total: i64,
}

impl PublicTokens {
    fn from_tokscale(tokens: &TokenBreakdown) -> Result<Self, String> {
        for (name, value) in [
            ("input", tokens.input),
            ("cacheRead", tokens.cache_read),
            ("cacheWrite", tokens.cache_write),
            ("output", tokens.output),
            ("reasoning", tokens.reasoning),
        ] {
            if value < 0 {
                return Err(format!("Tokscale returned a negative {name} token count."));
            }
        }

        // The public chart has one uncached-input bucket. Cache creation is a
        // separately priced Tokscale bucket, so folding it into uncached input
        // is the conservative representation. Codex currently reports zero
        // cache-write tokens, but this keeps the boundary correct if that
        // changes.
        let uncached_input = checked_add(tokens.input, tokens.cache_write, "uncached input")?;
        // Tokscale's Codex parser splits reasoning out of output so its internal
        // TokenBreakdown stays additive. API pricing treats both at the output
        // rate, so the public output bucket recombines them exactly once.
        let output = checked_add(tokens.output, tokens.reasoning, "output")?;
        let total = checked_add(
            checked_add(uncached_input, tokens.cache_read, "total")?,
            output,
            "total",
        )?;
        let result = Self {
            uncached_input,
            cached_input: tokens.cache_read,
            output,
            total,
        };
        result.ensure_json_safe()?;
        Ok(result)
    }

    fn checked_add(self, other: Self) -> Result<Self, String> {
        let result = Self {
            uncached_input: checked_add(
                self.uncached_input,
                other.uncached_input,
                "uncached input",
            )?,
            cached_input: checked_add(self.cached_input, other.cached_input, "cached input")?,
            output: checked_add(self.output, other.output, "output")?,
            total: checked_add(self.total, other.total, "total")?,
        };
        result.ensure_json_safe()?;
        Ok(result)
    }

    fn ensure_json_safe(self) -> Result<(), String> {
        for (name, value) in [
            ("uncachedInput", self.uncached_input),
            ("cachedInput", self.cached_input),
            ("output", self.output),
            ("total", self.total),
        ] {
            if !(0..=MAX_SAFE_JSON_INTEGER).contains(&value) {
                return Err(format!("{name} is outside JSON's exact integer range."));
            }
        }
        let sum = checked_add(
            checked_add(self.uncached_input, self.cached_input, "token buckets")?,
            self.output,
            "token buckets",
        )?;
        if sum != self.total {
            return Err("Public token buckets do not sum to total.".to_string());
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct Aggregate {
    tokens: PublicTokens,
    api_equivalent_usd: f64,
}

impl Aggregate {
    fn add(&mut self, tokens: PublicTokens, cost: f64) -> Result<(), String> {
        if !cost.is_finite() || cost < 0.0 {
            return Err("Tokscale returned an invalid API-equivalent cost.".to_string());
        }
        self.tokens = self.tokens.checked_add(tokens)?;
        self.api_equivalent_usd += cost;
        if !self.api_equivalent_usd.is_finite() || self.api_equivalent_usd < 0.0 {
            return Err("API-equivalent cost aggregate is invalid.".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParserIdentity {
    name: &'static str,
    version: &'static str,
    commit: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RangeOutput {
    start_inclusive: String,
    end_exclusive: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PricingCoverage {
    status: &'static str,
    model_ids: Vec<String>,
    proxy_model_ids: Vec<String>,
    unpriced_model_ids: Vec<String>,
    basis: PricingBasis,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PricingBasis {
    kind: &'static str,
    sha256: String,
    frozen_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct MeasurementBasis {
    kind: &'static str,
    revision: String,
    sha256: String,
    frozen_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MeasurementParser {
    name: String,
    version: String,
    commit: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MeasurementImplementationFile {
    path: String,
    sha256: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MeasurementImplementation {
    ledger_adapter: MeasurementImplementationFile,
    public_updater: MeasurementImplementationFile,
    shared_contract: MeasurementImplementationFile,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MeasurementManifest {
    schema_version: u8,
    kind: String,
    revision: String,
    frozen_at: String,
    parser: MeasurementParser,
    deduplication: String,
    calendar: String,
    rolling_days: u8,
    period_summary_days: u8,
    implementation: MeasurementImplementation,
}

impl MeasurementManifest {
    fn parse(bytes: &[u8]) -> Result<Self, String> {
        let manifest: Self = serde_json::from_slice(bytes)
            .map_err(|error| format!("checked measurement manifest is invalid JSON: {error}"))?;
        manifest.validate()?;
        Ok(manifest)
    }

    fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1
            || self.kind != MEASUREMENT_MANIFEST_KIND
            || self.revision.trim().is_empty()
            || self.parser.name != "tokscale"
            || self.parser.version != TOKSCALE_VERSION
            || self.parser.commit != TOKSCALE_COMMIT
            || self.deduplication != DEDUPLICATION
            || self.calendar != "UTC"
            || self.rolling_days != 7
            || self.period_summary_days != 31
        {
            return Err("checked measurement manifest semantics are invalid".to_string());
        }
        let frozen = parse_rfc3339(&self.frozen_at)?;
        if frozen.time() != chrono::NaiveTime::MIN {
            return Err("checked measurement manifest freeze time is invalid".to_string());
        }
        for (file, expected_path) in [
            (
                &self.implementation.ledger_adapter,
                "scripts/aicharts_gpt_subsidy_ledger.rs",
            ),
            (
                &self.implementation.public_updater,
                "scripts/update-gpt-subsidy.ts",
            ),
            (
                &self.implementation.shared_contract,
                "lib/gpt-subsidy-manifests.ts",
            ),
        ] {
            if file.path != expected_path
                || file.sha256.len() != 64
                || !file
                    .sha256
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            {
                return Err("checked measurement implementation identity is invalid".to_string());
            }
        }
        Ok(())
    }

    fn basis(&self, bytes: &[u8]) -> MeasurementBasis {
        MeasurementBasis {
            kind: MEASUREMENT_MANIFEST_KIND,
            revision: self.revision.clone(),
            sha256: format!("{:x}", Sha256::digest(bytes)),
            frozen_at: self.frozen_at.clone(),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum PricingType {
    Official,
    Proxy,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RateSet {
    input: f64,
    cached_input: f64,
    cache_write: Option<f64>,
    output: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LongContextRule {
    threshold_input_tokens: i64,
    billing_scope: String,
    input_multiplier: f64,
    cached_input_multiplier: f64,
    cache_write_multiplier: f64,
    output_multiplier: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ModelRate {
    model_id: String,
    pricing_type: PricingType,
    proxy_model_id: Option<String>,
    proxy_rationale: Option<String>,
    source_url: String,
    rates: RateSet,
    long_context: Option<LongContextRule>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PricingManifest {
    schema_version: u8,
    kind: String,
    currency: String,
    unit: String,
    frozen_at: String,
    normalization_policy: String,
    models: Vec<ModelRate>,
}

impl PricingManifest {
    fn parse(bytes: &[u8]) -> Result<Self, String> {
        let manifest: Self = serde_json::from_slice(bytes)
            .map_err(|error| format!("checked price manifest is invalid JSON: {error}"))?;
        manifest.validate()?;
        Ok(manifest)
    }

    fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1
            || self.kind != PRICING_MANIFEST_KIND
            || self.currency != "USD"
            || self.unit != "per-million-tokens"
        {
            return Err("checked price manifest identity is invalid".to_string());
        }
        let frozen = parse_rfc3339(&self.frozen_at)?;
        if frozen.time() != chrono::NaiveTime::MIN || self.normalization_policy.trim().is_empty() {
            return Err("checked price manifest metadata is invalid".to_string());
        }
        if self.models.is_empty() || self.models.len() > MAX_MODELS {
            return Err("checked price manifest model count is invalid".to_string());
        }

        let mut previous: Option<&str> = None;
        for model in &self.models {
            if model.model_id.trim() != model.model_id
                || model.model_id.is_empty()
                || previous.is_some_and(|value| value >= model.model_id.as_str())
            {
                return Err(
                    "checked price manifest model ids must be non-empty, unique, and sorted"
                        .to_string(),
                );
            }
            previous = Some(&model.model_id);
            if model
                .source_url
                .strip_prefix("https://developers.openai.com/")
                .is_none()
            {
                return Err(format!(
                    "{} does not cite an official OpenAI developer source",
                    model.model_id
                ));
            }
            for (name, rate) in [
                ("input", model.rates.input),
                ("cached input", model.rates.cached_input),
                ("output", model.rates.output),
            ] {
                if !rate.is_finite() || rate <= 0.0 {
                    return Err(format!("{} has an invalid {name} rate", model.model_id));
                }
            }
            if model
                .rates
                .cache_write
                .is_some_and(|rate| !rate.is_finite() || rate <= 0.0)
            {
                return Err(format!(
                    "{} has an invalid cache-write rate",
                    model.model_id
                ));
            }
            match model.pricing_type {
                PricingType::Official => {
                    if model.proxy_model_id.is_some() || model.proxy_rationale.is_some() {
                        return Err(format!(
                            "{} is official but declares proxy metadata",
                            model.model_id
                        ));
                    }
                }
                PricingType::Proxy => {
                    let proxy = model
                        .proxy_model_id
                        .as_deref()
                        .ok_or_else(|| format!("{} proxy has no proxyModelId", model.model_id))?;
                    if proxy == model.model_id
                        || model
                            .proxy_rationale
                            .as_deref()
                            .is_none_or(|value| value.trim().is_empty())
                    {
                        return Err(format!("{} has invalid proxy metadata", model.model_id));
                    }
                }
            }
            if let Some(rule) = &model.long_context {
                if rule.threshold_input_tokens <= 0
                    || rule.billing_scope != "full-request"
                    || [
                        rule.input_multiplier,
                        rule.cached_input_multiplier,
                        rule.cache_write_multiplier,
                        rule.output_multiplier,
                    ]
                    .into_iter()
                    .any(|value| !value.is_finite() || value < 1.0)
                {
                    return Err(format!(
                        "{} has an invalid long-context rule",
                        model.model_id
                    ));
                }
            }
        }

        for model in self
            .models
            .iter()
            .filter(|model| model.pricing_type == PricingType::Proxy)
        {
            let proxy_id = model.proxy_model_id.as_deref().expect("validated proxy id");
            let target = self
                .models
                .iter()
                .find(|candidate| candidate.model_id == proxy_id)
                .ok_or_else(|| format!("{} proxy target is missing", model.model_id))?;
            if target.pricing_type != PricingType::Official
                || model.source_url != target.source_url
                || !same_rates(&model.rates, &target.rates)
                || !same_long_context(model.long_context.as_ref(), target.long_context.as_ref())
            {
                return Err(format!(
                    "{} proxy rates drifted from {}",
                    model.model_id, proxy_id
                ));
            }
        }
        Ok(())
    }

    fn basis(&self, bytes: &[u8]) -> PricingBasis {
        PricingBasis {
            kind: PRICING_MANIFEST_KIND,
            sha256: format!("{:x}", Sha256::digest(bytes)),
            frozen_at: self.frozen_at.clone(),
        }
    }

    fn rate(&self, model_id: &str) -> Option<&ModelRate> {
        self.models
            .binary_search_by_key(&model_id, |model| model.model_id.as_str())
            .ok()
            .map(|index| &self.models[index])
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DayOutput {
    date: String,
    complete: bool,
    tokens: PublicTokens,
    api_equivalent_usd: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LedgerOutput {
    schema_version: u8,
    parser: ParserIdentity,
    deduplication: &'static str,
    measurement_basis: MeasurementBasis,
    range: RangeOutput,
    pricing_coverage: PricingCoverage,
    days: Vec<DayOutput>,
}

#[derive(Clone, Debug)]
struct RequestedRange {
    start_raw: String,
    end_raw: String,
    start_ms: i64,
    end_ms: i64,
    first_day: NaiveDate,
    last_day: NaiveDate,
}

impl RequestedRange {
    fn parse(start_raw: String, end_raw: String) -> Result<Self, String> {
        let start = parse_rfc3339(&start_raw)?;
        let end = parse_rfc3339(&end_raw)?;
        if start >= end {
            return Err("history start must be before end".to_string());
        }
        if start.time() != chrono::NaiveTime::MIN {
            return Err("history start must be a UTC day boundary".to_string());
        }
        let first_day = start.date_naive();
        // end is exclusive. A midnight boundary therefore belongs to the
        // preceding day, while any later time includes the current UTC day.
        let last_included_ms = end
            .timestamp_millis()
            .checked_sub(1)
            .ok_or_else(|| "end timestamp is outside the supported range".to_string())?;
        let last_day = Utc
            .timestamp_millis_opt(last_included_ms)
            .single()
            .ok_or_else(|| "end timestamp is outside the supported range".to_string())?
            .date_naive();
        let day_count = last_day.signed_duration_since(first_day).num_days() + 1;
        if !(1..=MAX_DAYS as i64).contains(&day_count) {
            return Err(format!(
                "requested history must contain between 1 and {MAX_DAYS} UTC days"
            ));
        }
        Ok(Self {
            start_raw,
            end_raw,
            start_ms: start.timestamp_millis(),
            end_ms: end.timestamp_millis(),
            first_day,
            last_day,
        })
    }

    fn dates(&self) -> Result<Vec<NaiveDate>, String> {
        let mut dates = Vec::new();
        let mut cursor = self.first_day;
        loop {
            dates.push(cursor);
            if cursor == self.last_day {
                return Ok(dates);
            }
            cursor = cursor
                .checked_add_days(Days::new(1))
                .ok_or_else(|| "UTC day range overflowed".to_string())?;
        }
    }

    fn is_complete_day(&self, date: NaiveDate) -> Result<bool, String> {
        let next = date
            .checked_add_days(Days::new(1))
            .ok_or_else(|| "UTC day range overflowed".to_string())?;
        let next_ms = next
            .and_hms_opt(0, 0, 0)
            .ok_or_else(|| "could not construct UTC day boundary".to_string())?
            .and_utc()
            .timestamp_millis();
        Ok(next_ms <= self.end_ms)
    }
}

fn checked_add(left: i64, right: i64, label: &str) -> Result<i64, String> {
    left.checked_add(right)
        .ok_or_else(|| format!("{label} token count overflowed"))
}

fn parse_rfc3339(raw: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(raw)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| format!("invalid RFC3339 timestamp {raw:?}: {error}"))
}

fn round_money(value: f64) -> f64 {
    (value * 1_000_000_000_000.0).round() / 1_000_000_000_000.0
}

fn same_rates(left: &RateSet, right: &RateSet) -> bool {
    left.input.to_bits() == right.input.to_bits()
        && left.cached_input.to_bits() == right.cached_input.to_bits()
        && left.cache_write.map(f64::to_bits) == right.cache_write.map(f64::to_bits)
        && left.output.to_bits() == right.output.to_bits()
}

fn same_long_context(left: Option<&LongContextRule>, right: Option<&LongContextRule>) -> bool {
    match (left, right) {
        (None, None) => true,
        (Some(left), Some(right)) => {
            left.threshold_input_tokens == right.threshold_input_tokens
                && left.billing_scope == right.billing_scope
                && left.input_multiplier.to_bits() == right.input_multiplier.to_bits()
                && left.cached_input_multiplier.to_bits() == right.cached_input_multiplier.to_bits()
                && left.cache_write_multiplier.to_bits() == right.cache_write_multiplier.to_bits()
                && left.output_multiplier.to_bits() == right.output_multiplier.to_bits()
        }
        _ => false,
    }
}

fn price_message(model: &ModelRate, tokens: &TokenBreakdown) -> Result<f64, String> {
    let total_input = checked_add(
        checked_add(tokens.input, tokens.cache_read, "request input")?,
        tokens.cache_write,
        "request input",
    )?;
    let (input_multiplier, cached_multiplier, cache_write_multiplier, output_multiplier) = model
        .long_context
        .as_ref()
        .filter(|rule| total_input > rule.threshold_input_tokens)
        .map_or((1.0, 1.0, 1.0, 1.0), |rule| {
            (
                rule.input_multiplier,
                rule.cached_input_multiplier,
                rule.cache_write_multiplier,
                rule.output_multiplier,
            )
        });

    let cache_write_rate = match (tokens.cache_write, model.rates.cache_write) {
        (0, _) => 0.0,
        (_, Some(rate)) => rate,
        (_, None) => {
            return Err(format!(
                "{} has cache-write usage but its official source publishes no cache-write rate",
                model.model_id
            ));
        }
    };
    let output = checked_add(tokens.output, tokens.reasoning, "priced output")?;
    let cost = (tokens.input as f64 * model.rates.input * input_multiplier
        + tokens.cache_read as f64 * model.rates.cached_input * cached_multiplier
        + tokens.cache_write as f64 * cache_write_rate * cache_write_multiplier
        + output as f64 * model.rates.output * output_multiplier)
        / TOKENS_PER_MILLION;
    if !cost.is_finite() || cost <= 0.0 {
        return Err(format!(
            "{} produced a non-positive API-equivalent cost for nonzero usage",
            model.model_id
        ));
    }
    Ok(cost)
}

fn ledger_from_messages(
    messages: &[UnifiedMessage],
    pricing: &PricingManifest,
    measurement: &MeasurementManifest,
    requested: &RequestedRange,
) -> Result<LedgerOutput, String> {
    let mut by_day: BTreeMap<NaiveDate, Aggregate> = requested
        .dates()?
        .into_iter()
        .map(|date| (date, Aggregate::default()))
        .collect();
    let mut model_ids = BTreeSet::new();
    let mut proxy_model_ids = BTreeSet::new();
    let mut unpriced_model_ids = BTreeSet::new();

    for message in messages.iter().filter(|message| {
        message.timestamp >= requested.start_ms && message.timestamp < requested.end_ms
    }) {
        if message.client != "codex" {
            return Err(
                "Tokscale returned a non-Codex message for a Codex-only request.".to_string(),
            );
        }
        let tokens = PublicTokens::from_tokscale(&message.tokens)?;
        if tokens.total == 0 {
            continue;
        }
        model_ids.insert(message.model_id.clone());
        if message.provider_id != "openai" {
            return Err(format!(
                "{} usage came from unsupported provider {}",
                message.model_id, message.provider_id
            ));
        }
        let Some(model) = pricing.rate(&message.model_id) else {
            unpriced_model_ids.insert(message.model_id.clone());
            continue;
        };
        if model.pricing_type == PricingType::Proxy {
            proxy_model_ids.insert(message.model_id.clone());
        }
        let cost = price_message(model, &message.tokens)?;
        let date = Utc
            .timestamp_millis_opt(message.timestamp)
            .single()
            .ok_or_else(|| {
                "Tokscale returned a message timestamp outside the supported range.".to_string()
            })?
            .date_naive();
        by_day
            .get_mut(&date)
            .ok_or_else(|| "Tokscale message fell outside the requested UTC buckets.".to_string())?
            .add(tokens, cost)?;
    }

    if model_ids.len() > MAX_MODELS || unpriced_model_ids.len() > MAX_MODELS {
        return Err(format!(
            "pricing coverage exceeded the {MAX_MODELS}-model output bound"
        ));
    }
    if !unpriced_model_ids.is_empty() {
        let ids = unpriced_model_ids
            .iter()
            .cloned()
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!("checked pricing is incomplete for: {ids}"));
    }

    let days = by_day
        .into_iter()
        .map(|(date, aggregate)| {
            if aggregate.tokens.total > 0 && aggregate.api_equivalent_usd <= 0.0 {
                return Err(format!(
                    "{} has token usage without positive pricing",
                    date.format("%Y-%m-%d")
                ));
            }
            Ok(DayOutput {
                date: date.format("%Y-%m-%d").to_string(),
                complete: requested.is_complete_day(date)?,
                tokens: aggregate.tokens,
                api_equivalent_usd: round_money(aggregate.api_equivalent_usd),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    Ok(LedgerOutput {
        schema_version: 1,
        parser: ParserIdentity {
            name: "tokscale",
            version: TOKSCALE_VERSION,
            commit: TOKSCALE_COMMIT,
        },
        deduplication: DEDUPLICATION,
        measurement_basis: measurement.basis(MEASUREMENT_MANIFEST_BYTES),
        range: RangeOutput {
            start_inclusive: requested.start_raw.clone(),
            end_exclusive: requested.end_raw.clone(),
        },
        pricing_coverage: PricingCoverage {
            status: "complete",
            model_ids: model_ids.into_iter().collect(),
            proxy_model_ids: proxy_model_ids.into_iter().collect(),
            unpriced_model_ids: Vec::new(),
            basis: pricing.basis(PRICING_MANIFEST_BYTES),
        },
        days,
    })
}

fn resolve_home() -> Result<PathBuf, String> {
    if let Some(configured) = env::var_os("AICHARTS_GPT_SUBSIDY_HOME") {
        let path = PathBuf::from(configured);
        if !path.is_absolute() {
            return Err("AICHARTS_GPT_SUBSIDY_HOME must be absolute".to_string());
        }
        return Ok(path);
    }
    dirs::home_dir().ok_or_else(|| "could not resolve the local home directory".to_string())
}

fn configure_dedicated_cache() -> Result<PathBuf, String> {
    let config = if let Some(configured) = env::var_os("TOKSCALE_CONFIG_DIR") {
        PathBuf::from(configured)
    } else {
        let data_home = match env::var_os("XDG_DATA_HOME") {
            Some(value) => PathBuf::from(value),
            None => resolve_home()?.join(".local").join("share"),
        };
        if !data_home.is_absolute() {
            return Err("XDG_DATA_HOME must be absolute".to_string());
        }
        let configured = data_home
            .join("aicharts")
            .join("gpt-subsidy-ledger")
            .join("tokscale-config");
        // This runs before Tokscale initializes its scanner or parallel
        // parser. The process-local override isolates the incremental source
        // cache from unrelated Tokscale commands on the same machine.
        env::set_var("TOKSCALE_CONFIG_DIR", &configured);
        configured
    };
    if !config.is_absolute() {
        return Err("TOKSCALE_CONFIG_DIR must be absolute".to_string());
    }
    let custom_pricing = config.join("custom-pricing.json");
    if custom_pricing.exists() {
        return Err(format!(
            "refusing mutable Tokscale custom pricing at {}",
            custom_pricing.display()
        ));
    }
    Ok(config)
}

async fn parse_codex_messages(home: &std::path::Path) -> Result<Vec<UnifiedMessage>, String> {
    parse_local_unified_messages_with_pricing(
        LocalParseOptions {
            home_dir: Some(home.to_string_lossy().into_owned()),
            use_env_roots: false,
            clients: Some(vec!["codex".to_string()]),
            since: None,
            until: None,
            year: None,
            scanner_settings: Default::default(),
        },
        None,
    )
    .await
}

async fn run() -> Result<(), String> {
    configure_dedicated_cache()?;
    let pricing = PricingManifest::parse(PRICING_MANIFEST_BYTES)?;
    let measurement = MeasurementManifest::parse(MEASUREMENT_MANIFEST_BYTES)?;
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    if arguments.as_slice() == ["--warm-source-cache"] {
        let basis = pricing.basis(PRICING_MANIFEST_BYTES);
        let measurement_basis = measurement.basis(MEASUREMENT_MANIFEST_BYTES);
        let messages = parse_codex_messages(&resolve_home()?).await?;
        eprintln!(
            "aicharts-gpt-subsidy-ledger: verified embedded price manifest {} ({}), measurement manifest {} ({}), and warmed {} globally deduplicated Codex messages",
            basis.sha256,
            basis.frozen_at,
            measurement_basis.sha256,
            measurement_basis.frozen_at,
            messages.len(),
        );
        return Ok(());
    }
    let mut args = arguments.into_iter();
    let start = args.next().ok_or_else(|| {
        "usage: aicharts-gpt-subsidy-ledger HISTORY_START_RFC3339 END_RFC3339".to_string()
    })?;
    let end = args.next().ok_or_else(|| {
        "usage: aicharts-gpt-subsidy-ledger HISTORY_START_RFC3339 END_RFC3339".to_string()
    })?;
    if args.next().is_some() {
        return Err("expected exactly two positional timestamps".to_string());
    }
    let requested = RequestedRange::parse(start, end)?;
    let home = resolve_home()?;
    let messages = parse_codex_messages(&home).await?;
    let ledger = ledger_from_messages(&messages, &pricing, &measurement, &requested)?;
    let output = serde_json::to_string(&ledger)
        .map_err(|error| format!("could not serialize ledger output: {error}"))?;
    println!("{output}");
    Ok(())
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("aicharts-gpt-subsidy-ledger: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;

    static PARSER_ENV_LOCK: Mutex<()> = Mutex::new(());
    static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn pricing() -> PricingManifest {
        PricingManifest::parse(PRICING_MANIFEST_BYTES).expect("valid checked price manifest")
    }

    fn measurement() -> MeasurementManifest {
        MeasurementManifest::parse(MEASUREMENT_MANIFEST_BYTES)
            .expect("valid checked measurement manifest")
    }

    #[test]
    fn measurement_contract_has_no_subscription_projection_inputs() {
        let value: serde_json::Value = serde_json::from_slice(MEASUREMENT_MANIFEST_BYTES)
            .expect("valid checked measurement JSON");
        let object = value.as_object().expect("measurement manifest object");
        assert!(!object.contains_key("weeksPerMonth"));
        assert!(!object.contains_key("planPriceUsd"));
        measurement();
    }

    #[test]
    fn measurement_contract_rejects_legacy_subscription_projection_inputs() {
        let mut value: serde_json::Value = serde_json::from_slice(MEASUREMENT_MANIFEST_BYTES)
            .expect("valid checked measurement JSON");
        let object = value.as_object_mut().expect("measurement manifest object");
        object.insert("weeksPerMonth".to_string(), serde_json::json!(4));
        object.insert("planPriceUsd".to_string(), serde_json::json!(200));
        let legacy = serde_json::to_vec(&value).expect("serializable legacy manifest");
        let error = MeasurementManifest::parse(&legacy)
            .expect_err("legacy projection inputs must not be accepted");
        assert!(error.contains("unknown field"));
    }

    fn timestamp(raw: &str) -> i64 {
        parse_rfc3339(raw)
            .expect("valid test timestamp")
            .timestamp_millis()
    }

    fn message(at: &str, model: &str, tokens: TokenBreakdown) -> UnifiedMessage {
        UnifiedMessage::new(
            "codex",
            model,
            "openai",
            "session",
            timestamp(at),
            tokens,
            0.0,
        )
    }

    fn range() -> RequestedRange {
        RequestedRange::parse(
            "2026-08-01T00:00:00.000Z".to_string(),
            "2026-08-03T12:00:00.000Z".to_string(),
        )
        .expect("valid test range")
    }

    fn basis() -> PricingBasis {
        pricing().basis(PRICING_MANIFEST_BYTES)
    }

    #[test]
    fn normalizes_cache_write_and_reasoning_without_double_counting() {
        let tokens = PublicTokens::from_tokscale(&TokenBreakdown {
            input: 4,
            cache_read: 5,
            cache_write: 2,
            output: 6,
            reasoning: 3,
        })
        .expect("valid token buckets");
        assert_eq!(
            tokens,
            PublicTokens {
                uncached_input: 6,
                cached_input: 5,
                output: 9,
                total: 20,
            }
        );
    }

    #[test]
    fn produces_contiguous_utc_days_and_uses_an_exclusive_end() {
        let messages = vec![
            message(
                "2026-07-31T23:59:59.999Z",
                "gpt-test",
                TokenBreakdown {
                    input: 100,
                    ..Default::default()
                },
            ),
            message(
                "2026-08-01T00:00:00.000Z",
                "gpt-5.6-sol",
                TokenBreakdown {
                    input: 4,
                    ..Default::default()
                },
            ),
            message(
                "2026-08-03T11:59:59.999Z",
                "gpt-5.6-sol",
                TokenBreakdown {
                    output: 6,
                    reasoning: 3,
                    ..Default::default()
                },
            ),
            message(
                "2026-08-03T12:00:00.000Z",
                "gpt-5.6-sol",
                TokenBreakdown {
                    input: 100,
                    ..Default::default()
                },
            ),
        ];
        let ledger = ledger_from_messages(&messages, &pricing(), &measurement(), &range())
            .expect("complete ledger");
        assert_eq!(
            ledger
                .days
                .iter()
                .map(|day| day.date.as_str())
                .collect::<Vec<_>>(),
            vec!["2026-08-01", "2026-08-02", "2026-08-03",]
        );
        assert_eq!(
            ledger
                .days
                .iter()
                .map(|day| day.complete)
                .collect::<Vec<_>>(),
            vec![true, true, false]
        );
        assert_eq!(ledger.days[0].tokens.total, 4);
        assert_eq!(ledger.days[1].tokens.total, 0);
        assert_eq!(ledger.days[2].tokens.output, 9);
        assert_eq!(ledger.pricing_coverage.model_ids, vec!["gpt-5.6-sol"]);
    }

    #[test]
    fn fails_closed_when_any_used_model_is_unpriced() {
        let messages = vec![message(
            "2026-08-01T00:00:00.000Z",
            "unknown-model",
            TokenBreakdown {
                input: 1,
                ..Default::default()
            },
        )];
        let error = ledger_from_messages(&messages, &pricing(), &measurement(), &range())
            .expect_err("unpriced usage must fail");
        assert!(error.contains("unknown-model"));
    }

    #[test]
    fn fails_closed_for_non_openai_provider_usage() {
        let mut foreign = message(
            "2026-08-01T00:00:00.000Z",
            "gpt-5.6-sol",
            TokenBreakdown {
                input: 1,
                ..Default::default()
            },
        );
        foreign.provider_id = "reseller".to_string();
        let error = ledger_from_messages(&[foreign], &pricing(), &measurement(), &range())
            .expect_err("foreign provider usage must fail");
        assert!(error.contains("unsupported provider reseller"));
    }

    #[test]
    fn serializes_the_strict_public_contract_without_account_attribution() {
        let ledger =
            ledger_from_messages(&[], &pricing(), &measurement(), &range()).expect("empty ledger");
        let value = serde_json::to_value(ledger).expect("serializable ledger");
        assert_eq!(value["schemaVersion"], 1);
        assert_eq!(value["deduplication"], DEDUPLICATION);
        assert_eq!(value["parser"]["version"], TOKSCALE_VERSION);
        assert_eq!(value["measurementBasis"]["kind"], MEASUREMENT_MANIFEST_KIND);
        assert_eq!(
            value["measurementBasis"]["sha256"].as_str().map(str::len),
            Some(64)
        );
        assert_eq!(value["pricingCoverage"]["status"], "complete");
        assert_eq!(
            value["pricingCoverage"]["proxyModelIds"],
            serde_json::json!([])
        );
        assert_eq!(
            value["pricingCoverage"]["basis"]["frozenAt"],
            "2026-08-25T00:00:00Z"
        );
        assert_eq!(
            value["pricingCoverage"]["basis"]["sha256"]
                .as_str()
                .map(str::len),
            Some(64)
        );
        assert!(value.get("rootOnly").is_none());
        assert!(value.get("allowanceWindow").is_none());
    }

    #[test]
    fn pricing_basis_is_the_hash_of_exact_checked_manifest_bytes() {
        let original = basis();
        assert_eq!(
            original.sha256,
            "911b73c86f8e95c2a9f26fde9ab5930f02c7f5563d658946579f990d926cc9f3"
        );
        let mut changed = PRICING_MANIFEST_BYTES.to_vec();
        changed[0] ^= 1;
        assert_ne!(original.sha256, format!("{:x}", Sha256::digest(&changed)));
        assert_eq!(original.frozen_at, "2026-08-25T00:00:00Z");
    }

    #[test]
    fn proxy_metadata_and_math_cannot_drift_from_official_target() {
        let mut manifest = pricing();
        let proxy = manifest
            .models
            .iter_mut()
            .find(|model| model.model_id == "codex-auto-review")
            .expect("proxy row");
        proxy.rates.output += 0.01;
        assert!(manifest
            .validate()
            .expect_err("proxy rate drift must fail")
            .contains("proxy rates drifted"));

        let mut manifest = pricing();
        let proxy = manifest
            .models
            .iter_mut()
            .find(|model| model.model_id == "codex-auto-review")
            .expect("proxy row");
        proxy.source_url = "https://developers.openai.com/api/docs/models/gpt-5.6-sol".to_string();
        assert!(manifest
            .validate()
            .expect_err("proxy source drift must fail")
            .contains("proxy rates drifted"));
    }

    #[test]
    fn prices_full_request_long_context_and_cache_writes() {
        let pricing = pricing();
        let sol = pricing.rate("gpt-5.6-sol").expect("Sol price");
        let high = price_message(
            sol,
            &TokenBreakdown {
                input: 200_000,
                cache_read: 72_001,
                cache_write: 1,
                output: 1_000,
                reasoning: 100,
            },
        )
        .expect("priced long request");
        let expected =
            (200_000.0 * 8.0 + 72_001.0 * 0.8 + 1.0 * 10.0 + 1_100.0 * 30.0) / TOKENS_PER_MILLION;
        assert!((high - expected).abs() < 1e-12);

        let short = price_message(
            sol,
            &TokenBreakdown {
                input: 200_000,
                cache_read: 71_999,
                cache_write: 1,
                output: 1_000,
                reasoning: 100,
            },
        )
        .expect("priced short request");
        let expected =
            (200_000.0 * 4.0 + 71_999.0 * 0.4 + 1.0 * 5.0 + 1_100.0 * 20.0) / TOKENS_PER_MILLION;
        assert!((short - expected).abs() < 1e-12);
    }

    #[test]
    fn fails_closed_when_cache_write_rate_is_not_published() {
        let pricing = pricing();
        let model = pricing.rate("gpt-5.4").expect("GPT-5.4 price");
        let error = price_message(
            model,
            &TokenBreakdown {
                cache_write: 1,
                ..Default::default()
            },
        )
        .expect_err("unknown cache-write rate must fail");
        assert!(error.contains("publishes no cache-write rate"));
    }

    #[test]
    fn midnight_end_excludes_that_day_and_marks_every_returned_day_complete() {
        let requested = RequestedRange::parse(
            "2026-08-01T00:00:00.000Z".to_string(),
            "2026-08-04T00:00:00.000Z".to_string(),
        )
        .expect("valid closed-day range");
        let ledger = ledger_from_messages(&[], &pricing(), &measurement(), &requested)
            .expect("closed-day ledger");
        assert_eq!(
            ledger
                .days
                .iter()
                .map(|day| day.date.as_str())
                .collect::<Vec<_>>(),
            vec!["2026-08-01", "2026-08-02", "2026-08-03"]
        );
        assert!(ledger.days.iter().all(|day| day.complete));
    }

    struct TempFixture {
        root: PathBuf,
    }

    impl TempFixture {
        fn new() -> Self {
            let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let root = env::temp_dir().join(format!(
                "aicharts-gpt-subsidy-ledger-{}-{sequence}",
                std::process::id()
            ));
            fs::create_dir_all(&root).expect("create isolated fixture home");
            Self { root }
        }
    }

    impl Drop for TempFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    struct EnvRestore {
        key: &'static str,
        previous: Option<OsString>,
    }

    impl EnvRestore {
        fn set_path(key: &'static str, value: &Path) -> Self {
            let previous = env::var_os(key);
            env::set_var(key, value);
            Self { key, previous }
        }
    }

    impl Drop for EnvRestore {
        fn drop(&mut self) {
            if let Some(previous) = self.previous.take() {
                env::set_var(self.key, previous);
            } else {
                env::remove_var(self.key);
            }
        }
    }

    fn write_parse_path_fixture(home: &Path) {
        let sessions = home.join(".codex/sessions/2026/08/01");
        let archived = home.join(".codex/archived_sessions");
        fs::create_dir_all(&sessions).expect("sessions fixture directory");
        fs::create_dir_all(&archived).expect("archive fixture directory");
        let parent = concat!(
            r#"{"timestamp":"2026-08-01T03:04:05Z","type":"session_meta","payload":{"id":"11111111-1111-7111-8111-111111111111","source":"vscode","thread_source":"user","model_provider":"openai","cwd":"/repo"}}"#,
            "\n",
            r#"{"timestamp":"2026-08-01T03:04:06Z","type":"turn_context","payload":{"turn_id":"11111111-3333-7333-8333-333333333333","model":"gpt-5.6-sol","cwd":"/repo"}}"#,
            "\n",
            r#"{"timestamp":"2026-08-01T03:04:07Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":400,"output_tokens":100,"total_tokens":1100},"last_token_usage":{"input_tokens":1000,"cached_input_tokens":400,"output_tokens":100,"total_tokens":1100}}}}"#,
            "\n",
            r#"{"timestamp":"2026-08-01T03:04:08Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1200,"cached_input_tokens":450,"output_tokens":120,"total_tokens":1320},"last_token_usage":{"input_tokens":200,"cached_input_tokens":50,"output_tokens":20,"total_tokens":220}}}}"#,
            "\n"
        );
        let parent_name = "rollout-2026-08-01T03-04-05-11111111-1111-7111-8111-111111111111.jsonl";
        fs::write(sessions.join(parent_name), parent).expect("active parent fixture");
        fs::write(archived.join(parent_name), parent).expect("duplicate archived parent fixture");

        let child = concat!(
            r#"{"timestamp":"2026-08-01T03:10:00Z","type":"session_meta","payload":{"id":"22222222-2222-7222-8222-222222222222","forked_from_id":"11111111-1111-7111-8111-111111111111","source":{"subagent":{"thread_spawn":{"parent_thread_id":"11111111-1111-7111-8111-111111111111","depth":1}}},"model_provider":"openai","cwd":"/repo"}}"#,
            "\n",
            r#"{"timestamp":"2026-08-01T03:10:00Z","type":"session_meta","payload":{"id":"11111111-1111-7111-8111-111111111111","source":"vscode","thread_source":"user","model_provider":"openai","cwd":"/repo"}}"#,
            "\n",
            r#"{"timestamp":"2026-08-01T03:10:00Z","type":"turn_context","payload":{"turn_id":"11111111-3333-7333-8333-333333333333","model":"gpt-5.6-sol","cwd":"/repo"}}"#,
            "\n",
            r#"{"timestamp":"2026-08-01T03:10:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":400,"output_tokens":100,"total_tokens":1100},"last_token_usage":{"input_tokens":1000,"cached_input_tokens":400,"output_tokens":100,"total_tokens":1100}}}}"#,
            "\n",
            r#"{"timestamp":"2026-08-01T03:10:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1200,"cached_input_tokens":450,"output_tokens":120,"total_tokens":1320},"last_token_usage":{"input_tokens":200,"cached_input_tokens":50,"output_tokens":20,"total_tokens":220}}}}"#,
            "\n",
            r#"{"timestamp":"2026-08-01T03:10:30Z","type":"turn_context","payload":{"turn_id":"22222222-4444-7444-8444-444444444444","model":"gpt-5.6-sol","cwd":"/repo"}}"#,
            "\n",
            r#"{"timestamp":"2026-08-01T03:10:53Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1500,"cached_input_tokens":500,"output_tokens":150,"total_tokens":1650},"last_token_usage":{"input_tokens":300,"cached_input_tokens":50,"output_tokens":30,"total_tokens":330}}}}"#,
            "\n"
        );
        fs::write(
            sessions.join("rollout-2026-08-01T03-10-00-22222222-2222-7222-8222-222222222222.jsonl"),
            child,
        )
        .expect("child fixture");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn actual_parse_path_deduplicates_parent_child_replay_and_archive_copy() {
        let _lock = PARSER_ENV_LOCK.lock().expect("parser environment lock");
        let fixture = TempFixture::new();
        let cache = TempFixture::new();
        write_parse_path_fixture(&fixture.root);
        let _cache_env = EnvRestore::set_path("TOKSCALE_CONFIG_DIR", &cache.root);

        for pass in 0..2 {
            let messages = parse_codex_messages(&fixture.root)
                .await
                .expect("actual Tokscale parse path");
            assert_eq!(messages.len(), 3, "parse pass {pass}");
            assert_eq!(
                messages
                    .iter()
                    .map(|message| message.tokens.input)
                    .sum::<i64>(),
                1_000,
                "parse pass {pass}"
            );
            assert_eq!(
                messages
                    .iter()
                    .map(|message| message.tokens.cache_read)
                    .sum::<i64>(),
                500,
                "parse pass {pass}"
            );
            assert_eq!(
                messages
                    .iter()
                    .map(|message| message.tokens.output)
                    .sum::<i64>(),
                150,
                "parse pass {pass}"
            );
            let ledger = ledger_from_messages(
                &messages,
                &pricing(),
                &measurement(),
                &RequestedRange::parse(
                    "2026-08-01T00:00:00Z".to_string(),
                    "2026-08-02T00:00:00Z".to_string(),
                )
                .expect("fixture range"),
            )
            .expect("fixture ledger");
            assert_eq!(ledger.days[0].tokens.total, 1_650, "parse pass {pass}");
        }
    }
}
