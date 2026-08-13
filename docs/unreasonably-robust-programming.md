# Unreasonably Robust Programming

URP means spending abundant, inexpensive agent effort on real correctness while recognizing that rollout, external coordination, and elapsed-time risk remain costly.

## Spend cheap effort on correctness

- Generate broad inputs for parsers, reducers, and invariant-heavy helpers with property tests.
- Make failure paths explicit with `Result` and narrow external values through one Zod seam.
- Keep generated-file, compiler, lint, test, and production-build checks executable and identical in local development and CI.
- Prefer independent laws and predicates over assertions that merely repeat the implementation.

## Treat external risk as expensive

- Local tests do not prove hosting, third-party setup, rollout, billing, or customer impact.
- Avoid machinery that the product does not need: publishing, migrations, large-file workflows, provider adapters, and distributed coordination stay out of the application.
- Make expensive changes deliberate, reversible, observable, and separately authorized.
