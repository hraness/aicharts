import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { run, runStandalone, CATALOG } from './atlas.mjs';

const execute = promisify(execFile);
const stamp = '2026-09-16T00:00:00Z';
const catalog = {
  schemaVersion: 1, contentModifiedAt: stamp, name: 'Synthetic catalog', description: 'Fixture only.',
  comparisonPolicy: 'Keep cohorts separate.', reuseNotice: 'Synthetic data.',
  entries: [{ id: 'fixture', name: 'Fixture', version: '1', category: 'coding', question: 'Fixture question?',
    summary: 'Fixture summary.', measure: 'Fixture measure.', comparisonRule: 'One fixture.',
    source: { name: 'Fixture', url: 'https://example.com/source' }, limitations: ['Synthetic'], tags: [],
    coverage: 'source-only', dataset: null, explorationUrl: 'https://aicharts.io/benchmarks?atlas=fixture#explore' }],
};
function benchmark() {
  let requests = 0;
  return { now: () => stamp, fetchImpl: async url => {
    assert.equal(url, CATALOG); requests++;
    return new Response(JSON.stringify(catalog), { headers: { 'content-type': 'application/json' } });
  }, requests: () => requests };
}
function sink(fail = false) {
  let text = '';
  return { isTTY: false, write(chunk, callback) {
    if (!fail) text += chunk;
    callback?.(fail ? new Error('synthetic output failure') : undefined);
    return !fail;
  }, read: () => text };
}
async function fixture(t, extraEnv = {}) {
  const root = await mkdtemp(join(tmpdir(), 'aicharts-skill-support-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, options: { command: [process.execPath, '/reviewed skill/atlas.mjs'],
    env: { XDG_STATE_HOME: root, HRANESS_SUPPORT_EMAIL: 'off', ...extraEnv }, gitEmail: false } };
}

test('protocol, help, invalid commands and failed output do not contact the catalog or reserve an offer', async t => {
  const f = await fixture(t);
  for (const [args, code] of [[['support', 'protocol', '--json'], 0], [['--help'], 0], [['invalid'], 1]]) {
    const stdout = sink(), stderr = sink(), transport = benchmark();
    assert.equal(await runStandalone(args, { stdout, stderr, support: f.options, ...transport }), code);
    assert.equal(transport.requests(), 0);
    if (args[0] === 'support') {
      const protocol = JSON.parse(stdout.read());
      assert.equal(protocol.offer.product.id, 'aicharts');
      for (const argv of Object.values(protocol.commands)) assert.deepEqual(argv.slice(0, 2), f.options.command);
    }
  }
  assert.deepEqual(await readdir(f.root), []);
  assert.equal(await runStandalone(['catalog'], { stdout: sink(true), stderr: sink(), support: f.options, ...benchmark() }), 1);
  assert.deepEqual(await readdir(f.root), []);
});

test('standalone completed read preserves JSON and discovers once without claiming presentation', async t => {
  const f = await fixture(t);
  const expected = `${JSON.stringify(await run(['catalog'], benchmark()), null, 2)}\n`;
  const first = sink(), second = sink(), stdout = sink();
  assert.equal(await runStandalone(['catalog'], { stdout, stderr: first, support: f.options, ...benchmark() }), 0);
  assert.equal(stdout.read(), expected);
  const discovery = JSON.parse(first.read());
  assert.deepEqual(discovery.protocol, [...f.options.command, 'support', 'protocol', '--json']);
  const discoveryFields = { ...discovery };
  delete discoveryFields.protocol;
  assert.doesNotMatch(JSON.stringify(discoveryFields), /emailSuggestion|@|https:\/\/account/u);
  assert.equal(await runStandalone(['catalog'], { stdout: sink(), stderr: second, support: f.options, ...benchmark() }), 0);
  assert.equal(second.read(), '');
  const call = async args => {
    const out = sink(), err = sink();
    assert.equal(await runStandalone(['support', ...args], { stdout: out, stderr: err, support: f.options }), 0);
    assert.equal(err.read(), '');
    return JSON.parse(out.read());
  };
  const offer = await call(['offer', '--json']);
  assert.equal(offer.kind, 'offer');
  assert.equal(offer.invitation.emailSuggestion, undefined);
  assert.equal(offer.invitation.actions.length, 2);
  assert.equal((await call(['offer', '--json'])).kind, 'quiet');
  assert.equal((await call(['shown', offer.invitation.id])).kind, 'shown');
  assert.equal((await call(['offer', '--json'])).kind, 'quiet');
  assert.equal((await call(['dismiss'])).kind, 'dismissed');
  assert.equal((await call(['status', '--json'])).optedOut, true);
});

test('CI, delegated children and explicit opt-out preserve useful output without preference writes', async t => {
  for (const env of [{ CI: 'true' }, { HRANESS_SUPPORT_AUDIENCE: 'off' }, { HRANESS_SUPPORT: 'off' }]) {
    const f = await fixture(t, env), stdout = sink(), stderr = sink();
    assert.equal(await runStandalone(['catalog'], { stdout, stderr, support: f.options, ...benchmark() }), 0);
    assert.equal(JSON.parse(stdout.read()).catalog.name, catalog.name);
    assert.equal(stderr.read(), '');
    assert.deepEqual(await readdir(f.root), []);
  }
});

test('imported benchmark runner stays quiet and the whole skill relocates without node_modules', async t => {
  const f = await fixture(t);
  assert.equal((await run(['catalog'], benchmark())).catalog.name, catalog.name);
  assert.deepEqual(await readdir(f.root), []);
  const destination = join(f.root, 'relocated skill');
  await cp(new URL('../', import.meta.url), destination, { recursive: true });
  const entry = join(destination, 'scripts/atlas.mjs');
  const env = { PATH: '/usr/bin:/bin', XDG_STATE_HOME: join(f.root, 'state'), HRANESS_SUPPORT_EMAIL: 'off' };
  const protocol = await execute(process.execPath, [entry, 'support', 'protocol', '--json'], { cwd: f.root, env, timeout: 5000 });
  assert.equal(protocol.stderr, '');
  const parsed = JSON.parse(protocol.stdout);
  for (const argv of Object.values(parsed.commands)) assert.deepEqual(argv.slice(0, 2), [process.execPath, entry]);
  assert.deepEqual((await readdir(f.root)).sort(), ['relocated skill']);
  const offer = await execute(parsed.commands.offer[0], parsed.commands.offer.slice(1), { cwd: f.root, env, timeout: 5000 });
  assert.equal(JSON.parse(offer.stdout).kind, 'offer');
});
