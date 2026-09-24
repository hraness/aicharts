import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { qualificationSchema, selectedTests, validateResults, validateRoster, type ProcessResult } from "./assurance-adapters";

const manifest = qualificationSchema.parse(JSON.parse(readFileSync("vendor/tokscale-core/QUALIFICATION.json", "utf8")) as unknown);
const result = (output: string, fields: Partial<ProcessResult> = {}): ProcessResult => ({
  code: 0, signal: null, output, timedOut: false, outputExceeded: false, ...fields,
});
const fixture = { ...manifest, groups: [{ id: "codex", prefix: "sessions::codex::tests::", expectedTests: 2 }] };
const names = ["sessions::codex::tests::append", "sessions::codex::tests::rewrite"];
const discovery = `${names.map(name => `${name}: test`).join("\n")}\n\n2 tests, 0 benchmarks\n`;
const completed = `${names.map(name => `test ${name} ... ok`).join("\n")}\n\ntest result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 193 filtered out; finished in 0.01s\n`;

test("every advertised selector has its own explicit evidence classification", () => {
  const registry = JSON.parse(readFileSync("data/usage-registry.json", "utf8")) as { clients: { id: string }[] };
  expect(() => validateRoster(manifest, registry.clients.map(client => client.id))).not.toThrow();
  expect(manifest.adapters.filter(adapter => adapter.qualification === "fixture-supported").map(adapter => adapter.selector))
    .toEqual(["claude", "codex", "cursor", "devin-cli", "devin-desktop"]);
  expect(manifest.adapters.find(adapter => adapter.selector === "9router")?.owner).toBe("gjc");
  expect(() => validateRoster({ ...manifest, adapters: manifest.adapters.slice(1) }, registry.clients.map(client => client.id))).toThrow();
  const unjustified = { ...manifest, adapters: manifest.adapters.map(adapter => adapter.selector === "amp"
    ? { ...adapter, qualification: "fixture-supported" as const } : adapter) };
  expect(() => validateRoster(unjustified, registry.clients.map(client => client.id))).toThrow();
  const falseFamily = { ...manifest, adapters: manifest.adapters.map(adapter => adapter.selector === "amp"
    ? { ...adapter, qualification: "fixture-supported" as const, testGroups: ["codex", "offline"] } : adapter) };
  expect(() => validateRoster(falseFamily, registry.clients.map(client => client.id))).toThrow();
  const wrongKnownFamily = { ...manifest, adapters: manifest.adapters.map(adapter => adapter.selector === "cursor"
    ? { ...adapter, testGroups: ["codex", "offline"] } : adapter) };
  expect(() => validateRoster(wrongKnownFamily, registry.clients.map(client => client.id))).toThrow();
  const falsePrefix = { ...manifest, groups: manifest.groups.map(group => group.id === "codex"
    ? { ...group, prefix: "sessions::amp::tests::" } : group) };
  expect(() => validateRoster(falsePrefix, registry.clients.map(client => client.id))).toThrow();
});

test("discovery counts real compiled tests and rejects absent, duplicate or drifted selections", () => {
  expect(selectedTests(fixture, result(discovery))).toEqual(names);
  for (const output of ["0 tests, 0 benchmarks\n", discovery.replace("append: test", "rewrite: test"),
    discovery.replace("2 tests", "3 tests"), discovery.replace("2 tests, 0 benchmarks", "2 tests, 1 benchmarks")]) {
    expect(() => selectedTests(fixture, result(output))).toThrow();
  }
  expect(() => selectedTests(fixture, result(discovery, { timedOut: true }))).toThrow();
});

test("a terminal success requires every selected test and the matching complete summary", () => {
  expect(() => validateResults(names, result(completed))).not.toThrow();
  for (const output of [completed.replace("append ... ok", "append ... ignored"), completed.replace("2 passed", "1 passed"),
    completed.replace("0 ignored", "1 ignored"), completed.split("test result:")[0],
    completed.replace("test sessions::codex::tests::append ... ok\n", "")]) {
    expect(() => validateResults(names, result(output))).toThrow();
  }
  for (const fault of [{ code: 1 }, { signal: "SIGKILL" }, { timedOut: true }, { outputExceeded: true }]) {
    expect(() => validateResults(names, result(completed, fault))).toThrow();
  }
  expect(() => validateResults([], result("test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 193 filtered out; finished in 0.01s\n"))).toThrow();
});
