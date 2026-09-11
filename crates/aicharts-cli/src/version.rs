//! Self-reported compiler metadata only; this is not release provenance.

pub(super) fn run(args: &[String]) -> Result<String, &'static str> {
    if args == ["--version"] {
        return Ok(format!("aicharts {}\n", env!("CARGO_PKG_VERSION")));
    }
    if args != ["--version", "--json"] {
        return Err("invalid_version_arguments");
    }
    let identity = serde_json::json!({
        "schemaVersion": 1,
        "operation": "version",
        "version": env!("CARGO_PKG_VERSION"),
        "build": {
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "sourceCommit": null,
        },
        "provenance": "unverified",
    });
    serde_json::to_string(&identity)
        .map(|json| format!("{json}\n"))
        .map_err(|_| "version_encode_failed")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn text_is_exactly_the_cargo_version() {
        assert_eq!(
            run(&args(&["--version"])).unwrap(),
            format!("aicharts {}\n", env!("CARGO_PKG_VERSION"))
        );
    }

    #[test]
    fn json_has_only_unverified_compile_time_identity() {
        let result = run(&args(&["--version", "--json"])).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&result).unwrap(),
            serde_json::json!({
                "schemaVersion": 1,
                "operation": "version",
                "version": env!("CARGO_PKG_VERSION"),
                "build": {
                    "os": std::env::consts::OS,
                    "arch": std::env::consts::ARCH,
                    "sourceCommit": null,
                },
                "provenance": "unverified",
            })
        );
        assert!(result.ends_with('\n'));
    }

    #[test]
    fn only_the_two_exact_argument_sequences_are_accepted() {
        let tokens = [
            "--version",
            "--json",
            "",
            "version",
            "--help",
            "--key-file",
            "--version=1",
            "PRIVATE_ARGUMENT_CANARY",
            "\0",
            "🧪",
        ];
        for length in 0..=4 {
            for mut index in 0..tokens.len().pow(length) {
                let arguments: Vec<String> = (0..length)
                    .map(|_| {
                        let token = tokens[index % tokens.len()].to_owned();
                        index /= tokens.len();
                        token
                    })
                    .collect();
                let expected = arguments == ["--version"] || arguments == ["--version", "--json"];
                let result = run(&arguments);
                assert_eq!(result.is_ok(), expected);
                if !expected {
                    assert_eq!(result, Err("invalid_version_arguments"));
                }
            }
        }
    }

    #[test]
    fn arbitrary_extra_unicode_values_never_enter_output() {
        for scalar in (0..=0x10ffff).step_by(193) {
            if let Some(character) = char::from_u32(scalar) {
                let canary = character.to_string().repeat(16);
                for leading in [&["--version"][..], &["--version", "--json"][..]] {
                    let mut arguments = args(leading);
                    arguments.push(canary.clone());
                    assert_eq!(run(&arguments), Err("invalid_version_arguments"));
                }
            }
        }
    }
}
