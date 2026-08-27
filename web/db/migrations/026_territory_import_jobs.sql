CREATE TABLE territory_import_jobs (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL REFERENCES churches(id),
  territory_id TEXT NOT NULL REFERENCES territories(id),
  draft_json TEXT NOT NULL,
  draft_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'interrupted')),
  stage TEXT NOT NULL CHECK (stage IN ('queued', 'downloading_streets', 'downloading_buildings', 'matching', 'preparing', 'saving')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  heartbeat_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE UNIQUE INDEX one_active_territory_import_per_church
ON territory_import_jobs(church_id)
WHERE status IN ('queued', 'running');

CREATE TABLE territory_import_job_events (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES territory_import_jobs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('queued', 'downloading_streets', 'downloading_buildings', 'matching', 'preparing', 'saving')),
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;