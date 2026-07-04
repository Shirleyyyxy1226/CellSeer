import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from loaders.base import BaseTestTypeLoader


class MetadataLoader(BaseTestTypeLoader):
    SUPPORTED_EXTENSIONS = [".csv", ".xlsx", ".xls"]
    FILE_TYPE = "metadata"
    DISPLAY_NAME = "Cell Metadata"
    DESCRIPTION = "Cell configuration spreadsheet (one row per cell — CSV or Excel)"

    def ingest(
        self,
        file_bytes: bytes,
        filename: str,
        conn,
        update_progress: Callable[[int, str], None],
        ingest_options: Optional[dict[str, Any]] = None,
    ) -> dict:
        from compute.db.pg_backend import PostgresBackend
        from compute.ingest import ingest_metadata

        suffix = Path(filename).suffix.lower()
        update_progress(5, "Inspecting metadata columns...")
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name
        try:
            db = PostgresBackend(None)
            update_progress(15, "Reading workbook...")
            options = ingest_options or {}
            project_id = options.get("projectId")
            if project_id and hasattr(db, "set_project_scope"):
                db.set_project_scope(project_id)
            selected_sheet = options.get("metadataSheet")
            if selected_sheet:
                update_progress(25, f"Using sheet: {selected_sheet}")
            else:
                update_progress(25, "Selecting metadata sheet...")
            update_progress(35, "Preparing key mapping...")
            update_progress(40, "Upserting cells...")
            cell_ids = ingest_metadata(
                tmp_path,
                db,
                primary_key_header=options.get("primaryKeyHeader"),
                id_no_header=options.get("idNoHeader"),
                # `or` (not .get default): the upload form sends the key with a
                # None value when unset, which would bypass a .get() default.
                display_name_template=options.get("displayNameTemplate")
                or "{cathode}_{anode}_R{repeat}_ID{id_no}",
                metadata_sheet=options.get("metadataSheet"),
                progress_cb=update_progress,
                project_id=project_id,
            )
            update_progress(97, "Finalizing import...")
            update_progress(100, f"Done — {len(cell_ids)} cells upserted")
            return {
                "importedCount": len(cell_ids),
                "sampleCellIds": cell_ids[:12],
                "primary_key_header": options.get("primaryKeyHeader"),
                "id_no_header": options.get("idNoHeader"),
                "display_name_template": options.get("displayNameTemplate")
                or "{cathode}_{anode}_R{repeat}_ID{id_no}",
                "metadata_sheet": options.get("metadataSheet"),
            }
        finally:
            os.unlink(tmp_path)

    def inspect(self, file_bytes: bytes, filename: str) -> dict:
        from compute.ingest import inspect_metadata_file

        suffix = Path(filename).suffix.lower()
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name
        try:
            return inspect_metadata_file(Path(tmp_path))
        finally:
            os.unlink(tmp_path)
