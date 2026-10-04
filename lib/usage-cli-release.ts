/** Published CLI release, checked against its assets and attestations on 2026-10-04.
 * Linux qualification: https://github.com/hraness/aicharts/actions/runs/37233364946
 * macOS qualification: https://github.com/hraness/aicharts/actions/runs/37233366601
 * Publication: https://github.com/hraness/aicharts/actions/runs/37233748701
 */
export const usageCliRelease = {
  version: "0.3.1",
  sourceCommit: "fc8efdbe34e5358a5027822a013fa7b3c3b720bf",
  rustToolchain: "1.97.1",
  linuxTarget: "x86_64-unknown-linux-gnu",
  macTarget: "aarch64-apple-darwin",
} as const;

export const usageReleaseTag = `cli-v${usageCliRelease.version}`;
export const usageReleaseUrl = `https://github.com/hraness/aicharts/releases/tag/${usageReleaseTag}`;
export const usageLinuxDirectory = `aicharts-${usageCliRelease.version}-${usageCliRelease.linuxTarget}`;
export const usageLinuxArchive = `${usageLinuxDirectory}.tar.gz`;
export const usageMacDirectory = `aicharts-${usageCliRelease.version}-${usageCliRelease.macTarget}`;
export const usageMacArchive = `${usageMacDirectory}.tar.gz`;
