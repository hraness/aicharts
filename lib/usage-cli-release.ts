/** Published CLI release, checked against its assets and attestations on 2026-09-29.
 * Qualification: https://github.com/hraness/aicharts/actions/runs/36605822635
 * Publication: https://github.com/hraness/aicharts/actions/runs/36606325096
 */
export const usageCliRelease = {
  version: "0.2.0",
  sourceCommit: "525b9f3a54e3264e4b3050522527985a13ebfad0",
  rustToolchain: "1.97.1",
  linuxTarget: "x86_64-unknown-linux-gnu",
} as const;

export const usageReleaseTag = `cli-v${usageCliRelease.version}`;
export const usageReleaseUrl = `https://github.com/hraness/aicharts/releases/tag/${usageReleaseTag}`;
export const usageLinuxDirectory = `aicharts-${usageCliRelease.version}-${usageCliRelease.linuxTarget}`;
export const usageLinuxArchive = `${usageLinuxDirectory}.tar.gz`;
