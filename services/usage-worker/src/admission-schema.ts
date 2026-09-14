// Exact SQL is the migration manifest, not an auto-repair recipe. Preserve the
// prior enrollment table verbatim and create these five tables atomically.
export const ADMISSION_SCHEMA = Object.freeze({
  usage_admission_control: `CREATE TABLE usage_admission_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  policy_version INTEGER NOT NULL CHECK (policy_version = 1),
  published_revision INTEGER NOT NULL CHECK (published_revision BETWEEN 0 AND 4096),
  committed_at_ms INTEGER NOT NULL CHECK (committed_at_ms BETWEEN 0 AND 8640000000000000),
  observed_at_ms INTEGER NOT NULL CHECK (observed_at_ms BETWEEN committed_at_ms AND 8640000000000000),
  head_count INTEGER NOT NULL CHECK (head_count BETWEEN 0 AND 100000),
  live_count INTEGER NOT NULL CHECK (live_count BETWEEN 0 AND head_count),
  quarantined INTEGER NOT NULL CHECK (quarantined IN (0, 1))
)`,
  usage_admission_devices: `CREATE TABLE usage_admission_devices (
  device_id BLOB PRIMARY KEY NOT NULL CHECK (typeof(device_id) = 'blob' AND length(device_id) = 32 AND device_id != zeroblob(32)),
  settled_sequence INTEGER NOT NULL CHECK (settled_sequence BETWEEN 0 AND 9007199254740991),
  last_batch BLOB CHECK (last_batch IS NULL OR (typeof(last_batch) = 'blob' AND length(last_batch) BETWEEN 288 AND 82024)),
  last_journal BLOB CHECK (last_journal IS NULL OR (typeof(last_journal) = 'blob' AND length(last_journal) BETWEEN 424 AND 67744)),
  CHECK ((settled_sequence = 0 AND last_batch IS NULL AND last_journal IS NULL)
    OR (settled_sequence > 0 AND last_batch IS NOT NULL AND last_journal IS NOT NULL))
) WITHOUT ROWID`,
  usage_admission_pending: `CREATE TABLE usage_admission_pending (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  phase INTEGER NOT NULL CHECK (phase IN (1, 2)),
  predecessor_revision INTEGER NOT NULL CHECK (predecessor_revision BETWEEN 0 AND 4095),
  batch BLOB NOT NULL CHECK (typeof(batch) = 'blob' AND length(batch) BETWEEN 288 AND 82024),
  journal BLOB CHECK (journal IS NULL OR (typeof(journal) = 'blob' AND length(journal) BETWEEN 424 AND 67744)),
  CHECK ((phase = 1 AND journal IS NULL) OR (phase = 2 AND journal IS NOT NULL))
)`,
  usage_admission_heads: `CREATE TABLE usage_admission_heads (
  occurrence_id BLOB PRIMARY KEY NOT NULL CHECK (typeof(occurrence_id) = 'blob' AND length(occurrence_id) = 16 AND occurrence_id != zeroblob(16)),
  operation BLOB NOT NULL CHECK (typeof(operation) = 'blob' AND length(operation) IN (184, 320)),
  journal_revision INTEGER NOT NULL CHECK (journal_revision BETWEEN 1 AND 4096),
  utc_day INTEGER CHECK (utc_day IS NULL OR utc_day BETWEEN 0 AND 4294967295)
) WITHOUT ROWID`,
  usage_admission_days: `CREATE TABLE usage_admission_days (
  utc_day INTEGER PRIMARY KEY CHECK (utc_day BETWEEN 0 AND 4294967295),
  live_count INTEGER NOT NULL CHECK (live_count BETWEEN 1 AND 65536)
)`,
});
