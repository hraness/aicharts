import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const ORIGIN = 'https://aicharts.io';
export const CATALOG = `${ORIGIN}/data/benchmark-atlas.json`;
export const MAX_BYTES = 2 * 1024 * 1024;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const datasetUrl = id => `${ORIGIN}/data/benchmark-atlas/${id}`;
class Failure extends Error {}
const requireValue = (condition, code = 'invalid_schema') => {
  if (!condition) throw new Failure(code);
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string' && value.length > 0 && value.length <= 8192;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const optionalString = value => value === undefined || string(value);
const nullableString = value => value === null || string(value);
const date = value => string(value) && Number.isFinite(Date.parse(value));
const strings = value => Array.isArray(value) && value.length <= 256 && value.every(string);
const slug = value => typeof value === 'string' && value.length <= 128 && ID.test(value);
function https(value) {
  if (!string(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch { return false; }
}
function source(value, measured = false) {
  requireValue(object(value) && string(value.name) && https(value.url));
  requireValue(value.methodologyUrl === undefined || https(value.methodologyUrl));
  if (measured) requireValue(date(value.retrievedAt) && optionalString(value.revision));
}
function score(value) {
  requireValue(object(value) && string(value.label) && string(value.unit));
  requireValue(['higher', 'lower'].includes(value.direction));
  requireValue(value.minimum === undefined || finite(value.minimum));
  requireValue(value.maximum === undefined || finite(value.maximum));
  requireValue(value.minimum === undefined || value.maximum === undefined || value.minimum < value.maximum);
}
function entry(value) {
  requireValue(object(value) && slug(value.id));
  for (const key of ['name', 'version', 'category', 'question', 'summary', 'measure', 'comparisonRule']) {
    requireValue(string(value[key]));
  }
  source(value.source);
  requireValue(strings(value.limitations) && strings(value.tags));
  requireValue(['charted', 'source-only', 'watchlist'].includes(value.coverage));
}
export function validateCatalog(value) {
  requireValue(object(value) && value.schemaVersion === 1, 'unsupported_schema');
  requireValue(date(value.contentModifiedAt));
  for (const key of ['name', 'description', 'comparisonPolicy', 'reuseNotice']) requireValue(string(value[key]));
  requireValue(Array.isArray(value.entries) && integer(value.entries.length, 1, 256), 'catalog_limit');
  const ids = new Set();
  for (const item of value.entries) {
    entry(item);
    requireValue(!ids.has(item.id), 'duplicate_id');
    ids.add(item.id);
    requireValue(item.explorationUrl === `${ORIGIN}/benchmarks?atlas=${item.id}#explore`);
    if (item.coverage !== 'charted') {
      requireValue(item.dataset === null);
      continue;
    }
    requireValue(object(item.dataset) && item.dataset.url === datasetUrl(item.id), 'invalid_dataset_url');
    requireValue(integer(item.dataset.configurationCount, 1, 2048), 'point_limit');
    score(item.dataset.score);
    source(item.dataset.source, true);
    requireValue(item.dataset.observedAt === undefined || date(item.dataset.observedAt));
    requireValue(optionalString(item.dataset.evidenceLabel) && optionalString(item.dataset.costLabel));
  }
  return value;
}
export function validateDataset(value, selected) {
  requireValue(object(value) && value.schemaVersion === 1, 'unsupported_schema');
  requireValue(Object.keys(value).every(key => ['schemaVersion', 'benchmark', 'dataset'].includes(key)));
  entry(value.benchmark);
  const { dataset: distribution, ...definition } = selected;
  delete definition.explorationUrl;
  requireValue(isDeepStrictEqual(value.benchmark, definition), 'catalog_dataset_changed');
  const data = value.dataset;
  requireValue(object(data) && data.benchmarkId === selected.id && data.version === selected.version, 'catalog_dataset_changed');
  requireValue(Array.isArray(data.points) && integer(data.points.length, 1, 2048), 'point_limit');
  requireValue(data.points.length === distribution.configurationCount, 'catalog_dataset_changed');
  for (const key of ['source', 'score', 'observedAt', 'evidenceLabel', 'costLabel']) {
    requireValue(isDeepStrictEqual(data[key], distribution[key]), 'catalog_dataset_changed');
  }
  requireValue(string(data.configurationLabel) && string(data.comparabilityNote));
  const ids = new Set();
  for (const point of data.points) {
    requireValue(object(point));
    for (const key of ['id', 'label', 'model', 'provider']) requireValue(string(point[key]));
    requireValue(!ids.has(point.id), 'duplicate_id');
    ids.add(point.id);
    requireValue(nullableString(point.harness) && nullableString(point.effort));
    requireValue(finite(point.score));
    requireValue(data.score.minimum === undefined || point.score >= data.score.minimum);
    requireValue(data.score.maximum === undefined || point.score <= data.score.maximum);
    requireValue(point.costUsd === null || (finite(point.costUsd) && point.costUsd >= 0 && string(data.costLabel)));
    requireValue(https(point.sourceUrl));
    if (point.uncertainty !== null) {
      const interval = point.uncertainty;
      requireValue(object(interval) && finite(interval.lower) && finite(interval.upper));
      requireValue(interval.lower <= point.score && interval.upper >= point.score && string(interval.label));
    }
    requireValue(point.details === undefined || (Array.isArray(point.details) && point.details.length <= 256
      && point.details.every(detail => object(detail) && string(detail.label) && string(detail.value))));
  }
  return value;
}
export function parseArgs(args) {
  const [mode, ...rest] = args;
  requireValue(mode === 'catalog' || mode === 'dataset', 'invalid_arguments');
  const id = mode === 'dataset' ? rest.shift() : undefined;
  requireValue(mode !== 'dataset' || slug(id), 'invalid_arguments');
  const options = { mode, id, query: '', offset: 0, limit: 20 };
  const seen = new Set();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    requireValue(['--query', '--offset', '--limit'].includes(flag) && !seen.has(flag) && value !== undefined, 'invalid_arguments');
    seen.add(flag);
    if (flag === '--query') {
      requireValue(mode === 'catalog' && value.length <= 200, 'invalid_arguments');
      options.query = value;
    } else {
      requireValue(/^(0|[1-9][0-9]*)$/u.test(value), 'invalid_arguments');
      options[flag.slice(2)] = Number(value);
    }
  }
  requireValue(integer(options.limit, 1, 50) && integer(options.offset, 0, mode === 'catalog' ? 255 : 2047), 'invalid_arguments');
  return options;
}
async function readJson(url, fetchImpl, signal) {
  let response;
  let reader;
  try {
    response = await fetchImpl(url, {
      method: 'GET', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' }, signal,
    });
    requireValue(response.status === 200, `http_${response.status}`);
    requireValue(!response.redirected && (!response.url || response.url === url), 'unexpected_response_url');
    requireValue(/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? ''), 'non_json_response');
    const length = response.headers.get('content-length');
    requireValue(length === null || (/^[0-9]+$/u.test(length) && Number(length) <= MAX_BYTES), 'response_limit');
    requireValue(response.body !== null, 'empty_response');
    reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    for (let count = 0; ; count++) {
      requireValue(!signal.aborted, 'request_failed');
      requireValue(count < 65536, 'response_limit');
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      requireValue(bytes <= MAX_BYTES, 'response_limit');
      chunks.push(next.value);
    }
    const body = Buffer.concat(chunks, bytes);
    let data;
    try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
    catch { throw new Failure('invalid_json'); }
    return { data, evidence: { url, sha256: createHash('sha256').update(body).digest('hex') } };
  } catch (error) {
    if (error instanceof Failure) throw error;
    throw new Failure('request_failed');
  } finally {
    if (reader) {
      try { await reader.cancel(); } catch { /* Do not print transport diagnostics. */ }
      reader.releaseLock();
    } else if (response?.body) {
      try { await response.body.cancel(); } catch { /* Also close rejected header/status bodies. */ }
    }
  }
}
function page(items, offset, limit) {
  requireValue(offset <= items.length, 'offset_out_of_range');
  const selected = items.slice(offset, offset + limit);
  return { selected, page: {
    offset, limit, returned: selected.length, total: items.length,
    nextOffset: offset + selected.length < items.length ? offset + selected.length : null,
    order: 'source',
  } };
}
export async function run(args, { fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  const options = parseArgs(args); // Reject arguments before any request.
  const signal = AbortSignal.timeout(20_000);
  const catalogResult = await readJson(CATALOG, fetchImpl, signal);
  const catalog = validateCatalog(catalogResult.data);
  const evidence = [catalogResult.evidence];
  if (options.mode === 'catalog') {
    const terms = options.query.trim().toLocaleLowerCase('en-US').split(/\s+/u).filter(Boolean);
    const matches = catalog.entries.filter(item => {
      const searchable = [item.name, item.version, item.category, item.question, item.summary, item.measure, ...item.tags]
        .join(' ').toLocaleLowerCase('en-US');
      return terms.every(term => searchable.includes(term));
    });
    const selected = page(matches, options.offset, options.limit);
    return { fetchedAt: now(), evidence, catalog: { ...catalog, entries: selected.selected },
      page: { ...selected.page, catalogTotal: catalog.entries.length } };
  }
  const selected = catalog.entries.find(item => item.id === options.id);
  requireValue(selected !== undefined, 'unknown_benchmark');
  if (selected.coverage !== 'charted') {
    return { fetchedAt: now(), evidence, catalogContentModifiedAt: catalog.contentModifiedAt,
      comparisonPolicy: catalog.comparisonPolicy, reuseNotice: catalog.reuseNotice,
      benchmark: selected, dataset: null, reason: 'no_charted_observations' };
  }
  const datasetResult = await readJson(datasetUrl(selected.id), fetchImpl, signal);
  const dataset = validateDataset(datasetResult.data, selected);
  evidence.push(datasetResult.evidence);
  const points = page(dataset.dataset.points, options.offset, options.limit);
  return { fetchedAt: now(), evidence, catalogContentModifiedAt: catalog.contentModifiedAt,
    comparisonPolicy: catalog.comparisonPolicy, reuseNotice: catalog.reuseNotice,
    schemaVersion: dataset.schemaVersion, benchmark: dataset.benchmark,
    dataset: { ...dataset.dataset, points: points.selected }, page: points.page };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(`${JSON.stringify(await run(process.argv.slice(2)), null, 2)}\n`); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ error: error instanceof Failure ? error.message : 'unexpected_failure' })}\n`);
    process.exitCode = 1;
  }
}
