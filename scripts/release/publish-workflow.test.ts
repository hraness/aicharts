import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const source = readFileSync(new URL("../../.github/workflows/cli-publish.yml", import.meta.url), "utf8");
const workflow = parse(source);
const steps: Array<{ name?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown> }> = workflow.jobs.publish.steps;
const named = (name: string) => {
  const step = steps.find(candidate => candidate.name === name);
  if (!step) throw new Error(`missing step ${name}`);
  return step;
};

describe("immutable Linux CLI publication workflow", () => {
  test("runs for cli-v tags on the canonical repository with job-scoped write permissions and no approval gate", () => {
    expect(workflow.on).toEqual({
      push: { tags: ["cli-v*"] },
      workflow_dispatch: { inputs: { tag: { description: expect.any(String), required: true, type: "string" } } },
    });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency).toEqual({ group: "cli-publish-${{ inputs.tag || github.ref_name }}", "cancel-in-progress": false });
    expect(Object.keys(workflow.jobs)).toEqual(["publish"]);
    const job = workflow.jobs.publish;
    expect(job.if).toBe("github.repository == 'hraness/aicharts'");
    expect(job["runs-on"]).toBe("ubuntu-22.04");
    expect(job["timeout-minutes"]).toBe(30);
    expect(job.permissions).toEqual({ contents: "write", "id-token": "write", attestations: "write" });
    expect(job.environment).toBeUndefined();
    expect(job.env).toEqual({ GH_TOKEN: "${{ github.token }}", RELEASE_TAG_INPUT: "${{ inputs.tag || github.ref_name }}" });
    expect(source).not.toMatch(/secrets\.|npm publish|wrangler deploy|cargo build|cargo publish|environment:/u);
  });

  test("pins every action, checks out the resolved commit without credentials and attests the checksummed assets", () => {
    const actions = steps.filter(step => step.uses);
    expect(actions).toHaveLength(4);
    for (const action of actions) expect(action.uses).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+@[0-9a-f]{40}$/u);
    expect(actions[0].uses).toMatch(/^actions\/checkout@/u);
    expect(actions[0].with).toEqual({ ref: "${{ env.RELEASE_COMMIT }}", "persist-credentials": false, "fetch-depth": 1 });
    const attest = actions.find(action => action.uses?.startsWith("actions/attest-build-provenance@"));
    expect(attest?.with).toEqual({ "subject-checksums": "${{ env.PUBLISH_STAGING }}/artifact/assets/SHA256SUMS" });
  });

  test("republishes only a retained qualification of the exact tagged main commit and refuses an existing release", () => {
    const resolve = named("Resolve the tag to a main commit with no existing release").run ?? "";
    expect(resolve).toContain('[[ "$tag" =~ ^cli-v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$ ]]');
    expect(resolve).toContain('[[ "$status" == "identical" || "$status" == "behind" ]]');
    expect(resolve).toContain("publish_release_exists");
    const select = named("Select the newest successful qualification run of the exact commit").run ?? "";
    expect(select).toContain('--workflow cli-release.yml --branch main --commit "$RELEASE_COMMIT" --status success --event workflow_dispatch');
    const verify = named("Download and re-verify the retained qualification assets").run ?? "";
    expect(verify).toContain('--name "linux-qualification-${RELEASE_COMMIT}-${QUALIFICATION_RUN_ATTEMPT}"');
    expect(verify).toContain("node scripts/release/verify-publication.mjs");
    expect(verify).toContain("sha256sum --check --strict SHA256SUMS");
  });

  test("publishes the exact five assets plus receipts, then verifies the download and the attestations", () => {
    const publish = named("Publish the immutable GitHub Release").run ?? "";
    expect(publish).toContain('gh release create "$RELEASE_TAG" --verify-tag --latest=false');
    for (const asset of ["x86_64-unknown-linux-gnu.tar.gz", "aicharts-skill-${RELEASE_VERSION}.tar.gz", "aicharts-source-${RELEASE_VERSION}.tar.gz", "release-manifest.json", "SHA256SUMS", "qualification.json", "publication.json"]) {
      expect(publish).toContain(asset);
    }
    const verify = named("Download the published assets and verify digests and attestations").run ?? "";
    expect(verify).toContain('gh release download "$RELEASE_TAG"');
    expect(verify).toContain("sha256sum --check --strict SHA256SUMS");
    expect(verify).toContain('gh attestation verify "${verify}/${name}" --repo "$GITHUB_REPOSITORY"');
    expect(verify).toContain('--signer-workflow "${GITHUB_REPOSITORY}/.github/workflows/cli-publish.yml" --deny-self-hosted-runners');
    const receipt = steps.at(-1);
    expect(receipt?.if).toBe("always() && env.PUBLISH_STAGING != ''");
    expect(receipt?.with?.path).toBe("${{ env.PUBLISH_STAGING }}/publication.json");
    expect(receipt?.with?.["retention-days"]).toBe(90);
  });
});
