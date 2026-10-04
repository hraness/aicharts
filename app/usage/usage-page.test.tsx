import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import UsagePage from "./page";
import { usageInstallPlatforms, usageLinuxInstallCommand, usageMacInstallCommand, usageMacSourceCommand } from "./install";
import { usageCliRelease, usageReleaseTag, usageReleaseUrl } from "@/lib/usage-cli-release";

describe("usage page", () => {
  const markup = renderToStaticMarkup(createElement(UsagePage));

  test("points at the pinned collector release and preserves the account-sync limit", () => {
    expect(markup).toContain(`<a href="${usageReleaseUrl}">GitHub Releases</a>`);
    expect(markup).toContain("Account sync runs on macOS only.");
    expect(markup).not.toContain("no packaged release yet");
    expect(markup).not.toMatch(/v?0\.1\.0/u);
  });

  test("offers all three platform tabs without inventing a Windows install", () => {
    expect(usageInstallPlatforms.map(({ id }) => id)).toEqual(["macos", "linux", "windows"]);
    expect(markup.match(/role="tab"/gu)).toHaveLength(3);
    expect(markup).toContain('aria-label="Collector platform"');
    expect(markup).toContain('data-hraness-platform-badges=""');
    expect(usageInstallPlatforms[2]).toMatchObject({ unavailable: true });
    expect(usageInstallPlatforms[2]).not.toHaveProperty("command");
    expect(usageInstallPlatforms[0]).toMatchObject({ command: usageMacInstallCommand });
    expect(usageInstallPlatforms[0]).not.toHaveProperty("unavailable");
    expect(usageMacInstallCommand).toContain(`gh release download ${usageReleaseTag} --repo hraness/aicharts --pattern 'aicharts-${usageCliRelease.version}-aarch64-apple-darwin.tar.gz*'`);
    expect(usageMacInstallCommand).toContain(`shasum -a 256 -c aicharts-${usageCliRelease.version}-aarch64-apple-darwin.tar.gz.sha256`);
    expect(usageMacInstallCommand).toContain("--signer-workflow hraness/aicharts/.github/workflows/cli-publish.yml --deny-self-hosted-runners");
    expect(usageMacSourceCommand).toContain(`--rev ${usageCliRelease.sourceCommit}`);
    expect(usageMacSourceCommand).toContain(`cargo +${usageCliRelease.rustToolchain} install --locked`);
    expect(usageLinuxInstallCommand).toContain(`gh release download ${usageReleaseTag}`);
  });

  test("keeps the source-build and Linux guides on the published release", async () => {
    const linuxGuide = await Bun.file(new URL("../../distribution/cli/docs/usage-install.md", import.meta.url)).text();
    const localGuide = await Bun.file(new URL("../../docs/usage-local.md", import.meta.url)).text();
    expect(linuxGuide).toContain(`aicharts_version=${usageCliRelease.version}`);
    expect(linuxGuide).toContain(usageCliRelease.sourceCommit);
    expect(linuxGuide).toContain("--signer-workflow hraness/aicharts/.github/workflows/cli-publish.yml");
    expect(linuxGuide).toContain("--deny-self-hosted-runners");
    expect(localGuide).toContain(usageMacInstallCommand);
    expect(localGuide).toContain(usageMacSourceCommand);
  });

  test("names similar local-log tools with a checked date", () => {
    const similarAt = markup.indexOf('<h2 id="usage-similar-title">Similar tools</h2>');
    expect(similarAt).toBeGreaterThan(markup.indexOf('id="usage-title"'));
    expect(similarAt).toBeLessThan(markup.indexOf('id="usage-setup-title"'));
    expect(markup).toContain('<a href="https://ccusage.com">ccusage</a>');
    expect(markup).toContain('<a href="https://tokscale.ai">Tokscale</a>');
    expect(markup).toContain("Checked Sep 28, 2026.");
  });
});
