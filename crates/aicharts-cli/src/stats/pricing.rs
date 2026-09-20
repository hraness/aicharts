//! Dated public retail estimates, never invoice amounts or live provider calls.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Tariff {
    input: Option<String>,
    cache_read: Option<String>,
    cache_write: Option<String>,
    output: Option<String>,
}
#[derive(Deserialize)]
struct Catalog {
    rates: BTreeMap<String, Tariff>,
}
fn catalog() -> &'static Catalog {
    static VALUE: OnceLock<Catalog> = OnceLock::new();
    VALUE.get_or_init(|| {
        serde_json::from_str(include_str!("../../../../data/usage-prices.json"))
            .expect("checked usage price catalog")
    })
}
pub(super) fn estimate(
    provider: Option<&str>,
    model: Option<&str>,
    tokens: [u128; 5],
) -> Option<u128> {
    let key = format!("{}\0{}", provider?, model?);
    let tariff = catalog().rates.get(&key)?;
    price(tariff, tokens)
}
fn price(tariff: &Tariff, tokens: [u128; 5]) -> Option<u128> {
    let rates = [
        &tariff.input,
        &tariff.cache_read,
        &tariff.cache_write,
        &tariff.output,
        &tariff.output,
    ];
    let mut pico = 0u128;
    for (tokens, rate) in tokens.into_iter().zip(rates) {
        if tokens == 0 {
            continue;
        }
        let rate = rate.as_ref()?.parse::<u128>().ok()?;
        pico = pico.checked_add(tokens.checked_mul(rate)?)?;
    }
    // One rounding operation per observed record, in exact integer arithmetic.
    pico.checked_add(500_000)
        .map(|amount| amount / 1_000_000)
        .filter(|amount| *amount <= MAX_DECIMAL)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pricing_needs_every_used_bucket_and_never_guesses_missing_cache_rates() {
        let tariff = Tariff {
            input: Some("2500000".into()),
            output: Some("10000000".into()),
            cache_read: None,
            cache_write: None,
        };
        assert_eq!(price(&tariff, [100, 0, 0, 10, 5]), Some(400));
        assert_eq!(price(&tariff, [100, 1, 0, 10, 5]), None);
        assert_eq!(price(&tariff, [100, 0, 1, 10, 5]), None);
        assert_eq!(
            estimate(Some("PRIVATE_PROVIDER"), Some("gpt-5"), [100, 0, 0, 10, 0]),
            None
        );
    }
    #[test]
    fn dated_catalog_is_available_offline_and_exact() {
        assert_eq!(
            estimate(Some("openai"), Some("gpt-5-nano"), [1_000_000, 0, 0, 0, 0]),
            Some(50_000)
        );
        assert_eq!(
            estimate(None, Some("gpt-5-nano"), [1_000_000, 0, 0, 0, 0]),
            None
        );
    }
}
