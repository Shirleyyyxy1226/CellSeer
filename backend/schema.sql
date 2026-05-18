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
  UNIQUE(project_id, id_no)
);

CREATE INDEX IF NOT EXISTS idx_cell_project_id ON cell(project_id);
CREATE INDEX IF NOT EXISTS idx_cell_id_no ON cell(id_no);

-- Time-series datasets stored as Parquet bytes (BLOB).
-- One row per (cell, dataset name), e.g. ("B01_NMC811_R01", "cycling").
-- meta stores optional JSON dataset-level metadata (e.g. protocol).
CREATE TABLE IF NOT EXISTS dataset (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  cell_id     TEXT NOT NULL REFERENCES cell(cell_id) ON DELETE CASCADE,
  name        TEXT NOT NULL,   -- "cycling", "dqdv", "dvdq", "eis", etc.
  data        BLOB NOT NULL,   -- Parquet-encoded bytes
  meta        TEXT,            -- JSON metadata (e.g. {"protocol": [...]})
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, cell_id, name)
);

CREATE INDEX IF NOT EXISTS idx_dataset_project_id ON dataset(project_id);
CREATE INDEX IF NOT EXISTS idx_dataset_cell_id ON dataset(cell_id);

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
