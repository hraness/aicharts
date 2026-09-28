// Immutable reviewed Git dependencies admitted to the locked build source,
// including every compiled source input. Other Git URLs, revisions, packages
// and license bytes remain inadmissible.
//
// Each entry is keyed by the exact Cargo.lock source string and records the
// one admitted package identity, the crate directory relative to the checkout
// root, and the SHA-256 of every reviewed file in that checkout: the workspace
// manifest and license text plus the crate's complete subtree.
const entries = {
  'git+https://github.com/hraness/support-foundation?rev=ed89e584c2c420e3e0547bbe8f32baf8e3a2ae4d#ed89e584c2c420e3e0547bbe8f32baf8e3a2ae4d': {
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
  },
  // desktop-foundation tag v0.8.1 resolves to this commit.
  'git+https://github.com/hraness/desktop-foundation?tag=v0.8.1#6040606576167e4e8d0163a564463f04fa238be4': {
    package: 'hraness-cli-kit',
    version: '0.8.1',
    license: 'MIT',
    crate: 'crates/hraness-cli-kit',
    files: {
      'Cargo.toml': '45ce70699d608320552f7978d227e8c4637479d5d2595d543370cdf8a070b28a',
      LICENSE: '2875a979247548431aa55a481c8cf68b12d437cf8cbca76be6d68f787678ecaa',
      'crates/hraness-cli-kit/Cargo.toml': 'a3d5e378fc7ea29b84eae033fc49d649fc7b939a8324ee4a0ba1f20424783230',
      'crates/hraness-cli-kit/src/audience.rs': '46abd8062e785959496a4d88472c4548cc40aeb21112d4c3f89645ef7242215c',
      'crates/hraness-cli-kit/src/clap.rs': '2b8c0aa3b673f667eefb9abdd0b863a04c7476fb32ea0dcef9ca291de0c23c7a',
      'crates/hraness-cli-kit/src/json.rs': 'c0ae3333ed77dd0dbb775cd19833d944473f44fc7eafba048136bc024df6fb5b',
      'crates/hraness-cli-kit/src/lib.rs': '6b11c06fff86dbd4e0354bd96a4242480cf6a3600fa4cf86be2eb8903e8c2414',
      'crates/hraness-cli-kit/src/permissions.rs': 'e5f4227d4c09c4c1076c94b39627f2b40c0e85abbd5da8b967810d3b7eff12d4',
      'crates/hraness-cli-kit/src/style.rs': '51ff00727a6d36647c93c228163427a77db7a20a72e3ac2e3a11d2f6f7604c18',
      'crates/hraness-cli-kit/tests/contract.rs': '1da527f0603614c790df04acbeb88a991251a028887fe7fc944ead03a71987eb',
    },
  },
};
export const GIT_SOURCES = Object.freeze(Object.fromEntries(Object.entries(entries)
  .map(([source, record]) => [source, Object.freeze({ ...record, files: Object.freeze(record.files) })])));

/** The one admitted record for an exact locked source string, or null. */
export function admittedGitSource(source) {
  return Object.hasOwn(GIT_SOURCES, source) ? GIT_SOURCES[source] : null;
}
