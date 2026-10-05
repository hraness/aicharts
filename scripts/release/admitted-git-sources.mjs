// Immutable reviewed Git dependencies admitted to the locked build source,
// including every compiled source input. Other Git URLs, revisions, packages
// and license bytes remain inadmissible.
//
// Each entry is keyed by the exact Cargo.lock source string and lists every
// admitted package identity from that checkout: its crate directory relative
// to the checkout root, and the SHA-256 of every reviewed file in that
// checkout (the workspace manifest and license text plus the crate's complete
// subtree). A package the list does not name is inadmissible.
const entries = {
  'git+https://github.com/hraness/support-foundation?rev=ed89e584c2c420e3e0547bbe8f32baf8e3a2ae4d#ed89e584c2c420e3e0547bbe8f32baf8e3a2ae4d': [{
    package: 'hraness-support-foundation',
    version: '0.4.0',
    license: 'MIT',
    crate: 'rust',
    files: {
      'Cargo.toml': '4e68521cb77b121e52ca7ea36b97e04eb4be3e39cb7dfcd35ffdf25b58abc689',
      LICENSE: '74b69bf37c8f340c9c2a54d431a15218738d9c463d0e014fa6a8bb8edce4e539',
      'rust/Cargo.toml': 'ec931d1bf5e9f04168b47994c48d796d5eec5203131736b2e4695869f328e347',
      'rust/src/lib.rs': '8fec4a89dcee42059ea9c703a099eb7350258ae540bf8aa031a902b9e303d532',
      'rust/src/runtime.rs': '183b066571f1e7c03d031958943b56a9b608e7ec87069e0edd344ee5e72cbf82',
      'rust/src/state.rs': '7b9b8b214c71841c015607ed0cdfd669de84f3b818188ab425667f09580e2216',
      'rust/src/contract-v1.json': 'd7d6c28239b8afcd3819809f1ebde769c1852d1ffa0c07811b619dc02ce1170d',
    },
  }],
  // desktop-foundation tag v2.0.0 resolves to this commit. One checkout
  // provides two reviewed crates; each is admitted by its exact name.
  'git+https://github.com/hraness/desktop-foundation?tag=v2.0.0#798be31fca87bbe9195e351cdf358c4d14eb42d4': [{
    package: 'hraness-cli-kit',
    version: '2.0.0',
    license: 'MIT',
    crate: 'crates/hraness-cli-kit',
    files: {
      'Cargo.toml': 'fafada12c1f34c7482a73ffc42540f5cb5d632947009fbdd7817db93491d210d',
      LICENSE: '2875a979247548431aa55a481c8cf68b12d437cf8cbca76be6d68f787678ecaa',
      'crates/hraness-cli-kit/Cargo.toml': '2a7410d1b284920ef50075d158abf066366ffec9832a560502b31c500b1509f7',
      'crates/hraness-cli-kit/LICENSE': '2875a979247548431aa55a481c8cf68b12d437cf8cbca76be6d68f787678ecaa',
      'crates/hraness-cli-kit/README.md': '5b3c925d8e402b11a11e000904b70f234c78278dad79ea64ee665732d2ba7b56',
      'crates/hraness-cli-kit/src/audience.rs': '46abd8062e785959496a4d88472c4548cc40aeb21112d4c3f89645ef7242215c',
      'crates/hraness-cli-kit/src/clap.rs': '2b8c0aa3b673f667eefb9abdd0b863a04c7476fb32ea0dcef9ca291de0c23c7a',
      'crates/hraness-cli-kit/src/json.rs': 'c0ae3333ed77dd0dbb775cd19833d944473f44fc7eafba048136bc024df6fb5b',
      'crates/hraness-cli-kit/src/lib.rs': '6b11c06fff86dbd4e0354bd96a4242480cf6a3600fa4cf86be2eb8903e8c2414',
      'crates/hraness-cli-kit/src/permissions.rs': 'cd190157895c5dba3c3b42a74942409907a82047550dc3149ada591052db7127',
      'crates/hraness-cli-kit/src/style.rs': '51ff00727a6d36647c93c228163427a77db7a20a72e3ac2e3a11d2f6f7604c18',
      'crates/hraness-cli-kit/tests/contract.rs': '4755cc6ddf1bd2d4f88493fb6b61d31417ae06982b9fbcee5b8022b7f9f86167',
    },
  }, {
    package: 'hraness-control-kit',
    version: '2.0.0',
    license: 'MIT',
    crate: 'crates/hraness-control-kit',
    files: {
      'Cargo.toml': 'fafada12c1f34c7482a73ffc42540f5cb5d632947009fbdd7817db93491d210d',
      LICENSE: '2875a979247548431aa55a481c8cf68b12d437cf8cbca76be6d68f787678ecaa',
      'crates/hraness-control-kit/Cargo.toml': '33c3a5f2c901b6042185cc3dc20c7710862d473e286de986f098ac5a68f075fe',
      'crates/hraness-control-kit/src/contract.rs': '336ead3dde0732c1d9fc73ce508c5afd678ef4addd790bff937d5aafd42a5589',
      'crates/hraness-control-kit/src/control.rs': 'd65e0cb50589ad4c9fe257568065e083f8329946a677e4731c061137c2059b87',
      'crates/hraness-control-kit/src/crypto.rs': 'aee7748f8f0677afa1fbeaf443112ea4c20c87c153a8134cbd7576307c21324b',
      'crates/hraness-control-kit/src/envelope.rs': '104c765aadc4f7d9807f72570f91b19bab192f41f929dbdb5006b390e498a5bd',
      'crates/hraness-control-kit/src/gate.rs': 'ffbc509e0560dedbfc73df64c73fb80a58413be2d1eaadf14cb05306ef08196e',
      'crates/hraness-control-kit/src/lib.rs': '20be2ca7902d092e02bb50bfef90a6b776062ef141751820a0046f8cce55d0d7',
      'crates/hraness-control-kit/src/process_identity.rs': '3a02aab9c0f3d737ea41be53982c52ef658cd78751542fe3c516cf52a10944bf',
      'crates/hraness-control-kit/src/registry.rs': 'a00746ade14b1cc33e53d433d57ee0294f10fc3f1098b5b795b8f58130fd9374',
      'crates/hraness-control-kit/src/time.rs': 'b0ba255e61a9c43725ec9a3c196db197507c4b5dd9ae60dee0cb81fc0604694c',
    },
  }],
};
export const GIT_SOURCES = Object.freeze(Object.fromEntries(Object.entries(entries)
  .map(([source, records]) => [source, Object.freeze(records.map(record => Object.freeze({ ...record, files: Object.freeze(record.files) })))])));

/** The admitted records for an exact locked source string, or null. */
export function admittedGitSource(source) {
  return Object.hasOwn(GIT_SOURCES, source) ? GIT_SOURCES[source] : null;
}

/** The one admitted record for an exact locked source string and package name, or null. */
export function admittedGitCrate(source, name) {
  return admittedGitSource(source)?.find(record => record.package === name) ?? null;
}
