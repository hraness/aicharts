// One immutable reviewed Git dependency, including every compiled source input.
// Other Git URLs, revisions, packages and license bytes remain inadmissible.
export const SUPPORT_REVISION = 'ed89e584c2c420e3e0547bbe8f32baf8e3a2ae4d';
export const SUPPORT_SOURCE = `git+https://github.com/hraness/support-foundation?rev=${SUPPORT_REVISION}#${SUPPORT_REVISION}`;
export const SUPPORT_FILES = Object.freeze({
  'Cargo.toml': '4e68521cb77b121e52ca7ea36b97e04eb4be3e39cb7dfcd35ffdf25b58abc689',
  LICENSE: '74b69bf37c8f340c9c2a54d431a15218738d9c463d0e014fa6a8bb8edce4e539',
  'rust/Cargo.toml': 'ec931d1bf5e9f04168b47994c48d796d5eec5203131736b2e4695869f328e347',
  'rust/src/lib.rs': '8fec4a89dcee42059ea9c703a099eb7350258ae540bf8aa031a902b9e303d532',
  'rust/src/runtime.rs': '183b066571f1e7c03d031958943b56a9b608e7ec87069e0edd344ee5e72cbf82',
  'rust/src/state.rs': '7b9b8b214c71841c015607ed0cdfd669de84f3b818188ab425667f09580e2216',
  'rust/src/contract-v1.json': 'd7d6c28239b8afcd3819809f1ebde769c1852d1ffa0c07811b619dc02ce1170d',
});
