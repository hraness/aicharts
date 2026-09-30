import type { PlatformInstallTarget } from "@hraness/design-kit/react";

import {
  usageCliRelease,
  usageLinuxArchive,
  usageLinuxDirectory,
  usageReleaseTag,
} from "@/lib/usage-cli-release";

const downloadDirectory = `aicharts-${usageReleaseTag}`;

export const usageMacInstallCommand = `cargo +${usageCliRelease.rustToolchain} install --locked --git https://github.com/hraness/aicharts --rev ${usageCliRelease.sourceCommit} aicharts-cli`;

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
    unavailable: true,
    unavailableNote: "Build from source; a signed macOS download is not available.",
    command: usageMacInstallCommand,
    shell: "Terminal",
    note: `Requires Rust ${usageCliRelease.rustToolchain} and a C compiler. Cargo installs aicharts in ~/.cargo/bin.`,
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
    unavailableNote: "Windows installation and credential storage have not been tested for release. Use the Linux build on a Linux machine or build from source on a Mac.",
  },
] as const satisfies readonly PlatformInstallTarget[];
