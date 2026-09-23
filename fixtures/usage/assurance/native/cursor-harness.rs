// This harness receives unchanged function bodies from the selected repository
// source. It simulates a complete provider range; it never makes a request.
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

// ASSURANCE_PRODUCTION_HELPERS

fn range_start(cache_latest_ms: Option<u64>, until_ms: u64, billing_start_ms: u64) -> u64 {
    // ASSURANCE_PRODUCTION_RANGE
    since_ms
}

fn main() {
    let path = std::env::args().nth(1).expect("synthetic fixture path");
    let input: Value = serde_json::from_slice(&std::fs::read(path).expect("fixture read"))
        .expect("fixture JSON");
    let previous = serde_json::to_vec(&input["previous"]).expect("fixture cache");
    let until = input["untilMs"].as_u64().expect("until");
    let since = range_start(
        latest_event_ms(&previous),
        until,
        input["billingStartMs"].as_u64().expect("billing start"),
    );
    let original = input["previous"]["usageEventsDisplay"].as_array().expect("events");
    let fresh: Vec<Value> = original
        .iter()
        .filter(|event| {
            let timestamp = event["timestamp"].as_u64().expect("timestamp");
            timestamp >= since && timestamp <= until
        })
        .cloned()
        .collect();
    let fetched = fresh.len();
    let result = merge(Some(&previous), fresh).expect("merge");
    let merged: Value = serde_json::from_slice(&result).expect("merged JSON");
    let events = merged["usageEventsDisplay"].as_array().expect("merged events");
    println!("{}", json!({
        "originalEvents": original.len(),
        "fetchedEvents": fetched,
        "mergedEvents": events.len(),
        "sinceMs": since,
        "untilMs": until,
        "earliestEventRetained": events.iter().any(|event| {
            event["timestamp"] == input["earliestEventMs"]
        }),
        "mergedTimestamps": events.iter().map(|event| event["timestamp"].clone()).collect::<Vec<_>>()
    }));
}
