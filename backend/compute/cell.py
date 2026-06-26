"""
Cell — the central object representing one physical battery cell.

A Cell owns:
- `metadata`  : CellMetadata — strongly-typed cell description
- `datasets`  : dict[str, Result] — named data collections
                  e.g. {"cycling": CyclingData, "eis": EISData,
                        "dqdv": Result, "dvdq": Result}

Loading data
------------
cell.import_neware("cycling", ["1073_Rate testing.xlsx"])
cell.import_biologic("cycling", ["experiment.mpt"])
cell.import_arbin("cycling", ["test.xlsx"])
cell.import_data("cycling", reader)

Analysis
--------
# Compute and store dQ/dV and dV/dQ per discharge cycle
cell.compute_dqdv(db)

# Or manually:
from compute.analysis.cycling import dqdv
cell.datasets["dqdv"] = dqdv(cell.datasets["cycling"].discharge())
cell.save(db)

Persistence
-----------
cell.save(db)   # metadata → cell table, datasets → parquet files + dataset refs
Cell.load(db, cell_id)
"""
from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Dict, List, Optional, Union

from pydantic import BaseModel, ConfigDict

from compute.data.result import Result
from compute.analysis.metadata import CellMetadata

if TYPE_CHECKING:
    from compute.db.base import DBBackend
    from compute.readers.base import BaseReader


class Cell(BaseModel):
    """One physical battery cell with metadata and one or more named datasets."""

    metadata: CellMetadata
    datasets: Dict[str, Result] = {}   # Result or any subclass (RawData, CyclingData, …)

    model_config = ConfigDict(arbitrary_types_allowed=True)

    # ------------------------------------------------------------------
    # Convenience properties
    # ------------------------------------------------------------------

    @property
    def cell_id(self) -> str:
        return self.metadata.cell_id

    @property
    def id_no(self) -> Optional[int]:
        return self.metadata.id_no

    # ------------------------------------------------------------------
    # Data import
    # ------------------------------------------------------------------

    def import_data(self, name: str, reader: "BaseReader") -> "Cell":
        """Load data using any BaseReader and store under `name`."""
        raw = reader.read()
        raw.info.setdefault("cell_id", self.cell_id)
        self.datasets[name] = raw
        return self

    def import_neware(
        self,
        name: str,
        paths: Union[str, Path, List[Union[str, Path]]],
    ) -> "Cell":
        """Load one or more Neware .xlsx files as CyclingData."""
        from compute.readers.cycling.neware_reader import NewareReader
        if not isinstance(paths, list):
            paths = [paths]
        reader = NewareReader(input_paths=paths, info={"cell_id": self.cell_id})
        return self.import_data(name, reader)

    def import_biologic(
        self,
        name: str,
        paths: Union[str, Path, List[Union[str, Path]]],
    ) -> "Cell":
        """Load one or more BioLogic .mpt/.mpr files as CyclingData."""
        from compute.readers.cycling.biologic_reader import BiologicReader
        if not isinstance(paths, list):
            paths = [paths]
        reader = BiologicReader(input_paths=paths, info={"cell_id": self.cell_id})
        return self.import_data(name, reader)

    def import_arbin(
        self,
        name: str,
        paths: Union[str, Path, List[Union[str, Path]]],
    ) -> "Cell":
        """Load one or more Arbin export files as CyclingData."""
        from compute.readers.cycling.arbin_reader import ArbinReader
        if not isinstance(paths, list):
            paths = [paths]
        reader = ArbinReader(input_paths=paths, info={"cell_id": self.cell_id})
        return self.import_data(name, reader)

    # ------------------------------------------------------------------
    # Analysis
    # ------------------------------------------------------------------

    def compute_dqdv(
        self,
        cycling_dataset: str = "cycling",
        direction: str = "discharge",
        output_prefix: str = "",
        n_bins: int = 1000,
        method: str = "lean",
        lean_target_bins: int = 180,
        lean_kernel: list[float] | None = None,
    ) -> "Cell":
        """
        Compute dQ/dV and dV/dQ from one direction of every cycle and store
        as "<output_prefix>dqdv" and "<output_prefix>dvdq" datasets.

        Each result has one row per bin per cycle, with a "Cycle" column so
        you can filter by cycle number after loading.

        Parameters
        ----------
        cycling_dataset : str
            Name of the CyclingData dataset to differentiate (default "cycling").
        n_bins : int
            Number of uniform grid points for method="raw".
        method : str
            "lean" (default, PyProBE LEAN + bin protection) or "raw" (numpy.gradient).
        lean_target_bins : int
            Target number of voltage bins for the LEAN bin-protection step.
        lean_kernel : list[float] | None
            Optional LEAN smoothing kernel (defaults to a 5-point kernel).
        direction : str
            Either "discharge" or "charge".
        output_prefix : str
            Optional prefix for output dataset names, e.g. "discharge_".

        Returns self for chaining.
        """
        import polars as pl
        from compute.analysis.cycling.differentiation import dqdv, dvdq

        cycling = self.datasets[cycling_dataset]
        if not hasattr(cycling, "has_cycle_column"):
            raise ValueError(f"Dataset '{cycling_dataset}' is not a CyclingData instance.")
        if direction not in {"discharge", "charge"}:
            raise ValueError(f"Unsupported direction '{direction}'. Use 'charge' or 'discharge'.")

        df = cycling.collect()
        if "Cycle" not in df.columns:
            raise ValueError("No 'Cycle' column found. Run .with_cycle_column() first.")

        cycle_numbers = sorted(df["Cycle"].unique().to_list())

        dqdv_frames, dvdq_frames = [], []
        cycle_failures: list[tuple[int, str]] = []
        min_points = 5
        eps_v = 1e-6
        eps_q = 1e-9

        for cyc in cycle_numbers:
            from compute.data.cycling_data import CyclingData
            cyc_lf = df.filter(pl.col("Cycle") == cyc).lazy()
            cyc_data = CyclingData(lf=cyc_lf, info=cycling.info.copy())
            try:
                trace_label = direction
                trace = cyc_data.discharge() if direction == "discharge" else cyc_data.charge()
                trace_df = trace.collect()
                if trace_df.height < min_points:
                    cycle_failures.append((int(cyc), f"{trace_label}: too few points ({trace_df.height})"))
                    continue

                v_span = float(trace_df["Voltage [V]"].max() - trace_df["Voltage [V]"].min())
                q_span = float(trace_df["Capacity [Ah]"].max() - trace_df["Capacity [Ah]"].min())
                if v_span <= eps_v or q_span <= eps_q:
                    cycle_failures.append(
                        (
                            int(cyc),
                            f"{trace_label}: insufficient dynamic range (dV={v_span:.3e}, dQ={q_span:.3e})",
                        )
                    )
                    continue

                r_dqdv = dqdv(trace, method=method, n_bins=n_bins,
                              lean_target_bins=lean_target_bins, lean_kernel=lean_kernel)
                r_dvdq = dvdq(trace, method=method, n_bins=n_bins,
                              lean_target_bins=lean_target_bins, lean_kernel=lean_kernel)

                dqdv_frames.append(r_dqdv.collect().with_columns(pl.lit(cyc).alias("Cycle")))
                dvdq_frames.append(r_dvdq.collect().with_columns(pl.lit(cyc).alias("Cycle")))
            except Exception as exc:
                cycle_failures.append((int(cyc), f"{type(exc).__name__}: {exc}"))
                continue

        dqdv_name = f"{output_prefix}dqdv"
        dvdq_name = f"{output_prefix}dvdq"

        if dqdv_frames:
            self.datasets[dqdv_name] = Result(
                lf=pl.concat(dqdv_frames).lazy(),
                info={**cycling.info, "derived_from": cycling_dataset, "direction": direction},
                column_definitions={
                    "Voltage [V]":  "Voltage [V]",
                    "dQ/dV [Ah/V]": "Incremental capacity",
                    "Cycle":        "Cycle number",
                },
            )
        if dvdq_frames:
            self.datasets[dvdq_name] = Result(
                lf=pl.concat(dvdq_frames).lazy(),
                info={**cycling.info, "derived_from": cycling_dataset, "direction": direction},
                column_definitions={
                    "Capacity [Ah]": "Capacity [Ah]",
                    "dV/dQ [V/Ah]":  "Differential voltage",
                    "Cycle":         "Cycle number",
                },
            )

        if not dqdv_frames or not dvdq_frames:
            # Make missing dQ/dV or dV/dQ explicit instead of silently succeeding with cycling-only data.
            if cycle_failures:
                details = "; ".join(
                    [f"cycle {c}: {msg}" for c, msg in cycle_failures[:6]]
                )
                more = f" (+{len(cycle_failures) - 6} more)" if len(cycle_failures) > 6 else ""
                raise ValueError(
                    f"Unable to generate dQ/dV or dV/dQ from dataset '{cycling_dataset}'. "
                    f"Direction '{direction}'. Failed cycles: {details}{more}"
                )
            raise ValueError(
                f"Unable to generate dQ/dV or dV/dQ from dataset '{cycling_dataset}' "
                f"(direction '{direction}', no valid cycle traces)."
            )
        return self

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save(self, backend: "DBBackend") -> None:
        """Persist metadata and all datasets (including analysis) to the DB."""
        backend.upsert_cell(self)

    @classmethod
    def load(cls, backend: "DBBackend", cell_id: str) -> "Cell":
        """Restore a Cell from the DB."""
        return backend.load_cell(cell_id)

    # ------------------------------------------------------------------
    # Dunder
    # ------------------------------------------------------------------

    def __repr__(self) -> str:
        ds_names = list(self.datasets.keys())
        return (
            f"Cell(cell_id={self.cell_id!r}, "
            f"id_no={self.id_no}, "
            f"datasets={ds_names})"
        )
