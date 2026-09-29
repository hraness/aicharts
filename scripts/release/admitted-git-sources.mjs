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
  // desktop-foundation tag v0.9.0 resolves to this commit. One checkout
  // provides two reviewed crates; each is admitted by its exact name.
  'git+https://github.com/hraness/desktop-foundation?tag=v0.9.0#6174033a51cd0fa4f5259c8c2492b9a28b942602': [{
    package: 'hraness-cli-kit',
    version: '0.9.0',
    license: 'MIT',
    crate: 'crates/hraness-cli-kit',
    files: {
      'Cargo.toml': '9fe2cdb4dcdddf1246dcaecece7c00d988a4012fedbb9fbd988842ea0e429f7b',
      LICENSE: '2875a979247548431aa55a481c8cf68b12d437cf8cbca76be6d68f787678ecaa',
      'crates/hraness-cli-kit/Cargo.toml': 'bc2a24b8e3ecf77c066c5e8d669d9b1f1df120b9a19d51384c0b8d3580f07326',
      'crates/hraness-cli-kit/src/audience.rs': '46abd8062e785959496a4d88472c4548cc40aeb21112d4c3f89645ef7242215c',
      'crates/hraness-cli-kit/src/clap.rs': '2b8c0aa3b673f667eefb9abdd0b863a04c7476fb32ea0dcef9ca291de0c23c7a',
      'crates/hraness-cli-kit/src/json.rs': 'c0ae3333ed77dd0dbb775cd19833d944473f44fc7eafba048136bc024df6fb5b',
      'crates/hraness-cli-kit/src/lib.rs': '6b11c06fff86dbd4e0354bd96a4242480cf6a3600fa4cf86be2eb8903e8c2414',
      'crates/hraness-cli-kit/src/permissions.rs': 'e5f4227d4c09c4c1076c94b39627f2b40c0e85abbd5da8b967810d3b7eff12d4',
      'crates/hraness-cli-kit/src/style.rs': '51ff00727a6d36647c93c228163427a77db7a20a72e3ac2e3a11d2f6f7604c18',
      'crates/hraness-cli-kit/tests/contract.rs': '1da527f0603614c790df04acbeb88a991251a028887fe7fc944ead03a71987eb',
    },
  }, {
    package: 'hraness-control-kit',
    version: '0.9.0',
    license: 'MIT',
    crate: 'crates/hraness-control-kit',
    files: {
      'Cargo.toml': '9fe2cdb4dcdddf1246dcaecece7c00d988a4012fedbb9fbd988842ea0e429f7b',
      LICENSE: '2875a979247548431aa55a481c8cf68b12d437cf8cbca76be6d68f787678ecaa',
      'crates/hraness-control-kit/Cargo.toml': '1b2aa7b1e4b1f0cc93e557c1dd43fc44f73e681718e06eef54bdaf712a875373',
      'crates/hraness-control-kit/src/contract.rs': '336ead3dde0732c1d9fc73ce508c5afd678ef4addd790bff937d5aafd42a5589',
      'crates/hraness-control-kit/src/control.rs': 'd65e0cb50589ad4c9fe257568065e083f8329946a677e4731c061137c2059b87',
      'crates/hraness-control-kit/src/crypto.rs': 'aee7748f8f0677afa1fbeaf443112ea4c20c87c153a8134cbd7576307c21324b',
      'crates/hraness-control-kit/src/envelope.rs': 'a0b2cd0e2ace50ebaaaa8b1832b745d4f8a69991528e6b97bc2475dcb3af504f',
      'crates/hraness-control-kit/src/gate.rs': '256cdd00884addbd9771b46bd3f2a556bfebf7844442b857fc916393a9ec3d9a',
      'crates/hraness-control-kit/src/lib.rs': 'e06576c4ffb35bad77b58e5a1203c48a02c8f643f9a8ee4ceb15b3eca591cdf0',
      'crates/hraness-control-kit/src/process_identity.rs': '3a02aab9c0f3d737ea41be53982c52ef658cd78751542fe3c516cf52a10944bf',
      'crates/hraness-control-kit/src/registry.rs': 'e72f5cd9439a26e392766182e93f3947649f1f511ca3e4f975255d72015f1a81',
      'crates/hraness-control-kit/src/time.rs': 'b0ba255e61a9c43725ec9a3c196db197507c4b5dd9ae60dee0cb81fc0604694c',
      'crates/hraness-control-kit/src/tui.rs': '81acbc29095da0ba4e66c80adc6243efdda7824383d5c8acdc81454c6d012d3a',
      'crates/hraness-control-kit/tests/golden/tui-status-120.txt': 'ead81e0f83c6a265c8a5ced6d0c3888972d4a88f80b158b9f10f1c25b1ef77bf',
      'crates/hraness-control-kit/tests/golden/tui-status-40.txt': '7960c1e383ce7e792fb34b288f3dd8b5c5e9df83f5bb82c0875a823fec86e544',
      'crates/hraness-control-kit/tests/golden/tui-status-80.txt': '7eb1a604d722f8dd05c6946c89488b94f08291fdfe4fce80af81fe7e783aa157',
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
