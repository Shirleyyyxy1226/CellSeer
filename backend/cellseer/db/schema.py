"""
db/schema.py — Database schema definitions for CellSeer.
"""
from __future__ import annotations

# ---------------------------------------------------------------------------
# Table names
# ---------------------------------------------------------------------------
CELL_TABLE        = "cell"
DATASET_TABLE     = "dataset"
INGEST_LOG_TABLE  = "ingest_log"
ANNOTATION_TABLE  = "cell_annotation"


# ---------------------------------------------------------------------------
# Column names for the cell table
# ---------------------------------------------------------------------------
class CellColumns:
    CELL_ID         = "cell_id"           # TEXT PRIMARY KEY
    ID_NO           = "id_no"             # INTEGER UNIQUE — cycler filename prefix
    BATCH           = "batch"
    CATEGORY        = "category"
    CATHODE         = "cathode"
    CATHODE_DIA_MM  = "cathode_diameter_mm"
    ANODE           = "anode"
    ANODE_DIA_MM    = "anode_diameter_mm"
    NP_RATIO        = "np_ratio"
    SEP_TYPE        = "separator_type"
    SEP_DIA_MM      = "separator_diameter_mm"
    ELECTROLYTE     = "electrolyte"
    ELEC_VOL_UL     = "electrolyte_volume_ul"
    SPACER_MM       = "spacer_mm"
    REPEAT          = "repeat"
    DO_FORMATION    = "do_formation"
    DO_RATETEST     = "do_ratetest"
    DO_EIS          = "do_eis"
    ANODE_MASS      = "anode_mass"
    CATHODE_MASS    = "cathode_mass"
    NOTES           = "notes"


# ---------------------------------------------------------------------------
# DuckDB schema DDL (mirrors schema.sql for the DuckDB backend)
# ---------------------------------------------------------------------------
DUCKDB_DDL = f"""
CREATE TABLE IF NOT EXISTS {CELL_TABLE} (
    cell_id         TEXT PRIMARY KEY,
    id_no           INTEGER UNIQUE,
    batch           INTEGER,
    category        TEXT,
    cathode         TEXT,
    cathode_diameter_mm DOUBLE,
    anode           TEXT,
    anode_diameter_mm   DOUBLE,
    np_ratio        DOUBLE,
    separator_type  TEXT,
    separator_diameter_mm DOUBLE,
    electrolyte     TEXT,
    electrolyte_volume_ul DOUBLE,
    spacer_mm       DOUBLE,
    repeat          INTEGER,
    do_formation    TEXT,
    do_ratetest     TEXT,
    do_eis          TEXT,
    anode_mass      DOUBLE,
    cathode_mass    DOUBLE,
    notes           TEXT
);

CREATE TABLE IF NOT EXISTS {DATASET_TABLE} (
    id          INTEGER PRIMARY KEY,
    cell_id     TEXT NOT NULL REFERENCES {CELL_TABLE}(cell_id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    data        BLOB NOT NULL,
    meta        TEXT,
    created_at  TEXT DEFAULT (current_timestamp),
    UNIQUE(cell_id, name)
);

CREATE TABLE IF NOT EXISTS {INGEST_LOG_TABLE} (
    id          INTEGER PRIMARY KEY,
    cell_id     TEXT NOT NULL REFERENCES {CELL_TABLE}(cell_id) ON DELETE CASCADE,
    filepath    TEXT NOT NULL,
    file_order  INTEGER NOT NULL DEFAULT 1,
    cycler      TEXT,
    confidence  DOUBLE,
    ingested_at TEXT DEFAULT (current_timestamp)
);

CREATE TABLE IF NOT EXISTS {ANNOTATION_TABLE} (
    cell_id    TEXT PRIMARY KEY REFERENCES {CELL_TABLE}(cell_id) ON DELETE CASCADE,
    note       TEXT,
    tags       TEXT,
    updated_at TEXT DEFAULT (current_timestamp)
);
"""
