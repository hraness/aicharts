//! Seeded stateful property and fuzz evidence for the exact numeric kernels.
//!
//! Every suite draws synthetic values from a named deterministic seed, runs a
//! configured number of iterations and prints one receipt line per seed that
//! `scripts/assurance-fuzz.ts` records. This is sampled evidence with stated
//! seeds and counts: it is neither a proof nor a replacement for the focused
//! regression suites in the kernels themselves. No source file, credential,
//! provider session or network is touched; the ledger suite uses fresh
//! private temporary directories that it removes.
#![forbid(unsafe_code)]

use std::fmt;

/// Named seeds. Names select command weights in the stateful suites so one
/// run exercises several regimes; the values are arbitrary fixed constants.
pub const NAMED_SEEDS: [(&str, u64); 4] = [
    ("baseline", 0x9E37_79B9_7F4A_7C15),
    ("rewrite-heavy", 0xD1B5_4A32_D192_ED03),
    ("conflict-heavy", 0x8CB9_2BA7_2F3D_8DD7),
    ("settlement-race", 0xA24B_AED4_963E_E407),
];
pub const DEFAULT_ITERATIONS: u64 = 1_000;
pub const MAX_ITERATIONS: u64 = 100_000_000;
/// Ledger commands run real SQLite transactions, so without an explicit
/// override the stateful ledger suite is capped below the iteration count.
pub const DEFAULT_LEDGER_COMMAND_CAP: u64 = 5_000;
pub const ITERATIONS_VARIABLE: &str = "AICHARTS_FUZZ_ITERATIONS";
pub const LEDGER_COMMANDS_VARIABLE: &str = "AICHARTS_FUZZ_LEDGER_COMMANDS";
pub const SEED_VARIABLE: &str = "AICHARTS_FUZZ_SEED";
pub const RECEIPT_PREFIX: &str = "aicharts-fuzz";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Seed {
    pub name: String,
    pub value: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    pub iterations: u64,
    /// Commands per seed for the stateful ledger suite.
    pub ledger_commands: u64,
    pub seeds: Vec<Seed>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConfigError {
    InvalidIterations,
    InvalidLedgerCommands,
    UnknownSeed,
}
impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidIterations => "fuzz_iterations_invalid",
            Self::InvalidLedgerCommands => "fuzz_ledger_commands_invalid",
            Self::UnknownSeed => "fuzz_seed_unknown",
        })
    }
}
impl std::error::Error for ConfigError {}

/// Parse the runner's configuration. A missing iteration count uses the
/// default; a missing ledger command count uses the iteration count capped
/// at `DEFAULT_LEDGER_COMMAND_CAP`; a missing seed runs every named seed; a
/// decimal seed value runs exactly that seed under a `custom-` name so
/// failures replay verbatim.
pub fn parse_config(
    iterations: Option<&str>,
    ledger_commands: Option<&str>,
    seed: Option<&str>,
) -> Result<Config, ConfigError> {
    let bounded = |text: &str| {
        text.trim()
            .parse::<u64>()
            .ok()
            .filter(|value| (1..=MAX_ITERATIONS).contains(value))
    };
    let iterations = match iterations {
        None => DEFAULT_ITERATIONS,
        Some(text) => bounded(text).ok_or(ConfigError::InvalidIterations)?,
    };
    let ledger_commands = match ledger_commands {
        None => iterations.min(DEFAULT_LEDGER_COMMAND_CAP),
        Some(text) => bounded(text).ok_or(ConfigError::InvalidLedgerCommands)?,
    };
    let seeds = match seed.map(str::trim) {
        None | Some("") => NAMED_SEEDS
            .iter()
            .map(|(name, value)| Seed {
                name: (*name).to_owned(),
                value: *value,
            })
            .collect(),
        Some(name) => {
            if let Some((name, value)) = NAMED_SEEDS.iter().find(|(known, _)| *known == name) {
                vec![Seed {
                    name: (*name).to_owned(),
                    value: *value,
                }]
            } else {
                let value = name.parse::<u64>().map_err(|_| ConfigError::UnknownSeed)?;
                vec![Seed {
                    name: format!("custom-{value}"),
                    value,
                }]
            }
        }
    };
    Ok(Config {
        iterations,
        ledger_commands,
        seeds,
    })
}

/// Read the configuration from the environment. Invalid values stop the run
/// with the fixed code; nothing falls back silently to a different workload.
pub fn config_from_env() -> Config {
    let iterations = std::env::var(ITERATIONS_VARIABLE).ok();
    let ledger_commands = std::env::var(LEDGER_COMMANDS_VARIABLE).ok();
    let seed = std::env::var(SEED_VARIABLE).ok();
    match parse_config(
        iterations.as_deref(),
        ledger_commands.as_deref(),
        seed.as_deref(),
    ) {
        Ok(config) => config,
        Err(error) => panic!("{error}"),
    }
}

/// xorshift64* with a fixed multiplier. Deterministic and dependency-free; it
/// is a test-input generator, never a security primitive.
#[derive(Clone, Debug)]
pub struct Rng(u64);
impl Rng {
    pub const fn new(seed: u64) -> Self {
        Self(if seed == 0 {
            0x2545_F491_4F6C_DD1D
        } else {
            seed
        })
    }
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    /// Uniform enough for test generation; the modulo bias is irrelevant here.
    pub fn below(&mut self, bound: u64) -> u64 {
        assert!(bound > 0, "empty range");
        self.next_u64() % bound
    }
    pub fn range(&mut self, low: u64, high_inclusive: u64) -> u64 {
        assert!(low <= high_inclusive, "inverted range");
        low + self.below(high_inclusive - low + 1)
    }
    pub fn chance(&mut self, numerator: u64, denominator: u64) -> bool {
        self.below(denominator) < numerator
    }
    pub fn bytes<const N: usize>(&mut self) -> [u8; N] {
        let mut out = [0; N];
        for chunk in out.chunks_mut(8) {
            let word = self.next_u64().to_le_bytes();
            chunk.copy_from_slice(&word[..chunk.len()]);
        }
        out
    }
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len() as u64) as usize]
    }
}

/// Where a failure happened, printed by every assertion so a run replays
/// exactly with `AICHARTS_FUZZ_SEED=<value>`.
#[derive(Clone, Copy, Debug)]
pub struct Context<'a> {
    pub suite: &'a str,
    pub seed: &'a Seed,
    pub iteration: u64,
}
impl fmt::Display for Context<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "suite={} seed={} seed_value={} iteration={}",
            self.suite, self.seed.name, self.seed.value, self.iteration
        )
    }
}

/// Assert with the replay context first, then the caller's message.
#[macro_export]
macro_rules! check {
    ($context:expr, $condition:expr, $($message:tt)+) => {
        assert!($condition, "{} {}", $context, format_args!($($message)+))
    };
}

/// One machine-readable line per suite and seed: fixed keys, integer or
/// identifier values, no input bytes.
pub fn receipt_line(suite: &str, seed: &Seed, iterations: u64, counters: &[(&str, u64)]) -> String {
    let mut line = format!(
        "{RECEIPT_PREFIX} suite={suite} seed={} seed_value={} iterations={iterations}",
        seed.name, seed.value
    );
    for (key, value) in counters {
        line.push_str(&format!(" {key}={value}"));
    }
    line
}

#[cfg(test)]
mod metrics_props;

#[cfg(test)]
mod protocol_props;

#[cfg(all(test, unix))]
mod ledger_props;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configuration_defaults_named_seeds_and_custom_values_are_explicit() {
        let config = parse_config(None, None, None).unwrap();
        assert_eq!(config.iterations, DEFAULT_ITERATIONS);
        assert_eq!(config.ledger_commands, DEFAULT_ITERATIONS);
        assert_eq!(config.seeds.len(), NAMED_SEEDS.len());
        assert_eq!(config.seeds[0].name, "baseline");
        let one = parse_config(Some("25"), None, Some("conflict-heavy")).unwrap();
        assert_eq!(one.iterations, 25);
        assert_eq!(one.ledger_commands, 25);
        assert_eq!(one.seeds.len(), 1);
        assert_eq!(one.seeds[0].value, NAMED_SEEDS[2].1);
        let custom = parse_config(Some(" 7 "), Some("3"), Some("12345")).unwrap();
        assert_eq!(custom.ledger_commands, 3);
        assert_eq!(custom.seeds[0].name, "custom-12345");
        assert_eq!(custom.seeds[0].value, 12345);
        let capped = parse_config(Some("200000"), None, None).unwrap();
        assert_eq!(capped.ledger_commands, DEFAULT_LEDGER_COMMAND_CAP);
        let raised = parse_config(Some("200000"), Some("200000"), None).unwrap();
        assert_eq!(raised.ledger_commands, 200_000);
        assert_eq!(
            parse_config(Some("0"), None, None).err(),
            Some(ConfigError::InvalidIterations)
        );
        assert_eq!(
            parse_config(Some("x"), None, None).err(),
            Some(ConfigError::InvalidIterations)
        );
        assert_eq!(
            parse_config(Some("100000001"), None, None).err(),
            Some(ConfigError::InvalidIterations)
        );
        assert_eq!(
            parse_config(None, Some("0"), None).err(),
            Some(ConfigError::InvalidLedgerCommands)
        );
        assert_eq!(
            parse_config(None, None, Some("no-such-seed")).err(),
            Some(ConfigError::UnknownSeed)
        );
    }

    #[test]
    fn generator_is_deterministic_bounded_and_never_stuck_at_zero() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        let left: Vec<u64> = (0..64).map(|_| a.next_u64()).collect();
        let right: Vec<u64> = (0..64).map(|_| b.next_u64()).collect();
        assert_eq!(left, right);
        assert!(left.iter().any(|value| *value != 0));
        let mut zero = Rng::new(0);
        assert!((0..16).any(|_| zero.next_u64() != 0));
        let mut rng = Rng::new(7);
        for _ in 0..1_000 {
            assert!(rng.below(5) < 5);
            let value = rng.range(10, 12);
            assert!((10..=12).contains(&value));
        }
        assert_eq!(rng.range(3, 3), 3);
        let bytes: [u8; 20] = rng.bytes();
        assert!(bytes.iter().any(|byte| *byte != 0));
        assert!(["x", "y"].contains(rng.pick(&["x", "y"])));
    }

    #[test]
    fn receipt_lines_carry_fixed_keys_only() {
        let seed = Seed {
            name: "baseline".into(),
            value: 9,
        };
        assert_eq!(
            receipt_line("metrics-kernel", &seed, 3, &[("cases", 3), ("failures", 0)]),
            "aicharts-fuzz suite=metrics-kernel seed=baseline seed_value=9 iterations=3 cases=3 failures=0"
        );
    }
}
