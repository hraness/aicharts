import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  DEFAULT_IDENTIFIER,
  IDENTITY_NAME,
  countIdentityCertificates,
  dispatch,
  findCertificateArguments,
  parseDesignatedRequirement,
  qualifiedBinary,
  requirementArguments,
  signArguments,
  signBinary,
  validIdentifier,
  verifyArguments,
  type CommandResult,
} from "./custody-signing";

const FIND_CERTIFICATE_ROW = `keychain: "/Users/x/Library/Keychains/login.keychain-db"
    "alis"<blob>="AI Charts Custody (Local)"
    "ctyp"<uint32>=0x00000001
`;

const explodingRunner = (): Promise<CommandResult> => {
  throw new Error("runner must not spawn during this assertion");
};

test("find-certificate argv targets the exact login keychain path", () => {
  const argv = findCertificateArguments(IDENTITY_NAME);
  expect(argv.slice(0, 5)).toEqual([
    "security", "find-certificate", "-c", IDENTITY_NAME, "-a",
  ]);
  expect(argv[5]).toEndWith("Library/Keychains/login.keychain-db");
});

test("identity certificate counting requires exact alis rows", () => {
  expect(countIdentityCertificates(FIND_CERTIFICATE_ROW)).toBe(1);
  expect(countIdentityCertificates(FIND_CERTIFICATE_ROW + FIND_CERTIFICATE_ROW)).toBe(2);
  for (const none of [
    "",
    'keychain: "/x"\n    "alis"<blob>="AI Charts Custody"\n', // prefix is not exact
    '    "labl"<blob>="AI Charts Custody (Local)"\n',
    `    "alis"<blob>="AI Charts Custody (Local)x"\n`,
  ]) {
    expect(countIdentityCertificates(none)).toBe(0);
  }
});

test("signing and verification argv are exact and closed", () => {
  expect(signArguments(IDENTITY_NAME, DEFAULT_IDENTIFIER, "/tmp/bin/aicharts")).toEqual([
    "codesign", "--force", "--sign", IDENTITY_NAME,
    "--identifier", DEFAULT_IDENTIFIER,
    "--timestamp=none", "/tmp/bin/aicharts",
  ]);
  expect(verifyArguments("/tmp/bin/aicharts")).toEqual([
    "codesign", "--verify", "--strict", "/tmp/bin/aicharts",
  ]);
  expect(requirementArguments("/tmp/bin/aicharts")).toEqual([
    "codesign", "-d", "-r-", "/tmp/bin/aicharts",
  ]);
});

test("identifier validation is a closed reverse-DNS token", () => {
  expect(validIdentifier("io.aicharts.cli")).toBe(true);
  expect(validIdentifier("io.aicharts.menubar-2")).toBe(true);
  for (const bad of [
    "",
    " ",
    "-io.aicharts.cli",
    ".io.aicharts.cli",
    "io/aicharts",
    "io aicharts",
    "io;aicharts",
    "io.aicharts.cli$(whoami)",
    "io.aicharts.cli`id`",
    "a".repeat(128),
    "io.aicharts.cli\nrm -rf /",
  ]) {
    expect(validIdentifier(bad)).toBe(false);
  }
});

test("designated requirement parsing accepts only the marked line", () => {
  const output = [
    "Executable=/tmp/aicharts",
    'designated => identifier "io.aicharts.cli" and certificate leaf = H"3c576cc6"',
  ].join("\n");
  expect(parseDesignatedRequirement(output)).toBe(
    'designated => identifier "io.aicharts.cli" and certificate leaf = H"3c576cc6"',
  );
  expect(parseDesignatedRequirement("Executable=/tmp/aicharts\n")).toBeNull();
  expect(parseDesignatedRequirement("")).toBeNull();
});

test("binary qualification refuses missing, symlink and non-executable paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "aicharts-sign-test-"));
  try {
    const binary = join(root, "aicharts");
    await writeFile(binary, "#!/bin/sh\n");
    await chmod(binary, 0o700);
    expect(await qualifiedBinary(binary)).toBe(true);
    const linked = join(root, "linked");
    await symlink(binary, linked);
    expect(await qualifiedBinary(linked)).toBe(false);
    await chmod(binary, 0o600);
    expect(await qualifiedBinary(binary)).toBe(false);
    expect(await qualifiedBinary(join(root, "absent"))).toBe(false);
    expect(await qualifiedBinary(root)).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sign refuses unqualified paths and bad identifiers before any spawn", async () => {
  const root = await mkdtemp(join(tmpdir(), "aicharts-sign-test-"));
  try {
    expect(await signBinary(join(root, "missing"), DEFAULT_IDENTIFIER, explodingRunner)).toBe(2);
    expect(await signBinary("/relative/path", DEFAULT_IDENTIFIER, explodingRunner)).toBe(2);
    const binary = join(root, "aicharts");
    await writeFile(binary, "x");
    await chmod(binary, 0o700);
    expect(await signBinary(binary, "bad ident", explodingRunner)).toBe(2);
    // A qualified path reaches the certificate lookup; a lookup failure is 1.
    expect(
      await signBinary(binary, DEFAULT_IDENTIFIER, async () => ({
        code: 1,
        stdout: "",
        stderr: "",
      })),
    ).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dispatch covers the closed command surface", async () => {
  expect(await dispatch([])).toBe(2);
  expect(await dispatch(["bogus"])).toBe(2);
  expect(await dispatch(["sign"])).toBe(2);
  expect(await dispatch(["sign", "--binary"])).toBe(2);
  expect(await dispatch(["sign", "--binary", "/x", "--binary", "/y"])).toBe(2);
  expect(
    await dispatch(["sign", "--binary", "/x", "--identifier", "io.aicharts.cli", "--identifier", "io.aicharts.other"]),
  ).toBe(2);
  expect(await dispatch(["sign", "--binary", "/x", "stray"])).toBe(2);
  // Status reports a lookup failure and an absent identity without spawning
  // further commands.
  expect(
    await dispatch(["status"], async () => ({ code: 1, stdout: "", stderr: "" })),
  ).toBe(1);
  expect(
    await dispatch(["status"], async () => ({ code: 0, stdout: "", stderr: "" })),
  ).toBe(1);
  // One certificate plus a working scratch sign/verify reports usable. The
  // probe runs codesign on a copy of /bin/true, never on the target.
  expect(
    await dispatch(["status"], async (argv) => ({
      code: 0,
      stdout: argv[0] === "security" ? FIND_CERTIFICATE_ROW : "",
      stderr: "",
    })),
  ).toBe(0);
});
