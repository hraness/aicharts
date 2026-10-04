/** Published CLI release, checked against its assets and attestations on 2026-10-04.
 * Qualification: https://github.com/hraness/aicharts/actions/runs/37221385303
 * Publication: https://github.com/hraness/aicharts/actions/runs/37221599811
 */
export const usageCliRelease = {
  version: "0.3.0",
  sourceCommit: "9c6a5071f88c528401b61b869d454afed5358b01",
  rustToolchain: "1.97.1",
  linuxTarget: "x86_64-unknown-linux-gnu",
} as const;

export const usageReleaseTag = `cli-v${usageCliRelease.version}`;
export const usageReleaseUrl = `https://github.com/hraness/aicharts/releases/tag/${usageReleaseTag}`;
export const usageLinuxDirectory = `aicharts-${usageCliRelease.version}-${usageCliRelease.linuxTarget}`;
export const usageLinuxArchive = `${usageLinuxDirectory}.tar.gz`;
