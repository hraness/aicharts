fn main() {
    for path in ["native/acl.c", "native/acl.h", "native/acl_test.c"] {
        println!("cargo:rerun-if-changed={path}");
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    cc::Build::new()
        .file("native/acl.c")
        .std("c11")
        .warnings(true)
        .extra_warnings(true)
        .warnings_into_errors(true)
        .compile("aicharts_platform_acl");
    // Cargo build scripts are shared by normal and test builds. Compile the
    // fixtures separately, with no automatic link directive. Only the Rust
    // cfg(test) extern block requests this archive; production has no fixture
    // symbols or ACL-mutation path linked from it.
    cc::Build::new()
        .file("native/acl_test.c")
        .std("c11")
        .warnings(true)
        .extra_warnings(true)
        .warnings_into_errors(true)
        .cargo_metadata(false)
        .compile("aicharts_acl_test");
}
