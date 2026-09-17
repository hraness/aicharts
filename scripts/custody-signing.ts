/*
 * `bun run custody:signing` manages the stable local code-signing identity the
 * macOS credential-custody items trust. An ad hoc signed build changes its code
 * hash on every compile, so keychain items created by one build refuse the
 * next; signing with one persistent identity binds each item's ACL to that
 * identity instead of the hash. This is local self-signed custody only — it is
 * not release signing, notarization, or a distribution claim.
 *
 * `security find-identity` reports only policy-valid identities, which a
 * self-signed certificate never is; presence is detected with
 * `find-certificate` and the signing identity is addressed by its common name.
 * `codesign` itself proves the private key exists when it signs.
 *
 * Commands: `status`, `ensure`, `sign --binary PATH [--identifier ID]`.
 */

import { copyFile, lstat, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

export const IDENTITY_NAME = "AI Charts Custody (Local)";
export const DEFAULT_IDENTIFIER = "io.aicharts.cli";
const CERTIFICATE_DAYS = "3650";
const LOGIN_KEYCHAIN = join(homedir(), "Library", "Keychains", "login.keychain-db");
const PROBE_BINARY = "/usr/bin/true";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (argv: string[]) => Promise<CommandResult>;

async function run(argv: string[]): Promise<CommandResult> {
  const child = spawn(argv[0], argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  return await new Promise((resolveResult) => {
    child.once("error", (error) =>
      resolveResult({ code: 127, stdout: "", stderr: String(error) }),
    );
    child.once("exit", (value) =>
      resolveResult({
        code: value ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
}

export function findCertificateArguments(name: string): string[] {
  return ["security", "find-certificate", "-c", name, "-a", LOGIN_KEYCHAIN];
}

/** Count exact `alis` rows for the custody identity in find-certificate output. */
export function countIdentityCertificates(output: string, name = IDENTITY_NAME): number {
  return output
    .split("\n")
    .filter((line) => line.includes(`"alis"<blob>="${name}"`)).length;
}

export function signArguments(name: string, identifier: string, binary: string): string[] {
  return [
    "codesign",
    "--force",
    "--sign", name,
    "--identifier", identifier,
    "--timestamp=none",
    binary,
  ];
}

export function verifyArguments(binary: string): string[] {
  return ["codesign", "--verify", "--strict", binary];
}

export function requirementArguments(binary: string): string[] {
  return ["codesign", "-d", "-r-", binary];
}

/** Extract the designated requirement expression from `codesign -d -r-`. */
export function parseDesignatedRequirement(output: string): string | null {
  const line = output
    .split("\n")
    .find((entry) => entry.trimStart().startsWith("designated =>"));
  return line === undefined ? null : line.trim();
}

/** The binary must be an absolute, non-symlink, executable regular file. */
export async function qualifiedBinary(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isFile() && (info.mode & 0o111) !== 0 && (info.mode & 0o022) === 0;
  } catch {
    return false;
  }
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,126})$/;

/** A signing identifier is a bounded reverse-DNS token, never a shell value. */
export function validIdentifier(value: string): boolean {
  return IDENTIFIER_PATTERN.test(value);
}

/**
 * Prove the identity's private key actually signs: a copy of a system binary
 * is signed and verified in a scratch directory. `codesign` fails here when
 * the certificate exists without its key.
 */
async function probeIdentity(name: string, runner: Runner): Promise<boolean> {
  const scratch = await mkdtemp(join(tmpdir(), "aicharts-custody-probe-"));
  try {
    const probe = join(scratch, "probe");
    await copyFile(PROBE_BINARY, probe);
    const signed = await runner(
      signArguments(name, `${DEFAULT_IDENTIFIER}.probe`, probe),
    );
    if (signed.code !== 0) return false;
    return (await runner(verifyArguments(probe))).code === 0;
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Ensure the stable custody identity exists and can sign. Returns the
 * identity name when ready, or null. A second same-named certificate is
 * ambiguous and refuses — resolving it is an explicit operator decision.
 */
export async function ensureIdentity(runner: Runner = run): Promise<string | null> {
  const present = async (): Promise<number> => {
    const found = await runner(findCertificateArguments(IDENTITY_NAME));
    return found.code === 0
      ? countIdentityCertificates(found.stdout)
      : -1;
  };
  let count = await present();
  if (count > 1 || count < 0) return null;
  if (count === 0) {
    const scratch = await mkdtemp(join(tmpdir(), "aicharts-custody-sign-"));
    try {
      const keyPath = join(scratch, "identity.key");
      const certPath = join(scratch, "identity.crt");
      const bundlePath = join(scratch, "identity.p12");
      const bundlePassword = randomBytes(18).toString("base64");
      const generated = await runner([
        "openssl", "req", "-x509", "-newkey", "rsa:2048",
        "-keyout", keyPath, "-out", certPath,
        "-days", CERTIFICATE_DAYS, "-nodes",
        "-subj", `/CN=${IDENTITY_NAME}`,
        "-addext", "keyUsage=critical,digitalSignature",
        "-addext", "extendedKeyUsage=critical,codeSigning",
        "-addext", "basicConstraints=critical,CA:FALSE",
      ]);
      if (generated.code !== 0) return null;
      // The system importer reads only legacy PKCS12 encryption and MAC.
      const bundled = await runner([
        "openssl", "pkcs12", "-export", "-legacy",
        "-inkey", keyPath, "-in", certPath,
        "-out", bundlePath, "-passout", `pass:${bundlePassword}`,
        "-name", IDENTITY_NAME,
      ]);
      if (bundled.code !== 0) return null;
      // `-A` lets codesign use the imported key without a per-key consent
      // prompt; the identity is a self-signed local custody anchor, not a
      // trusted CA.
      const imported = await runner([
        "security", "import", bundlePath,
        "-k", LOGIN_KEYCHAIN, "-P", bundlePassword, "-A",
      ]);
      if (imported.code !== 0) return null;
    } finally {
      await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
    count = await present();
    if (count !== 1) return null;
  }
  return (await probeIdentity(IDENTITY_NAME, runner)) ? IDENTITY_NAME : null;
}

/** Sign one qualified binary with the stable identity and verify the result. */
export async function signBinary(
  binary: string,
  identifier = DEFAULT_IDENTIFIER,
  runner: Runner = run,
): Promise<number> {
  if (!isAbsolute(binary) || !(await qualifiedBinary(binary))) {
    console.error("sign requires an absolute path to a non-symlink executable regular file");
    return 2;
  }
  if (!validIdentifier(identifier)) {
    console.error("invalid signing identifier");
    return 2;
  }
  const name = await ensureIdentity(runner);
  if (name === null) {
    console.error(`custody signing identity "${IDENTITY_NAME}" unavailable`);
    return 1;
  }
  const signed = await runner(signArguments(name, identifier, binary));
  if (signed.code !== 0) {
    console.error("codesign refused the binary");
    return 1;
  }
  const verified = await runner(verifyArguments(binary));
  if (verified.code !== 0) {
    console.error("codesign verification failed after signing");
    return 1;
  }
  const requirement = await runner(requirementArguments(binary));
  const designated =
    requirement.code === 0 ? parseDesignatedRequirement(requirement.stdout) : null;
  if (
    designated === null ||
    !designated.includes(`identifier "${identifier}"`) ||
    !designated.includes("certificate leaf")
  ) {
    console.error("signed binary does not carry the expected certificate-bound requirement");
    return 1;
  }
  console.log(`Signed ${binary} as ${identifier} under "${IDENTITY_NAME}"`);
  return 0;
}

export async function custodyStatus(runner: Runner = run): Promise<number> {
  const found = await runner(findCertificateArguments(IDENTITY_NAME));
  if (found.code !== 0) {
    console.error("cannot query the login keychain");
    return 1;
  }
  const count = countIdentityCertificates(found.stdout);
  if (count === 0) {
    console.log(`custody signing identity "${IDENTITY_NAME}" not installed`);
    return 1;
  }
  if (count !== 1) {
    console.error("duplicate custody signing identities; remove extras manually");
    return 1;
  }
  const usable = await probeIdentity(IDENTITY_NAME, runner);
  if (!usable) {
    console.error("custody signing certificate exists but cannot sign (key missing?)");
    return 1;
  }
  console.log(`custody signing identity present and usable: ${IDENTITY_NAME}`);
  return 0;
}

function usage(): number {
  console.error(
    "Usage: bun run custody:signing [status|ensure|sign --binary PATH [--identifier ID]]",
  );
  return 2;
}

export async function dispatch(argv: string[], runner: Runner = run): Promise<number> {
  const command = argv[0];
  if (command === "status") return await custodyStatus(runner);
  if (command === "ensure") {
    const name = await ensureIdentity(runner);
    if (name === null) {
      console.error(`could not ensure "${IDENTITY_NAME}"`);
      return 1;
    }
    console.log(`custody signing identity ready: ${IDENTITY_NAME}`);
    return 0;
  }
  if (command === "sign") {
    let binary: string | undefined;
    let identifier = DEFAULT_IDENTIFIER;
    let identifierSeen = false;
    for (let i = 1; i < argv.length; i += 2) {
      const value = argv[i + 1];
      if (value === undefined) return usage();
      if (argv[i] === "--binary" && binary === undefined) {
        binary = value;
      } else if (argv[i] === "--identifier" && !identifierSeen) {
        identifier = value;
        identifierSeen = true;
      } else {
        return usage();
      }
    }
    if (binary === undefined) return usage();
    return await signBinary(resolve(binary), identifier, runner);
  }
  return usage();
}

if (import.meta.main) {
  const code = await dispatch(process.argv.slice(2));
  if (code !== 0) process.exit(code);
}
