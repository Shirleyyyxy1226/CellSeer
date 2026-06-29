-- CellSeer database schema

CREATE TABLE IF NOT EXISTS project (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Cells from metadata spreadsheet (one row per physical cell)
CREATE TABLE IF NOT EXISTS cell (
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  cell_id TEXT PRIMARY KEY,                 -- e.g. B01_NMC811_Gr_GlassFiber_Sep16mm_100uL_Sp1p5mm_R03
  id_no INTEGER,                            -- e.g. 1073 (matches cycler filename prefix)
  batch INTEGER,
  category TEXT,
  cathode TEXT,
  cathode_diameter_mm REAL,
  anode TEXT,
  anode_diameter_mm REAL,
  np_ratio REAL,
  separator_type TEXT,
  separator_diameter_mm REAL,
  electrolyte TEXT,
  electrolyte_volume_ul REAL,
  spacer_mm REAL,
  repeat INTEGER,
  do_formation TEXT,
  do_ratetest TEXT,
  do_eis TEXT,
  anode_mass REAL,
  cathode_mass REAL,
  notes TEXT,
  custom_meta TEXT,                         -- JSON map of source fields with no schema column (e.g. supplier, testing procedure)
  source_system TEXT,                       -- e.g. digibat
  source_refcode TEXT,                      -- remote item refcode
  source_item_id TEXT,                      -- remote item id
  last_seen_at TEXT,
  protocol_name TEXT,                       -- display label (e.g. "FORM-3 | 1C")
  protocol_segments TEXT,                   -- JSON list of {cycleStart,cycleEnd,cRate,name?}
  protocol_updated_at TEXT,
  deleted_at TEXT                           -- soft-delete tombstone (NULL = alive)
  -- id_no is intentionally NOT unique per (project_id, id_no):
  -- routing is keyed on cell_id, so e.g. P024-CEL-100 and P025-CEL-100 may
  -- legitimately coexist with the same display number.
);

CREATE INDEX IF NOT EXISTS idx_cell_project_id ON cell(project_id);
CREATE INDEX IF NOT EXISTS idx_cell_id_no ON cell(id_no);
CREATE INDEX IF NOT EXISTS idx_cell_project_id_no ON cell(project_id, id_no);
CREATE INDEX IF NOT EXISTS idx_cell_deleted_at ON cell(project_id, deleted_at);

-- Time-series datasets stored as files in the data-lake directory.
-- One row per (cell, dataset name), e.g. ("B01_NMC811_R01", "cycling").
-- meta stores optional JSON dataset-level metadata (e.g. protocol).
CREATE TABLE IF NOT EXISTS dataset (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  cell_id     TEXT NOT NULL REFERENCES cell(cell_id) ON DELETE CASCADE,
  name        TEXT NOT NULL,   -- "cycling", "dqdv", "dvdq", "eis", etc.
  storage_kind TEXT NOT NULL DEFAULT 'local',   -- local | s3 | ...
  storage_uri  TEXT NOT NULL,                   -- relative or absolute path
  data_format  TEXT NOT NULL DEFAULT 'parquet',
  size_bytes   INTEGER,
  checksum_sha256 TEXT,
  source_system TEXT,                       -- e.g. digibat
  source_refcode TEXT,
  source_file_id TEXT,
  source_version TEXT,
  last_synced_at TEXT,
  meta        TEXT,            -- JSON metadata (e.g. {"protocol": [...]})
  created_at  TEXT DEFAULT (datetime('now')),
  deleted_at  TEXT,             -- soft-delete tombstone (NULL = alive)
  UNIQUE(project_id, cell_id, name)
);

CREATE INDEX IF NOT EXISTS idx_dataset_project_id ON dataset(project_id);
CREATE INDEX IF NOT EXISTS idx_dataset_cell_id ON dataset(cell_id);
CREATE INDEX IF NOT EXISTS idx_dataset_source_file ON dataset(project_id, source_file_id);
CREATE INDEX IF NOT EXISTS idx_dataset_deleted_at ON dataset(project_id, deleted_at);

-- Ingest audit log: one row per file loaded into the DB.
CREATE TABLE IF NOT EXISTS ingest_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  cell_id     TEXT NOT NULL REFERENCES cell(cell_id) ON DELETE CASCADE,
  filepath    TEXT NOT NULL,
  file_order  INTEGER NOT NULL DEFAULT 1,
  cycler      TEXT,            -- detected cycler name, e.g. "neware"
  confidence  REAL,            -- detection confidence 0.0–1.0
  ingested_at TEXT DEFAULT (datetime('now'))
);

-- User annotations (notes + tags per cell). Separate from metadata "notes".
CREATE TABLE IF NOT EXISTS cell_annotation (
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  cell_id    TEXT PRIMARY KEY REFERENCES cell(cell_id) ON DELETE CASCADE,
  note       TEXT,
  tags       TEXT,            -- JSON array of tag strings
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Browser file upload tasks (queued → processing → done | error).
CREATE TABLE IF NOT EXISTS upload_task (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  filename   TEXT NOT NULL,
  file_type  TEXT,            -- "metadata" | "cycling" | ...
  item_count INTEGER NOT NULL DEFAULT 1,
  status     TEXT NOT NULL DEFAULT 'queued',
  message    TEXT,
  progress   INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_upload_task_project ON upload_task(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_task_created ON upload_task(created_at DESC);

-- DIGIBAT account connection per project (project key or user-provided key).
CREATE TABLE IF NOT EXISTS digibat_connection (
  project_id   TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
  base_url     TEXT NOT NULL,
  api_key      TEXT,
  key_source   TEXT NOT NULL DEFAULT 'env', -- env | user
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);

-- Mapping between DIGIBAT remote items and local cells.
CREATE TABLE IF NOT EXISTS digibat_cell_map (
  project_id      TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  remote_refcode  TEXT NOT NULL,
  remote_item_id  TEXT,
  cell_id         TEXT NOT NULL REFERENCES cell(cell_id) ON DELETE CASCADE,
  last_seen_at    TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, remote_refcode)
);

-- Mapping between DIGIBAT files and local dataset ingest decisions.
CREATE TABLE IF NOT EXISTS digibat_file_map (
  project_id      TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  remote_refcode  TEXT NOT NULL,
  source_file_id  TEXT NOT NULL,
  filename        TEXT NOT NULL,
  source_version  TEXT,
  cell_id         TEXT REFERENCES cell(cell_id) ON DELETE SET NULL,
  last_status     TEXT NOT NULL DEFAULT 'queued',
  last_error      TEXT,
  last_synced_at  TEXT DEFAULT (datetime('now')),
  deleted_at      TEXT,
  PRIMARY KEY (project_id, source_file_id)
);

CREATE INDEX IF NOT EXISTS idx_digibat_file_map_deleted_at
  ON digibat_file_map(project_id, deleted_at);

-- Per-run observability for manual/cron sync runs.
CREATE TABLE IF NOT EXISTS digibat_sync_run (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  mode                TEXT NOT NULL DEFAULT 'sync',
  status              TEXT NOT NULL DEFAULT 'running',
  collection_ids_json TEXT,
  totals_json         TEXT,
  error_message       TEXT,
  started_at          TEXT DEFAULT (datetime('now')),
  completed_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_digibat_sync_run_project ON digibat_sync_run(project_id, started_at DESC);

-- Reusable cycling protocol templates (project-scoped + builtins).
-- A protocol is an ordered list of segments mapping cycle ranges to a C-rate.
-- segments_json: JSON array of {cycleStart, cycleEnd|null, cRate, name?}.
-- is_builtin = 1 marks read-only seed templates that every project sees.
CREATE TABLE IF NOT EXISTS protocol_template (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  segments_json TEXT NOT NULL,
  is_builtin    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_protocol_template_project
  ON protocol_template(project_id, is_builtin, name);
