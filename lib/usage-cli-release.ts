/** Published CLI release, checked against its assets and attestations on 2026-10-05.
 * Linux qualification: https://github.com/hraness/aicharts/actions/runs/37350385653
 * macOS qualification: https://github.com/hraness/aicharts/actions/runs/37350389304
 * Publication: https://github.com/hraness/aicharts/actions/runs/37351093830
 */
export const usageCliRelease = {
  version: "0.4.0",
  sourceCommit: "7ef97280e1b7897597ae5ca9fa46c82d606a41ed",
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
