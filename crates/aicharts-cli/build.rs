//! Stamps the exact source commit into the binary when the build tree is a Git
//! checkout. An explicit AICHARTS_SOURCE_COMMIT wins; a non-Git tree stamps
//! nothing, and `--version --json` then reports `sourceCommit: null`.
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-env-changed=AICHARTS_SOURCE_COMMIT");
    for path in ["../../.git/HEAD", "../../.git/refs/heads"] {
        println!("cargo:rerun-if-changed={path}");
    }
    if std::env::var_os("AICHARTS_SOURCE_COMMIT").is_some() {
        return;
    }
    let Ok(output) = Command::new("git").args(["rev-parse", "HEAD"]).output() else {
        return;
    };
    if !output.status.success() {
        return;
    }
    let sha = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if sha.len() == 40 && sha.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        println!("cargo:rustc-env=AICHARTS_SOURCE_COMMIT={sha}");
    }
}
