"""
CellSeer — battery cell data library.

Three-layer architecture
------------------------
1. Data layer    : lazy Polars containers with schema contracts
2. Reader layer  : auto-detection + multi-format readers
3. Analysis layer: stateless functions → Result objects

Quick start
-----------
from compute import Project, SQLiteBackend

db = SQLiteBackend("backend/cellseer.db")
project = Project.from_metadata_file("data/metadata/cells.xlsx")
project.import_neware_from_db(db)

cell = project["B01_NMC811_R01"]
discharge = cell.datasets["cycling"].cycle(1).discharge()
voltage, capacity = discharge.get("Voltage [V]", "Step Capacity [Ah]")

from compute.analysis.cycling import cycle_summary
summary = cycle_summary(cell.datasets["cycling"])
"""
from compute._version import __version__

# Core objects
from compute.analysis.metadata import CellMetadata
from compute.cell import Cell
from compute.project import Project

# Data containers
from compute.data.result import Result
from compute.data.cycling_data import CyclingData

# Protocol (test schedule metadata)
from compute.data.protocol import Protocol

# Readers
from compute.readers.cycling.cycler_reader import CyclerReader
from compute.readers.cycling.neware_reader import NewareReader
from compute.readers.cycling.biologic_reader import BiologicReader
from compute.readers.cycling.arbin_reader import ArbinReader
from compute.readers.cycling.detect import detect_reader
from compute.readers.metadata import MetadataReader

# Ingest helpers
from compute.ingest import ingest_metadata, ingest_cycling_file

# Database backends
from compute.db.sqlite_backend import SQLiteBackend

# Utilities
from compute.utils import set_log_level

__all__ = [
    "__version__",
    # Core
    "CellMetadata", "Cell", "Project",
    # Data
    "Result", "CyclingData",
    # Protocol
    "Protocol",
    # Readers
    "CyclerReader", "NewareReader", "BiologicReader", "ArbinReader", "detect_reader",
    "MetadataReader",
    # Ingest
    "ingest_metadata", "ingest_cycling_file",
    # DB
    "SQLiteBackend",
    # Utils
    "set_log_level",
]
