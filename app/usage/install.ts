import type { PlatformInstallTarget } from "@hraness/design-kit/react";

import {
  usageCliRelease,
  usageLinuxArchive,
  usageLinuxDirectory,
  usageMacArchive,
  usageMacDirectory,
  usageReleaseTag,
} from "@/lib/usage-cli-release";

const downloadDirectory = `aicharts-${usageReleaseTag}`;

export const usageMacSourceCommand = `cargo +${usageCliRelease.rustToolchain} install --locked --git https://github.com/hraness/aicharts --rev ${usageCliRelease.sourceCommit} aicharts-cli`;

// The Mac archive has its own checksum file beside the Linux SHA256SUMS; the
// same publishing-workflow attestation is checked before extraction.
export const usageMacInstallCommand = [
  `mkdir ${downloadDirectory}`,
  `(cd ${downloadDirectory}`,
  `gh release download ${usageReleaseTag} --repo hraness/aicharts --pattern '${usageMacArchive}*'`,
  `shasum -a 256 -c ${usageMacArchive}.sha256`,
  `gh attestation verify ${usageMacArchive} --repo hraness/aicharts --signer-workflow hraness/aicharts/.github/workflows/cli-publish.yml --deny-self-hosted-runners`,
  `tar -xzf ${usageMacArchive})`,
  `export PATH="$PWD/${downloadDirectory}/${usageMacDirectory}/bin:$PATH"`,
].join(" && ");

// A new directory prevents an accidental overwrite; extraction follows both
// checksum and workflow-attestation verification. PATH changes only this shell.
export const usageLinuxInstallCommand = [
  `mkdir ${downloadDirectory}`,
  `(cd ${downloadDirectory}`,
  `gh release download ${usageReleaseTag} --repo hraness/aicharts`,
  "sha256sum --check --strict SHA256SUMS",
  'for asset in *.tar.gz release-manifest.json; do gh attestation verify "$asset" --repo hraness/aicharts --signer-workflow hraness/aicharts/.github/workflows/cli-publish.yml --deny-self-hosted-runners || exit; done',
  `tar -xzf ${usageLinuxArchive})`,
  `export PATH="$PWD/${downloadDirectory}/${usageLinuxDirectory}/bin:$PATH"`,
].join(" && ");

export const usageInstallPlatforms = [
  {
    id: "macos",
    command: usageMacInstallCommand,
    shell: "Terminal",
    note: "Apple silicon. Signed with Developer ID and notarized by Apple. Requires GitHub CLI. Adds aicharts to this terminal's PATH for local reports.",
  },
  {
    id: "linux",
    command: usageLinuxInstallCommand,
    shell: "Terminal",
    note: "x86_64, glibc 2.35+. Requires GitHub CLI. Adds aicharts to this terminal's PATH for local reports.",
  },
  {
    id: "windows",
    unavailable: true,
    unavailableNote: "Windows installation and credential storage have not been tested for release. Use the Mac or Linux build on those systems.",
  },
] as const satisfies readonly PlatformInstallTarget[];
