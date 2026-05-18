import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from loaders.base import BaseTestTypeLoader


class CyclingFileLoader(BaseTestTypeLoader):
    SUPPORTED_EXTENSIONS = [".xlsx", ".xls", ".csv", ".mpt", ".mpr"]
    FILE_TYPE = "cycling"
    DISPLAY_NAME = "Cycling Data"
    DESCRIPTION = "Battery cycling test data (Neware, Biologic, Arbin, etc.)"

    def ingest(
        self,
        file_bytes: bytes,
        filename: str,
        conn,
        update_progress: Callable[[int, str], None],
        ingest_options: Optional[dict[str, Any]] = None,
    ) -> dict:
        from config import DB_PATH
        from cellseer.db.sqlite_backend import SQLiteBackend
        from cellseer.ingest import ingest_cycling_file

        suffix = Path(filename).suffix.lower()
        stem = Path(filename).stem
        update_progress(10, "Saving file…")
        with tempfile.NamedTemporaryFile(
            suffix=suffix, delete=False, prefix=stem + "_"
        ) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name
        try:
            db = SQLiteBackend(DB_PATH)
            options = ingest_options or {}
            project_id = options.get("projectId")
            if project_id and hasattr(db, "set_project_scope"):
                db.set_project_scope(project_id)
            update_progress(20, "Detecting data format…")
            update_progress(30, "Parsing cycling file (large .xlsx may take a while)…")
            cell_id = ingest_cycling_file(tmp_path, db, project_id=project_id)
            update_progress(100, f"Done — cell {cell_id} updated")
            return {"cell_id": cell_id}
        finally:
            os.unlink(tmp_path)
