//! Every checked-in differential vector evaluated through the production
//! kernel. The fixtures come from `scripts/generate-kernel-vectors.ts`, whose
//! own BigInt references are the third implementation; the shared TypeScript
//! evaluates the same files. The crate stays dependency-free, so the fixed
//! `[inputs, outcome, value]` shape is read by a tiny array/string reader.
use super::*;

#[derive(Clone, Debug, PartialEq, Eq)]
enum Node {
    Text(String),
    Null,
    List(Vec<Node>),
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn skip_space(&mut self) {
        while self.at < self.bytes.len() && self.bytes[self.at].is_ascii_whitespace() {
            self.at += 1;
        }
    }
    fn expect(&mut self, byte: u8) {
        self.skip_space();
        assert_eq!(
            self.bytes.get(self.at),
            Some(&byte),
            "vector syntax at {}",
            self.at
        );
        self.at += 1;
    }
    fn node(&mut self) -> Node {
        self.skip_space();
        match self.bytes[self.at] {
            b'[' => {
                self.at += 1;
                let mut items = Vec::new();
                self.skip_space();
                if self.bytes[self.at] == b']' {
                    self.at += 1;
                    return Node::List(items);
                }
                loop {
                    items.push(self.node());
                    self.skip_space();
                    match self.bytes[self.at] {
                        b',' => self.at += 1,
                        b']' => {
                            self.at += 1;
                            return Node::List(items);
                        }
                        other => panic!("unexpected {other:?} at {}", self.at),
                    }
                }
            }
            b'"' => {
                self.at += 1;
                let start = self.at;
                while self.bytes[self.at] != b'"' {
                    assert_ne!(self.bytes[self.at], b'\\', "escapes are never emitted");
                    self.at += 1;
                }
                let text = std::str::from_utf8(&self.bytes[start..self.at]).unwrap();
                self.at += 1;
                Node::Text(text.to_owned())
            }
            b'n' => {
                assert_eq!(&self.bytes[self.at..self.at + 4], b"null");
                self.at += 4;
                Node::Null
            }
            other => panic!("unexpected {other:?} at {}", self.at),
        }
    }
}

struct Case {
    inputs: Vec<Node>,
    expected: Result<String, String>,
}

fn cases(law: &str, source: &str) -> Vec<Case> {
    assert!(source.contains(&format!("\"law\": \"{law}\"")));
    let start = source.find("\"cases\":").expect("cases key") + "\"cases\":".len();
    let mut reader = Reader {
        bytes: source.as_bytes(),
        at: start,
    };
    let Node::List(items) = reader.node() else {
        panic!("cases must be a list");
    };
    reader.skip_space();
    reader.expect(b'}');
    reader.skip_space();
    assert_eq!(reader.at, source.len(), "trailing bytes");
    assert!(items.len() >= 2_000, "{law} has {} cases", items.len());
    items
        .into_iter()
        .map(|item| {
            let Node::List(parts) = item else {
                panic!("case must be a list");
            };
            let [Node::List(inputs), Node::Text(outcome), Node::Text(value)] = parts.as_slice()
            else {
                panic!("case shape");
            };
            Case {
                inputs: inputs.clone(),
                expected: match outcome.as_str() {
                    "ok" => Ok(value.clone()),
                    "err" => Err(value.clone()),
                    _ => panic!("outcome"),
                },
            }
        })
        .collect()
}

fn integer<T: std::str::FromStr>(node: &Node) -> T
where
    T::Err: std::fmt::Debug,
{
    let Node::Text(text) = node else {
        panic!("expected a decimal string, got {node:?}");
    };
    text.parse().unwrap()
}

fn code(error: Error) -> &'static str {
    match error {
        Error::Overflow => "overflow",
        Error::Underflow => "underflow",
        Error::Limit => "limit",
        Error::InvalidPartition => "invalid_partition",
        Error::MissingReasoning => "missing_reasoning",
        Error::MissingCacheTtl => "missing_cache_ttl",
        Error::MissingRate => "missing_rate",
        Error::ZeroDenominator => "zero_denominator",
        Error::OwnerConflict => "owner_conflict",
        Error::PopulationMismatch => "population_mismatch",
        Error::MissingEvidence => "missing_evidence",
    }
}

fn check<T: ToString>(law: &str, index: usize, actual: Result<T, Error>, case: &Case) {
    let actual = actual
        .map(|value| value.to_string())
        .map_err(|error| code(error).to_owned());
    assert_eq!(
        actual, case.expected,
        "{law} case {index}: {:?}",
        case.inputs
    );
}

fn assert_outcomes(law: &str, seen: &[bool]) {
    assert!(
        seen.iter().all(|seen| *seen),
        "{law} vectors must cover every outcome: {seen:?}"
    );
}

#[test]
fn wire_token_total_vectors_match_the_kernel() {
    let law = "wire-token-total";
    let mut seen = [false; 3];
    for (index, case) in cases(
        law,
        include_str!("../../../fixtures/usage/assurance/kernel-vectors/wire-token-total.json"),
    )
    .iter()
    .enumerate()
    {
        let counters: [u64; 6] = std::array::from_fn(|position| integer(&case.inputs[position]));
        let actual = wire_token_total(counters);
        seen[match actual {
            Ok(_) => 0,
            Err(Error::Limit) => 1,
            Err(Error::InvalidPartition) => 2,
            Err(other) => panic!("{other:?}"),
        }] = true;
        check(law, index, actual, case);
    }
    assert_outcomes(law, &seen);
}

#[test]
fn checked_add_bounded_vectors_match_the_kernel() {
    let law = "checked-add-bounded";
    let mut seen = [false; 3];
    for (index, case) in cases(
        law,
        include_str!("../../../fixtures/usage/assurance/kernel-vectors/checked-add-bounded.json"),
    )
    .iter()
    .enumerate()
    {
        let [left, right, limit]: [u128; 3] =
            std::array::from_fn(|position| integer(&case.inputs[position]));
        let actual = checked_add_bounded(left, right, limit);
        seen[match actual {
            Ok(_) => 0,
            Err(Error::Overflow) => 1,
            Err(Error::Limit) => 2,
            Err(other) => panic!("{other:?}"),
        }] = true;
        check(law, index, actual, case);
        // The unbounded kernel agrees wherever the bound does not intervene.
        if limit == u128::MAX {
            check(law, index, checked_add(left, right), case);
        }
    }
    assert_outcomes(law, &seen);
}

#[test]
fn cache_ttl_split_vectors_match_the_kernel() {
    let law = "cache-ttl-split";
    let mut seen = [false; 3];
    for (index, case) in cases(
        law,
        include_str!("../../../fixtures/usage/assurance/kernel-vectors/cache-ttl-split.json"),
    )
    .iter()
    .enumerate()
    {
        let [total, five, hour]: [u128; 3] =
            std::array::from_fn(|position| integer(&case.inputs[position]));
        let actual = CacheWrites::with_ttl(total, five, hour).map(|writes| {
            assert_eq!(
                writes.ttl(),
                CacheTtl::Split {
                    five_minute: five,
                    one_hour: hour
                }
            );
            writes.total()
        });
        seen[match actual {
            Ok(_) => 0,
            Err(Error::Overflow) => 1,
            Err(Error::InvalidPartition) => 2,
            Err(other) => panic!("{other:?}"),
        }] = true;
        check(law, index, actual, case);
    }
    assert_outcomes(law, &seen);
}

#[test]
fn exact_ratio_rounding_vectors_match_the_kernel() {
    let law = "exact-ratio-rounding";
    let mut seen = [false; 4];
    for (index, case) in cases(
        law,
        include_str!("../../../fixtures/usage/assurance/kernel-vectors/exact-ratio-rounding.json"),
    )
    .iter()
    .enumerate()
    {
        let numerator: u128 = integer(&case.inputs[0]);
        let denominator: u128 = integer(&case.inputs[1]);
        let Node::Text(rule) = &case.inputs[2] else {
            panic!("rule");
        };
        let (rule, slot) = match rule.as_str() {
            "floor" => (Rounding::Floor, 0),
            "ceiling" => (Rounding::Ceiling, 1),
            "half-up" => (Rounding::HalfUp, 2),
            other => panic!("{other}"),
        };
        let actual = ExactRatio::new(numerator, denominator).and_then(|ratio| ratio.rounded(rule));
        seen[if actual.is_ok() { slot } else { 3 }] = true;
        check(law, index, actual, case);
    }
    assert_outcomes(law, &seen);
}

#[test]
fn pricing_microusd_vectors_match_the_kernel() {
    let law = "pricing-microusd";
    let mut seen = [false; 4];
    for (index, case) in cases(
        law,
        include_str!("../../../fixtures/usage/assurance/kernel-vectors/pricing-microusd.json"),
    )
    .iter()
    .enumerate()
    {
        let [Node::List(tokens), Node::List(rates)] = case.inputs.as_slice() else {
            panic!("pricing inputs");
        };
        let tokens: [u128; 5] = std::array::from_fn(|position| integer(&tokens[position]));
        let rates: [Option<u128>; 5] = std::array::from_fn(|position| match &rates[position] {
            Node::Null => None,
            node => Some(integer(node)),
        });
        let actual = price_microusd(tokens, rates);
        seen[match actual {
            Ok(_) => 0,
            Err(Error::MissingRate) => 1,
            Err(Error::Overflow) => 2,
            Err(Error::Limit) => 3,
            Err(other) => panic!("{other:?}"),
        }] = true;
        check(law, index, actual, case);
    }
    assert_outcomes(law, &seen);
}
