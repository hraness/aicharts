use super::*;
use serde_json::json;
use std::collections::VecDeque;
const NOW: u64 = 1_800_000_000_000;
struct Fake {
    responses: VecDeque<Result<Vec<u8>>>,
    urls: Vec<String>,
}
impl Transport for Fake {
    fn get(
        &mut self,
        _: &Endpoint,
        _: &Credential,
        url: &str,
        _: Duration,
        _: usize,
    ) -> Result<Vec<u8>> {
        self.urls.push(url.to_owned());
        self.responses
            .pop_front()
            .expect("expected fixture request")
    }
}
fn fake(values: Vec<Value>) -> Fake {
    Fake {
        responses: values
            .into_iter()
            .map(|v| Ok(serde_json::to_vec(&v).unwrap()))
            .collect(),
        urls: Vec::new(),
    }
}
fn endpoint() -> Endpoint {
    Endpoint::new("https://hindsight.example", "tenant", false).unwrap()
}
fn item(id: &str) -> Value {
    json!({"id":id,"bank_id":"bank","provider":"openai","model":"gpt-5","started_at":"2026-09-01T08:16:51.357104+00:00","duration_ms":500,"input_tokens":100,"cached_tokens":20,"output_tokens":10,"total_tokens":110,"input":"PRIVATE_PROMPT","output":"PRIVATE_OUTPUT","metadata":{"content":"PRIVATE_MEMORY"}})
}
fn banks() -> Value {
    json!({"banks":[{"bank_id":"bank"}]})
}
#[test]
fn endpoint_binding_requires_https_or_explicit_literal_loopback_and_escapes_segments() {
    for raw in [
        "https://u:p@hindsight.example",
        "https://hindsight.example/#fragment",
        "https://hindsight.example?x=1",
        "https://hindsight.example/../admin",
        "https://hindsight.example/%2e",
        "ftp://hindsight.example",
        "http://hindsight.example",
        "http://localhost:8888",
        "http://192.168.1.2",
    ] {
        assert!(Endpoint::new(raw, "tenant", true).is_err(), "{raw}");
    }
    assert!(Endpoint::new("http://127.0.0.1:8888", "tenant", false).is_err());
    assert!(Endpoint::new("http://127.0.0.1:8888", "tenant", true).is_ok());
    assert!(Endpoint::new("http://[::1]:8888", "tenant", true).is_ok());
    let e = Endpoint::new("https://hindsight.example/proxy/", "team /?", false).unwrap();
    assert_eq!(
        e.banks(),
        "https://hindsight.example/proxy/v1/team%20%2F%3F/banks"
    );
    assert_eq!(e.rows("a/b?",500).unwrap(),"https://hindsight.example/proxy/v1/team%20%2F%3F/banks/a%2Fb%3F/llm-requests?status=success&limit=500&offset=500");
    let a = credential(Some("synthetic"), &e).unwrap();
    assert!(a.header.unwrap().is_sensitive());
    assert_ne!(a.scope, credential(Some("other"), &e).unwrap().scope);
    assert_ne!(
        a.scope,
        credential(Some("synthetic"), &endpoint()).unwrap().scope
    );
}
#[test]
fn complete_fetch_projects_only_numeric_metadata_and_merges_without_losing_rolling_history() {
    let endpoint = endpoint();
    let auth = credential(None, &endpoint).unwrap();
    let mut transport = fake(vec![banks(), json!({"total":1,"items":[item("id-one")]})]);
    let rows = fetch(&mut transport, &endpoint, &auth, NOW).unwrap();
    assert_eq!(rows.len(), 1);
    let first = merge(None, rows.clone()).unwrap();
    let text = String::from_utf8(first.clone()).unwrap();
    for private in [
        "PRIVATE",
        "id-one",
        ":\"bank\"",
        "trace_id",
        "operation",
        "scope",
        "metadata",
    ] {
        assert!(!text.contains(private), "{private}");
    }
    assert_eq!(rows[0].cached_tokens, Some(20));
    assert_eq!(rows[0].total_tokens, 110);
    assert_eq!(merge(Some(&first), Vec::new()).unwrap(), first);
    assert_eq!(merge(Some(&first), rows.clone()).unwrap(), first);
    let second = normalize(&item("id-two"), "bank", NOW).unwrap().unwrap();
    let merged = merge(Some(&first), vec![second]).unwrap();
    assert_eq!(merged.iter().filter(|b| **b == b'\n').count(), 2);
    let mut changed = rows;
    changed[0].input_tokens += 1;
    changed[0].total_tokens += 1;
    assert_eq!(
        merge(Some(&first), changed),
        Err("hindsight_refresh_record_changed")
    );
}
#[test]
fn malformed_pages_and_inconsistent_totals_do_not_become_an_empty_success() {
    let endpoint = endpoint();
    let auth = credential(None, &endpoint).unwrap();
    for values in [
        vec![json!({})],
        vec![json!({"banks":null})],
        vec![json!({"banks":[{"bank_id":"bank"},{"bank_id":"bank"}]})],
        vec![banks(), json!({})],
        vec![banks(), json!({"total":2,"items":[item("one")]})],
        vec![banks(), json!({"total":0,"items":[item("one")]})],
        vec![banks(), json!({"items":[item("one"),item("one")]})],
        vec![banks(), json!({"total":MAX_ROWS+1,"items":[]})],
    ] {
        assert!(fetch(&mut fake(values), &endpoint, &auth, NOW).is_err());
    }
    let mut v = item("one");
    v["total_tokens"] = json!(999);
    assert!(normalize(&v, "bank", NOW).is_err());
    v["total_tokens"] = json!(130);
    assert!(normalize(&v, "bank", NOW).unwrap().is_some()); // Disjoint input variant.
    v["total_tokens"] = Value::Null;
    assert!(normalize(&v, "bank", NOW).unwrap().is_none());
    v.as_object_mut().unwrap().remove("total_tokens");
    assert!(normalize(&v, "bank", NOW).is_err());
}
#[test]
fn pagination_completes_exactly_and_detects_service_mutation_or_repeated_pages() {
    let endpoint = endpoint();
    let auth = credential(None, &endpoint).unwrap();
    let full: Vec<Value> = (0..PAGE_SIZE).map(|i| item(&format!("id-{i}"))).collect();
    let mut transport = fake(vec![
        banks(),
        json!({"total":501,"items":full}),
        json!({"total":501,"items":[item("last")]}),
    ]);
    assert_eq!(
        fetch(&mut transport, &endpoint, &auth, NOW).unwrap().len(),
        501
    );
    assert!(transport.urls[2].ends_with("offset=500"));
    for final_page in [
        json!({"total":502,"items":[item("last")]}),
        json!({"total":501,"items":[item("id-0")]}),
        json!({"total":501,"items":[]}),
    ] {
        assert!(fetch(
            &mut fake(vec![banks(), json!({"total":501,"items":full}), final_page]),
            &endpoint,
            &auth,
            NOW
        )
        .is_err());
    }
    let mut other = item("same-id");
    other["bank_id"] = json!("second");
    assert_eq!(
        fetch(
            &mut fake(vec![
                json!({"banks":[{"bank_id":"bank"},{"bank_id":"second"}]}),
                json!({"total":1,"items":[item("same-id")]}),
                json!({"total":1,"items":[other]})
            ]),
            &endpoint,
            &auth,
            NOW
        ),
        Err("hindsight_refresh_repeated_page")
    );
}
#[cfg(unix)]
#[test]
fn failed_bank_refresh_retains_last_complete_private_ledger() {
    use std::os::unix::fs::PermissionsExt;
    let mut nonce = [0u8; 16];
    getrandom::fill(&mut nonce).unwrap();
    let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "aicharts-hindsight-fixture-{}",
        super::super::hex(&nonce)
    ));
    std::fs::create_dir(&root).unwrap();
    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
    let cache = super::super::disk::Cache::open(&root).unwrap();
    let endpoint = endpoint();
    let auth = credential(None, &endpoint).unwrap();
    refresh(
        &cache,
        &endpoint,
        &auth,
        &mut fake(vec![banks(), json!({"total":1,"items":[item("one")]})]),
        NOW,
    )
    .unwrap();
    let before = cache.read("usage.jsonl", MAX_BYTES).unwrap().unwrap();
    let mut broken = Fake {
        responses: VecDeque::from([
            Ok(serde_json::to_vec(&banks()).unwrap()),
            Err("synthetic_network_failure"),
        ]),
        urls: Vec::new(),
    };
    assert_eq!(
        refresh(&cache, &endpoint, &auth, &mut broken, NOW),
        Err("synthetic_network_failure")
    );
    assert_eq!(
        cache.read("usage.jsonl", MAX_BYTES).unwrap().unwrap(),
        before
    );
    let other = credential(Some("another-scope"), &endpoint).unwrap();
    assert_eq!(
        refresh(&cache, &endpoint, &other, &mut fake(vec![]), NOW),
        Err("hindsight_refresh_profile_mismatch")
    );
    assert_eq!(
        std::fs::metadata(root.join("usage.jsonl"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    drop(cache);
    std::fs::remove_dir_all(&root).unwrap();
}
