//! Enrolled-device account totals read. The same lifetime numbers the signed-in
//! dashboard shows, authenticated by this device's retained upload credential —
//! no browser session. Read-only: it opens custody and the fixed transport but
//! never the ledger, sources, or enrollment state.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const MAX_TIME: u64 = 8_640_000_000_000_000;
const MAX_DAY: u64 = 99_999_999;
const MAX_RECORDS: u64 = 10_000_000;
const MAX_DAYS: u64 = 100_000_000;
const MAX_DEVICES: usize = 128;
const MAX_CLIENTS: usize = 64;
const HELP: &str = "AI Charts stats totals — enrolled account lifetime read\n\n  aicharts stats-totals --state-dir DIR [--json]\n\nReads the enrolled account's committed lifetime token totals from the fixed\nAI Charts service, summed across every enrolled device and client. Uses this\ninstallation's custody-verified enrollment and its retained upload credential.\nIt never opens the ledger, scans sources, uploads, or advances enrollment.\n--json prints the exact validated wire projection.\n";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TotalsRequest<'a> {
    schema_version: u8,
    account_id: &'a str,
    device_id: &'a str,
    generation: &'a str,
}

#[derive(Clone, Deserialize, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct TotalsTokens {
    input: String,
    cache_read: String,
    cache_write: String,
    output: String,
    reasoning: String,
}
impl TotalsTokens {
    fn fields(&self) -> [&str; 5] {
        [
            &self.input,
            &self.cache_read,
            &self.cache_write,
            &self.output,
            &self.reasoning,
        ]
    }
    fn total(&self) -> Result<u128, &'static str> {
        self.fields().iter().try_fold(0u128, |sum, field| {
            sum.checked_add(decimal(field)?).ok_or("stats_sync_limit")
        })
    }
}

/// One totals cell: flat wire fields shared by the account total, each client
/// row, each device row and each device's client rows.
#[derive(Clone, Copy, Debug)]
struct TotalsCell<'a> {
    records: u64,
    days: u64,
    first_utc_day: Option<u64>,
    last_utc_day: Option<u64>,
    tokens: &'a TotalsTokens,
}
impl TotalsCell<'_> {
    fn validate(&self) -> Result<(), &'static str> {
        if self.records > MAX_RECORDS
            || self.days > MAX_DAYS
            || self.first_utc_day.is_none() != self.last_utc_day.is_none()
            || (self.days == 0) != self.first_utc_day.is_none()
        {
            return Err("stats_sync_invalid_response");
        }
        if let (Some(first), Some(last)) = (self.first_utc_day, self.last_utc_day) {
            if first > MAX_DAY || last > MAX_DAY || first > last || last - first + 1 < self.days {
                return Err("stats_sync_invalid_response");
            }
        }
        Ok(())
    }
}
#[derive(Clone, Deserialize, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TotalsClient {
    client: String,
    basis: String,
    records: u64,
    days: u64,
    first_utc_day: Option<u64>,
    last_utc_day: Option<u64>,
    tokens: TotalsTokens,
}
impl TotalsClient {
    fn cell(&self) -> TotalsCell<'_> {
        TotalsCell {
            records: self.records,
            days: self.days,
            first_utc_day: self.first_utc_day,
            last_utc_day: self.last_utc_day,
            tokens: &self.tokens,
        }
    }
    fn validate(&self, previous: &mut String) -> Result<(), &'static str> {
        if !aicharts_import::clients().contains(&self.client.as_str())
            || !(self.basis == "snapshots" || self.basis == "legacy" || self.basis == "mixed")
            || self.client.as_str() <= previous.as_str()
        {
            return Err("stats_sync_invalid_response");
        }
        *previous = self.client.clone();
        self.cell().validate()
    }
}

#[derive(Clone, Deserialize, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TotalsDevice {
    device_id: String,
    enrolled_at_ms: u64,
    revoked_at_ms: Option<u64>,
    clients: Vec<TotalsClient>,
    records: u64,
    days: u64,
    first_utc_day: Option<u64>,
    last_utc_day: Option<u64>,
    tokens: TotalsTokens,
}
impl TotalsDevice {
    fn cell(&self) -> TotalsCell<'_> {
        TotalsCell {
            records: self.records,
            days: self.days,
            first_utc_day: self.first_utc_day,
            last_utc_day: self.last_utc_day,
            tokens: &self.tokens,
        }
    }
    fn validate(&self) -> Result<(), &'static str> {
        if !super::identity(&self.device_id)
            || self.enrolled_at_ms > MAX_TIME
            || self.revoked_at_ms.is_some_and(|ms| ms > MAX_TIME)
            || self.clients.len() > MAX_CLIENTS
        {
            return Err("stats_sync_invalid_response");
        }
        let mut previous = String::new();
        for client in &self.clients {
            client.validate(&mut previous)?;
        }
        self.cell().validate()
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Totals {
    schema_version: u8,
    generated_at_ms: u64,
    revision: u64,
    updated_at_ms: u64,
    legacy_revision: u64,
    legacy_verified_revision: u64,
    legacy_complete: bool,
    total: TotalsTotal,
    clients: Vec<TotalsClient>,
    devices: Vec<TotalsDevice>,
}
#[derive(Clone, Deserialize, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TotalsTotal {
    records: u64,
    days: u64,
    first_utc_day: Option<u64>,
    last_utc_day: Option<u64>,
    tokens: TotalsTokens,
}
impl TotalsTotal {
    fn cell(&self) -> TotalsCell<'_> {
        TotalsCell {
            records: self.records,
            days: self.days,
            first_utc_day: self.first_utc_day,
            last_utc_day: self.last_utc_day,
            tokens: &self.tokens,
        }
    }
}
impl Totals {
    /// Mirror the wire contract's invariants: the transport parses exact fields,
    /// then this check pins ordering, bounds and cell consistency before any
    /// value is rendered or compared.
    fn validate(&self) -> Result<(), &'static str> {
        if self.schema_version != 2
            || self.generated_at_ms > MAX_TIME
            || self.revision > 1_000_000
            || self.updated_at_ms > MAX_TIME
            || self.legacy_revision > 4_096
            || self.legacy_verified_revision > self.legacy_revision
            || self.legacy_complete != (self.legacy_verified_revision == self.legacy_revision)
            || self.clients.len() > MAX_CLIENTS
            || self.devices.len() > MAX_DEVICES
        {
            return Err("stats_sync_invalid_response");
        }
        let mut seen = std::collections::HashSet::with_capacity(self.devices.len());
        for device in &self.devices {
            if !seen.insert(device.device_id.as_str()) {
                return Err("stats_sync_invalid_response");
            }
            device.validate()?;
        }
        let mut previous = String::new();
        for client in &self.clients {
            client.validate(&mut previous)?;
        }
        self.total.cell().validate()?;
        self.total.tokens.total().map(|_| ())
    }
}

fn decimal(value: &str) -> Result<u128, &'static str> {
    if value.is_empty()
        || value.len() > 24
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return Err("stats_sync_invalid_response");
    }
    value.parse().map_err(|_| "stats_sync_invalid_response")
}

struct Options {
    directory: PathBuf,
    json: bool,
}
fn options(args: &[String]) -> Result<Options, &'static str> {
    if args.first().map(String::as_str) != Some("stats-totals") {
        return Err("invalid_command");
    }
    let (mut directory, mut json) = (None, false);
    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--json" if !json => json = true,
            "--state-dir" if directory.is_none() => {
                index += 1;
                let value = args
                    .get(index)
                    .filter(|value| !value.is_empty() && !value.starts_with("--"))
                    .ok_or("missing_option_value")?;
                let path = PathBuf::from(value);
                if !path.is_absolute() {
                    return Err("state_directory_absolute_required");
                }
                directory = Some(path);
            }
            _ => return Err("invalid_option"),
        }
        index += 1;
    }
    Ok(Options {
        directory: directory.ok_or("state_directory_required")?,
        json,
    })
}

fn day_text(day: u64) -> Result<String, &'static str> {
    let format = time::format_description::parse_borrowed::<2>("[year]-[month]-[day]")
        .map_err(|_| "stats_sync_state_invalid")?;
    let stamp = i64::try_from(day.checked_mul(86_400).ok_or("stats_sync_limit")?)
        .map_err(|_| "stats_sync_limit")?;
    time::OffsetDateTime::from_unix_timestamp(stamp)
        .map_err(|_| "stats_sync_invalid_response")?
        .date()
        .format(&format)
        .map_err(|_| "stats_sync_state_invalid")
}

fn cell_text(cell: TotalsCell<'_>) -> Result<String, &'static str> {
    let span = match (cell.first_utc_day, cell.last_utc_day) {
        (Some(first), Some(last)) => format!(", {} through {}", day_text(first)?, day_text(last)?),
        _ => String::new(),
    };
    Ok(format!(
        "{} tokens, {} records, {} days{}",
        cell.tokens.total()?,
        cell.records,
        cell.days,
        span
    ))
}

fn render(totals: &Totals, json: bool) -> Result<String, &'static str> {
    if json {
        return serde_json::to_string_pretty(totals).map_err(|_| "stats_json_invalid");
    }
    let mut output = format!(
        "AI Charts account totals — committed server history\nRevision: {}\nTotal: {}\n",
        totals.revision,
        cell_text(totals.total.cell())?,
    );
    for client in &totals.clients {
        output.push_str(&format!(
            "  {:<12} {} [{}]\n",
            client.client,
            cell_text(client.cell())?,
            client.basis
        ));
    }
    for device in &totals.devices {
        let revoked = if device.revoked_at_ms.is_some() {
            " (revoked)"
        } else {
            ""
        };
        output.push_str(&format!(
            "Device {}{}: {}\n",
            device.device_id,
            revoked,
            cell_text(device.cell())?
        ));
    }
    Ok(output)
}

#[cfg(target_os = "macos")]
pub(crate) fn run(args: &[String]) -> Result<String, &'static str> {
    if args.len() == 2 && args[1] == "--help" {
        return Ok(HELP.to_owned());
    }
    let options = options(args)?;
    let enrolled = crate::enrollment::enrolled(&options.directory)?;
    let account_id = format!("acct_{}", super::hex(&enrolled.account_id));
    let device_id = super::hex(&enrolled.device_id);
    let generation = super::hex(&enrolled.recovery_generation);
    let request = TotalsRequest {
        schema_version: 2,
        account_id: &account_id,
        device_id: &device_id,
        generation: &generation,
    };
    let mut transport = enrolled
        .pairing
        .with_pairing_secrets(|_, secret| super::https::Transport::new(secret))
        .map_err(|_| "attempt_custody")??;
    let totals = transport.totals(&request)?;
    totals.validate()?;
    render(&totals, options.json)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn run(args: &[String]) -> Result<String, &'static str> {
    if args.len() == 2 && args[1] == "--help" {
        return Ok(HELP.to_owned());
    }
    options(args)?;
    Err("stats_sync_requires_qualified_macos_custody")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn arguments(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }
    fn totals() -> serde_json::Value {
        serde_json::json!({
            "schemaVersion": 2, "generatedAtMs": 1_772_496_000_000u64, "revision": 3, "updatedAtMs": 1_772_496_000_000u64,
            "legacyRevision": 0, "legacyVerifiedRevision": 0, "legacyComplete": true,
            "total": {"records": 4, "days": 2, "firstUtcDay": 20_400, "lastUtcDay": 20_500,
                "tokens": {"input": "14", "cacheRead": "4", "cacheWrite": "10", "output": "18", "reasoning": "6"}},
            "clients": [{"client": "codex", "basis": "snapshots", "records": 2, "days": 1,
                "firstUtcDay": 20_500, "lastUtcDay": 20_500,
                "tokens": {"input": "7", "cacheRead": "2", "cacheWrite": "5", "output": "9", "reasoning": "3"}}],
            "devices": [{"deviceId": "ab".repeat(32), "enrolledAtMs": 1_700_000_000_000u64, "revokedAtMs": null,
                "records": 2, "days": 1, "firstUtcDay": 20_500, "lastUtcDay": 20_500,
                "tokens": {"input": "7", "cacheRead": "2", "cacheWrite": "5", "output": "9", "reasoning": "3"},
                "clients": [{"client": "codex", "basis": "snapshots", "records": 2, "days": 1,
                    "firstUtcDay": 20_500, "lastUtcDay": 20_500,
                    "tokens": {"input": "7", "cacheRead": "2", "cacheWrite": "5", "output": "9", "reasoning": "3"}}]}],
        })
    }
    #[test]
    fn totals_wire_shape_validates_and_renders() {
        let parsed: Totals = serde_json::from_value(totals()).expect("wire totals");
        parsed.validate().expect("valid totals");
        let text = render(&parsed, false).expect("render totals");
        assert!(text.contains("Revision: 3"));
        assert!(text.contains("52 tokens"));
        assert!(text.contains("codex"));
        assert!(text.contains(&"ab".repeat(32)));
        let encoded = render(&parsed, true).expect("render json");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&encoded).unwrap(),
            totals()
        );
    }
    #[test]
    fn totals_refuses_unsorted_clients_duplicate_devices_and_bad_cells() {
        let mut value = totals();
        value["clients"] = serde_json::json!([
            {"client": "devin-cli", "basis": "snapshots", "records": 1, "days": 1, "firstUtcDay": 20_500,
                "lastUtcDay": 20_500, "tokens": {"input": "1", "cacheRead": "0", "cacheWrite": "0", "output": "0", "reasoning": "0"}},
            {"client": "codex", "basis": "snapshots", "records": 1, "days": 1, "firstUtcDay": 20_500,
                "lastUtcDay": 20_500, "tokens": {"input": "1", "cacheRead": "0", "cacheWrite": "0", "output": "0", "reasoning": "0"}},
        ]);
        let parsed: Totals = serde_json::from_value(value).expect("wire totals");
        assert_eq!(parsed.validate().err(), Some("stats_sync_invalid_response"));

        let mut value = totals();
        let device = value["devices"][0].clone();
        value["devices"].as_array_mut().unwrap().push(device);
        let parsed: Totals = serde_json::from_value(value).expect("wire totals");
        assert_eq!(parsed.validate().err(), Some("stats_sync_invalid_response"));

        let mut value = totals();
        value["total"]["days"] = serde_json::json!(200); // span 20400..20500 is 101 days
        let parsed: Totals = serde_json::from_value(value).expect("wire totals");
        assert_eq!(parsed.validate().err(), Some("stats_sync_invalid_response"));

        let mut value = totals();
        value["legacyComplete"] = serde_json::json!(false);
        let parsed: Totals = serde_json::from_value(value).expect("wire totals");
        assert_eq!(parsed.validate().err(), Some("stats_sync_invalid_response"));

        let mut value = totals();
        value["total"]["tokens"]["input"] = serde_json::json!("01");
        let parsed: Totals = serde_json::from_value(value).expect("wire totals");
        assert_eq!(parsed.validate().err(), Some("stats_sync_invalid_response"));
    }
    #[test]
    fn totals_request_encodes_exact_identity_fields() {
        let account = format!("acct_{}", "1".repeat(32));
        let device = "2".repeat(64);
        let generation = "3".repeat(64);
        let request = TotalsRequest {
            schema_version: 2,
            account_id: &account,
            device_id: &device,
            generation: &generation,
        };
        let bytes = super::super::encoded(&request).expect("encoded request");
        assert!(bytes.len() <= 512);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
            serde_json::json!({
                "schemaVersion": 2,
                "accountId": format!("acct_{}", "1".repeat(32)),
                "deviceId": "2".repeat(64),
                "generation": "3".repeat(64),
            })
        );
    }
    #[test]
    fn options_require_the_enrollment_directory_and_refuse_effect_flags() {
        for values in [
            vec!["stats-totals"],
            vec!["stats-totals", "--state-dir"],
            vec!["stats-totals", "--state-dir", "relative"],
            vec![
                "stats-totals",
                "--state-dir",
                "/private/example",
                "--json",
                "--json",
            ],
            vec![
                "stats-totals",
                "--state-dir",
                "/private/example",
                "--key-file",
                "/private/key",
            ],
            vec![
                "stats-totals",
                "--state-dir",
                "/private/example",
                "--client",
                "codex",
            ],
            vec![
                "stats-totals",
                "--state-dir",
                "/private/example",
                "--dry-run",
            ],
            vec![
                "stats-totals",
                "--state-dir",
                "/private/example",
                "--state-dir",
                "/private/other",
            ],
        ] {
            assert!(options(&arguments(&values)).is_err(), "{values:?}");
        }
        let parsed = options(&arguments(&[
            "stats-totals",
            "--state-dir",
            "/private/example",
            "--json",
        ]))
        .expect("explicit totals options");
        assert!(parsed.json);
    }
    #[cfg(not(target_os = "macos"))]
    #[test]
    fn unsupported_custody_refuses_before_any_transport() {
        assert_eq!(
            run(&arguments(&[
                "stats-totals",
                "--state-dir",
                "/path/never/opened"
            ]))
            .err(),
            Some("stats_sync_requires_qualified_macos_custody")
        );
    }
}
