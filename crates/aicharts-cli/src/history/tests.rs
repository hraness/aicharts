use super::*;
use crate::stats::Tokens;
use std::cell::Cell;

const TODAY: u64 = 20_730;
const NOW: u64 = TODAY * DAY_MS + 3_600_000;

fn row(day: u64, client: &str, model: &str, records: u64, input: u64) -> Row {
    let provider = if client == "claude" {
        "anthropic"
    } else {
        "openai"
    };
    Row {
        utc_day: day,
        client: client.to_owned(),
        provider: Some(provider.to_owned()),
        model: Some(model.to_owned()),
        tokens: Tokens {
            input: input.to_string(),
            cache_read: "0".to_owned(),
            cache_write: "0".to_owned(),
            output: (input / 10).to_string(),
            reasoning: "0".to_owned(),
        },
        records,
        reported_cost_microusd: None,
        reported_cost_records: 0,
        estimated_cost_microusd: None,
        estimated_cost_records: 0,
        duration_ms: None,
        timed_records: 0,
        timed_tokens: "0".to_owned(),
        token_basis: "reported".to_owned(),
        breakdown_coverage: "partial".to_owned(),
    }
}

/// A valid fresh scan of `clients` over the window holding `rows`.
fn scan(
    first: u64,
    count: u64,
    clients: &[&str],
    mut rows: Vec<Row>,
    generated_at_ms: u64,
) -> Report {
    rows.sort_by_key(key);
    let mut sources: Vec<Source> = clients
        .iter()
        .map(|client| {
            let records: u64 = rows
                .iter()
                .filter(|r| r.client == *client)
                .map(|r| r.records)
                .sum();
            Source {
                client: (*client).to_owned(),
                status: if records > 0 { "observed" } else { "not_found" }.to_owned(),
                token_basis: if records > 0 {
                    "reported"
                } else {
                    "unavailable"
                }
                .to_owned(),
                records,
                warnings: 0,
                latest_at_ms: (records > 0).then_some(generated_at_ms - 1),
            }
        })
        .collect();
    sources.sort_by(|a, b| a.client.cmp(&b.client));
    let report = Report {
        schema_version: 2,
        profile: "client-stats-v2".to_owned(),
        registry_revision: 1,
        first_utc_day: first,
        day_count: count,
        generated_at_ms,
        revision: 0,
        updated_at_ms: None,
        sources,
        rows,
    };
    stats::validate_report(&report).expect("synthetic scan is valid");
    report
}

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("aicharts-history-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

/// Deterministic xorshift so the merge laws run over many shapes without a
/// property-testing dependency.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

fn random_scan(rng: &mut Rng) -> Report {
    let models = [
        ("codex", "gpt-5"),
        ("codex", "gpt-5-codex"),
        ("claude", "claude-sonnet-4-5"),
        ("claude", "claude-opus-4-5"),
    ];
    let mut rows = BTreeMap::new();
    for _ in 0..rng.below(12) {
        let (client, model) = models[rng.below(4) as usize];
        let day = TODAY - rng.below(10);
        let records = 1 + rng.below(20);
        let r = row(
            day,
            client,
            model,
            records,
            records * (1 + rng.below(5_000)),
        );
        rows.insert(key(&r), r);
    }
    scan(
        TODAY - 9,
        10,
        &["claude", "codex"],
        rows.into_values().collect(),
        NOW,
    )
}

#[test]
fn merging_never_lowers_a_retained_row_and_keeps_rows_the_scan_lost() {
    let mut rng = Rng(0x5eed_1234_abcd_0001);
    for _ in 0..300 {
        let mut store = Store::empty(NOW);
        let mut best: BTreeMap<Key, (u64, u128)> = BTreeMap::new();
        for _ in 0..1 + rng.below(4) {
            let fresh = random_scan(&mut rng);
            let (next, counts) = merge(&store, &fresh, NOW).unwrap();
            validate_store(&next, NOW).unwrap();
            assert_eq!(
                counts.added + counts.updated + counts.kept + counts.unchanged,
                fresh.rows.len() as u64
            );
            for r in &fresh.rows {
                let measured = (r.records, stats::row_token_total(&r.tokens).unwrap());
                let entry = best.entry(key(r)).or_insert(measured);
                *entry = (*entry).max(measured);
            }
            store = next;
        }
        assert_eq!(store.rows.len(), best.len());
        for r in &store.rows {
            assert_eq!(
                best[&key(r)],
                (r.records, stats::row_token_total(&r.tokens).unwrap()),
                "every row holds the largest measurement any scan saw"
            );
        }
    }
}

#[test]
fn merging_the_same_scan_twice_changes_nothing() {
    let mut rng = Rng(0x0dd_ba11);
    for _ in 0..200 {
        let fresh = random_scan(&mut rng);
        let (once, _) = merge(&Store::empty(NOW), &fresh, NOW).unwrap();
        let (twice, counts) = merge(&once, &fresh, NOW + 1).unwrap();
        assert_eq!(once, twice, "an identical scan is not a new revision");
        assert_eq!(counts.added + counts.updated + counts.kept, 0);
    }
}

#[test]
fn a_smaller_scan_after_files_are_deleted_keeps_the_record() {
    let full = scan(
        TODAY - 1,
        2,
        &["codex"],
        vec![row(TODAY - 1, "codex", "gpt-5", 10, 1_000)],
        NOW,
    );
    let (store, _) = merge(&Store::empty(NOW), &full, NOW).unwrap();
    let rotated = scan(
        TODAY - 1,
        2,
        &["codex"],
        vec![row(TODAY - 1, "codex", "gpt-5", 4, 400)],
        NOW,
    );
    let (after, counts) = merge(&store, &rotated, NOW).unwrap();
    assert_eq!(counts.kept, 1);
    assert_eq!(after.rows, store.rows);
    let grown = scan(
        TODAY - 1,
        2,
        &["codex"],
        vec![row(TODAY - 1, "codex", "gpt-5", 12, 1_300)],
        NOW,
    );
    let (after, counts) = merge(&after, &grown, NOW + 5).unwrap();
    assert_eq!(counts.updated, 1);
    assert_eq!(after.rows[0].records, 12);
    assert_eq!(after.revision, 2);
    assert_eq!(after.updated_at_ms, NOW + 5);
}

#[test]
fn reports_cover_one_window_and_name_agents_with_nothing_in_it() {
    let fresh = scan(
        TODAY - 40,
        41,
        &["claude", "codex"],
        vec![
            row(TODAY - 40, "claude", "claude-sonnet-4-5", 3, 300),
            row(TODAY, "codex", "gpt-5", 2, 200),
        ],
        NOW,
    );
    let (store, _) = merge(&Store::empty(NOW), &fresh, NOW).unwrap();
    let recent = report(&store, TODAY - 6, 7, None, NOW).unwrap();
    assert_eq!(recent.rows.len(), 1);
    let statuses: Vec<(&str, &str)> = recent
        .sources
        .iter()
        .map(|source| (source.client.as_str(), source.status.as_str()))
        .collect();
    assert_eq!(statuses, vec![("claude", "empty"), ("codex", "observed")]);
    let mut gemini = BTreeSet::new();
    gemini.insert("gemini".to_owned());
    let missing = report(&store, TODAY - 6, 7, Some(&gemini), NOW).unwrap();
    assert_eq!(missing.sources[0].status, "not_found");
    assert!(missing.rows.is_empty());
    assert_eq!(recent.revision, store.revision);
    assert_eq!(recent.updated_at_ms, Some(store.updated_at_ms));
}

#[test]
fn an_empty_record_reports_nothing_without_failing() {
    let empty = report(&Store::empty(NOW), TODAY - 29, 30, None, NOW).unwrap();
    assert!(empty.sources.is_empty() && empty.rows.is_empty());
    assert_eq!((empty.revision, empty.updated_at_ms), (0, None));
}

#[test]
fn damaged_records_are_refused_before_any_use() {
    let fresh = scan(
        TODAY - 1,
        2,
        &["claude", "codex"],
        vec![
            row(TODAY - 1, "claude", "claude-opus-4-5", 1, 10),
            row(TODAY, "codex", "gpt-5", 1, 10),
        ],
        NOW,
    );
    let (good, _) = merge(&Store::empty(NOW), &fresh, NOW).unwrap();
    validate_store(&good, NOW).unwrap();
    let mut unsorted = good.clone();
    unsorted.rows.reverse();
    let mut unknown = good.clone();
    unknown.clients[0].client = "not-a-client".to_owned();
    let mut duplicate = good.clone();
    duplicate.rows.push(duplicate.rows[1].clone());
    let mut future = good.clone();
    future.rows[1].utc_day = TODAY + 5;
    let mut unrevised = good.clone();
    unrevised.revision = 0;
    let mut overcounted = good.clone();
    overcounted.rows[0].tokens.input = "99999999999".to_owned();
    let mut orphan = good.clone();
    orphan.clients.remove(0);
    for (name, damaged) in [
        ("unsorted", unsorted),
        ("unknown client", unknown),
        ("duplicate", duplicate),
        ("future day", future),
        ("unrevised", unrevised),
        ("implausible tokens", overcounted),
        ("row without client", orphan),
    ] {
        assert_eq!(
            validate_store(&damaged, NOW),
            Err("history_store_invalid"),
            "{name}"
        );
    }
}

#[test]
fn record_spanning_more_than_a_year_validates_window_by_window() {
    let mut store = Store::empty(NOW);
    for offset in [0, 200, 400, 700] {
        let day = TODAY - offset;
        let fresh = scan(
            day,
            1,
            &["codex"],
            vec![row(day, "codex", "gpt-5", 1, 100)],
            NOW,
        );
        store = merge(&store, &fresh, NOW).unwrap().0;
    }
    validate_store(&store, NOW).unwrap();
    assert_eq!(store.rows.len(), 4);
    assert_eq!(store.first_day(), Some(TODAY - 700));
}

#[test]
fn windows_end_today_and_span_at_most_a_year() {
    assert_eq!(window(None, None, None, NOW), Ok((TODAY - 29, 30)));
    assert_eq!(window(Some(7), None, None, NOW), Ok((TODAY - 6, 7)));
    assert_eq!(
        window(Some(367), None, None, NOW),
        Err("stats_range_invalid")
    );
    assert_eq!(
        window(Some(7), Some("2026-09-01"), None, NOW),
        Err("invalid_option")
    );
    let first = stats::date_day("2026-09-01").unwrap();
    let last = stats::date_day("2026-09-30").unwrap();
    assert_eq!(
        window(None, Some("2026-09-01"), Some("2026-09-30"), last * DAY_MS),
        Ok((first, 30))
    );
    assert_eq!(
        window(None, None, Some("2099-01-01"), NOW),
        Err("stats_range_invalid")
    );
    assert_eq!(collection_window(None, None, NOW), Ok((TODAY - 365, 366)));
    let fresh = scan(
        TODAY,
        1,
        &["codex"],
        vec![row(TODAY, "codex", "gpt-5", 1, 1)],
        NOW,
    );
    let (store, _) = merge(&Store::empty(NOW), &fresh, NOW).unwrap();
    assert_eq!(
        collection_window(Some(&store), None, NOW),
        Ok((TODAY - 6, 7))
    );
    assert_eq!(
        collection_window(Some(&store), Some(0), NOW),
        Err("invalid_option")
    );
}

#[test]
fn csv_keeps_exact_integers_and_leaves_unknowns_empty() {
    let fresh = scan(
        TODAY,
        1,
        &["codex"],
        vec![row(TODAY, "codex", "gpt-5", 2, 1_000)],
        NOW,
    );
    let text = csv(&fresh).unwrap();
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines[0], CSV_HEADER.trim_end());
    assert_eq!(
        lines[1],
        format!(
            "{},codex,openai,gpt-5,reported,1000,0,0,100,0,1100,2,,,",
            utc_date(TODAY).unwrap()
        )
    );
    assert_eq!(utc_date(0).unwrap(), "1970-01-01");
    assert_eq!(
        utc_date(stats::date_day("2026-10-04").unwrap()).unwrap(),
        "2026-10-04"
    );
    assert_eq!(csv_field("a,b"), "\"a,b\"");
}

#[cfg(unix)]
#[test]
fn collection_reads_a_year_first_then_a_week_and_keeps_lost_days() {
    use std::os::unix::fs::PermissionsExt;
    let dir = temp("collect");
    let windows = std::cell::RefCell::new(Vec::new());
    let deleted = Cell::new(false);
    let scanner = |options: &stats::Options, now: u64| -> Result<Report, &'static str> {
        assert_eq!(options.clients.len(), 1, "one agent per read");
        let client = options.clients[0].as_str();
        windows
            .borrow_mut()
            .push((options.first_utc_day, options.day_count, client.to_owned()));
        if client == "gemini" {
            // One agent failing never blocks the others.
            return Err("stats_import_incomplete");
        }
        let mut rows = vec![row(TODAY, "codex", "gpt-5", 3, 300)];
        if !deleted.get() {
            rows.push(row(TODAY - 100, "claude", "claude-sonnet-4-5", 5, 500));
        }
        let rows = rows
            .into_iter()
            .filter(|r| {
                r.client == client
                    && r.utc_day >= options.first_utc_day
                    && r.utc_day < options.first_utc_day + options.day_count
            })
            .collect();
        Ok(scan(
            options.first_utc_day,
            options.day_count,
            &[client],
            rows,
            now,
        ))
    };
    let clock = || Ok(NOW);
    let env = Environment {
        dir: dir.join("history"),
        home: PathBuf::from("/synthetic-home"),
        clock: &clock,
        scan: &scanner,
    };
    let first = collect(&env, None).unwrap();
    assert_eq!(first.outcome, "partial", "gemini failed");
    assert_eq!(first.incomplete_clients, 1);
    assert_eq!(first.observed_clients, 2);
    assert_eq!(first.counts.added, 2);
    let clients = aicharts_import::all_clients().len();
    assert_eq!(windows.borrow().len(), clients);
    assert!(windows
        .borrow()
        .iter()
        .all(|(first, count, _)| (*first, *count) == (TODAY - 365, 366)));
    deleted.set(true);
    let second = collect(&env, None).unwrap();
    assert_eq!(windows.borrow()[clients].1, ROUTINE_COLLECTION_DAYS);
    assert_eq!(second.counts.unchanged, 1);
    let store = read_store(&env.dir, NOW).unwrap().unwrap();
    assert_eq!(
        store.rows.len(),
        2,
        "the deleted claude day stays in the record"
    );
    let mode = std::fs::metadata(env.dir.join(STORE_FILE))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
    let dir_mode = std::fs::metadata(&env.dir).unwrap().permissions().mode();
    assert_eq!(dir_mode & 0o777, 0o700);
    let status = read_last_collection(&env.dir).unwrap();
    assert_eq!(status.retained_rows, 2);
    let held = lock(&env.dir).unwrap();
    assert_eq!(collect(&env, None).unwrap_err(), "history_busy");
    drop(held);
    let _ = std::fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn a_damaged_record_is_never_overwritten_by_collection() {
    let dir = temp("damaged");
    let history = dir.join("history");
    std::fs::create_dir_all(&history).unwrap();
    std::fs::write(history.join(STORE_FILE), b"{\"not\":\"a record\"}").unwrap();
    let scanner = |options: &stats::Options, now: u64| -> Result<Report, &'static str> {
        Ok(scan(
            options.first_utc_day,
            options.day_count,
            &["codex"],
            vec![],
            now,
        ))
    };
    let clock = || Ok(NOW);
    let env = Environment {
        dir: history.clone(),
        home: PathBuf::from("/synthetic-home"),
        clock: &clock,
        scan: &scanner,
    };
    assert_eq!(collect(&env, None).unwrap_err(), "history_store_invalid");
    assert_eq!(
        std::fs::read(history.join(STORE_FILE)).unwrap(),
        b"{\"not\":\"a record\"}"
    );
    let status = read_last_collection(&history).unwrap();
    assert_eq!(status.outcome, "failed");
    assert_eq!(status.code.as_deref(), Some("history_store_invalid"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn report_command_reads_only_the_record() {
    let dir = temp("report");
    std::fs::create_dir_all(&dir).unwrap();
    let fresh = scan(
        TODAY - 2,
        3,
        &["codex"],
        vec![row(TODAY - 1, "codex", "gpt-5", 4, 4_000)],
        NOW,
    );
    let (store, _) = merge(&Store::empty(NOW), &fresh, NOW).unwrap();
    std::fs::write(dir.join(STORE_FILE), serde_json::to_vec(&store).unwrap()).unwrap();
    let args = |values: &[&str]| values.iter().map(|v| (*v).to_owned()).collect::<Vec<_>>();
    let json = run_report(&args(&["--days", "7", "--json"]), &dir, NOW).unwrap();
    let parsed: Report = serde_json::from_str(json.trim()).unwrap();
    stats::validate_report(&parsed).unwrap();
    assert_eq!(parsed.rows.len(), 1);
    let csv_text = run_report(&args(&["--days", "7", "--csv"]), &dir, NOW).unwrap();
    assert_eq!(csv_text.lines().count(), 2);
    let text = run_report(&args(&["--days", "7"]), &dir, NOW).unwrap();
    assert!(text.contains("codex: 4,400 tokens · 4 records"));
    assert_eq!(
        run_report(&args(&["--json", "--csv"]), &dir, NOW),
        Err("invalid_option")
    );
    assert_eq!(
        run_report(&args(&["--client", "nope"]), &dir, NOW),
        Err("invalid_option")
    );
    let _ = std::fs::remove_dir_all(&dir);
}
