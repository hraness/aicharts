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
/// `Ok(None)` is an unknown estimate: no tariff, or a used bucket without a
/// rate. A malformed checked-in rate or an amount beyond the profile refuses
/// the client instead of leaving its cost silently absent.
pub(super) fn estimate(
    provider: Option<&str>,
    model: Option<&str>,
    tokens: [u128; 5],
) -> Result<Option<u128>, &'static str> {
    #[cfg(test)]
    if let Some(result) = OVERRIDE.with(|slot| {
        slot.borrow()
            .as_ref()
            .map(|catalog| estimate_from(catalog, provider, model, tokens))
    }) {
        return result;
    }
    estimate_from(catalog(), provider, model, tokens)
}
#[cfg(test)]
thread_local! {
    static OVERRIDE: std::cell::RefCell<Option<Catalog>> = const { std::cell::RefCell::new(None) };
}
/// Run a projection against a synthetic catalog. The checked-in catalog is a
/// compile-time constant, so the refusal path for a malformed rate can only
/// be exercised through this test-only seam.
#[cfg(test)]
pub(super) fn with_catalog<T>(json: &str, run: impl FnOnce() -> T) -> T {
    let catalog: Catalog = serde_json::from_str(json).expect("synthetic catalog");
    OVERRIDE.with(|slot| *slot.borrow_mut() = Some(catalog));
    let result = run();
    OVERRIDE.with(|slot| *slot.borrow_mut() = None);
    result
}
fn estimate_from(
    catalog: &Catalog,
    provider: Option<&str>,
    model: Option<&str>,
    tokens: [u128; 5],
) -> Result<Option<u128>, &'static str> {
    let (Some(provider), Some(model)) = (provider, model) else {
        return Ok(None);
    };
    match catalog.rates.get(&format!("{provider}\0{model}")) {
        Some(tariff) => price(tariff, tokens),
        None => Ok(None),
    }
}
fn rates(tariff: &Tariff) -> Result<[Option<u128>; 5], &'static str> {
    let mut rates = [None; 5];
    for (target, rate) in rates.iter_mut().zip([
        &tariff.input,
        &tariff.cache_read,
        &tariff.cache_write,
        &tariff.output,
        &tariff.output,
    ]) {
        *target = rate
            .as_deref()
            .map(aicharts_metrics::canonical_integer)
            .transpose()
            .map_err(|_| "stats_tariff_invalid")?;
    }
    Ok(rates)
}
fn price(tariff: &Tariff, tokens: [u128; 5]) -> Result<Option<u128>, &'static str> {
    match aicharts_metrics::price_microusd(tokens, rates(tariff)?) {
        Ok(value) => Ok(Some(value)),
        Err(aicharts_metrics::Error::MissingRate) => Ok(None),
        Err(_) => Err("stats_cost_limit"),
    }
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
        assert_eq!(price(&tariff, [100, 0, 0, 10, 5]), Ok(Some(400)));
        assert_eq!(price(&tariff, [100, 1, 0, 10, 5]), Ok(None));
        assert_eq!(price(&tariff, [100, 0, 1, 10, 5]), Ok(None));
        assert_eq!(
            estimate(Some("PRIVATE_PROVIDER"), Some("gpt-5"), [100, 0, 0, 10, 0]),
            Ok(None)
        );
    }
    #[test]
    fn dated_catalog_is_available_offline_and_exact() {
        assert_eq!(
            estimate(Some("openai"), Some("gpt-5-nano"), [1_000_000, 0, 0, 0, 0]),
            Ok(Some(50_000))
        );
        assert_eq!(
            estimate(None, Some("gpt-5-nano"), [1_000_000, 0, 0, 0, 0]),
            Ok(None)
        );
    }
    #[test]
    fn malformed_tariffs_refuse_instead_of_reading_as_absent() {
        let tariff = |input: &str| Tariff {
            input: Some(input.to_owned()),
            output: Some("10000000".into()),
            cache_read: None,
            cache_write: None,
        };
        for malformed in [
            "",
            "2.5e6",
            "2500000.0",
            "02500000",
            "2_500_000",
            "-1",
            " 2500000",
        ] {
            let tariff = tariff(malformed);
            assert_eq!(
                price(&tariff, [100, 0, 0, 10, 5]),
                Err("stats_tariff_invalid")
            );
            // A malformed rate for an unused bucket is the same checked-in fault.
            assert_eq!(
                price(&tariff, [0, 0, 0, 10, 5]),
                Err("stats_tariff_invalid")
            );
            let catalog = Catalog {
                rates: BTreeMap::from([("openai\0gpt-5".to_owned(), tariff)]),
            };
            assert_eq!(
                estimate_from(&catalog, Some("openai"), Some("gpt-5"), [1, 0, 0, 0, 0]),
                Err("stats_tariff_invalid")
            );
        }
        // An amount beyond the 24-digit profile or u128 is a refusal too.
        let tariff = tariff("340282366920938463463374607431768211455");
        assert_eq!(price(&tariff, [2, 0, 0, 0, 0]), Err("stats_cost_limit"));
        assert_eq!(price(&tariff, [1, 0, 0, 0, 0]), Err("stats_cost_limit"));
    }
    #[test]
    fn every_checked_in_rate_is_a_canonical_integer() {
        let catalog = catalog();
        assert!(!catalog.rates.is_empty());
        for tariff in catalog.rates.values() {
            assert!(rates(tariff).is_ok());
        }
    }
}
