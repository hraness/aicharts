These DER files are public, synthetic test material generated locally on
2026-09-13 with OpenSSL. They have no account or provider authority. The test CA
signs one P-256 server certificate for `usage.test`, valid for 36,500 days.
`server-key.der` is its deliberately checked-in PKCS#8 test key. Only `cfg(test)`
loads these files; the production client uses bundled WebPKI roots.

The CA has critical CA/key-signing constraints. The server has critical CA:false
and digital-signature constraints, serverAuth EKU, and DNS SAN `usage.test`.
The test server runs only on an ephemeral IPv4 loopback port and owns its socket
and join handle. No OpenSSL binary or certificate generator is needed at test time.
