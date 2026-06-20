from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Literal

import pandas as pd

CyclerName = Literal["auto", "neware", "biologic", "biologic_MB", "arbin", "basytec", "maccor", "novonix", "generic"]

_CYCLE_ALIASES = ("cycle", "cycle index", "cycle no")
_TYPE_ALIASES = ("step type", "status", "type")
_V_ALIASES = ("voltage(v)", "voltage [v]", "voltage")
_Q_ALIASES = ("capacity(mah)", "capacity [ah]", "capacity")
_I_ALIASES = ("current(a)", "current [a]", "current")
_PYPROBE_CYCLERS: tuple[str, ...] = ("neware", "biologic", "biologic_MB", "arbin", "basytec", "maccor", "novonix", "generic")


def _find_record_columns(df: pd.DataFrame) -> dict[str, str] | None:
    lookup = {c.strip().lower(): c for c in df.columns}

    def pick(aliases: tuple[str, ...]) -> str | None:
        for alias in aliases:
            if alias in lookup:
                return lookup[alias]
        return None

    cycle = pick(_CYCLE_ALIASES)
    voltage = pick(_V_ALIASES)
    capacity = pick(_Q_ALIASES)
    current = pick(_I_ALIASES)
    if not cycle or not voltage or not capacity:
        return None
    return {
        "cycle": cycle,
        "voltage": voltage,
        "capacity": capacity,
        "current": current or "",
        "type": pick(_TYPE_ALIASES) or "",
    }


def _group_curves(df: pd.DataFrame, cols: dict[str, str]) -> dict[int, dict[str, list[float]]]:
    grouped: dict[int, dict[str, list[float]]] = {}
    for cyc, chunk in df.groupby(cols["cycle"]):
        cycle = int(cyc)
        q_vals = chunk[cols["capacity"]].astype(float).tolist()
        if q_vals and max(abs(x) for x in q_vals) > 5:
            q_vals = [x / 1000.0 for x in q_vals]
        grouped[cycle] = {
            "Voltage [V]": chunk[cols["voltage"]].astype(float).tolist(),
            "Capacity [Ah]": q_vals,
            "Current [A]": chunk[cols["current"]].astype(float).tolist() if cols["current"] else [0.0] * len(chunk),
        }
    return grouped


def _load_curves_pyprobe(filepath: Path, cycler: CyclerName) -> dict[int, dict[str, list[float]]] | None:
    try:
        import polars as pl
        from pyprobe.cell import process_cycler_data
        from pyprobe.cyclers.column_maps import CastAndRenameMap
    except Exception:
        return None

    cyclers = _PYPROBE_CYCLERS if cycler == "auto" else (cycler,)
    for cycler_name in cyclers:
        tmp_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as tmp:
                tmp_path = tmp.name
            kwargs = {}
            if cycler_name == "neware":
                kwargs["extra_column_importers"] = [CastAndRenameMap("Cycle", "Cycle Index", pl.UInt64)]
            process_cycler_data(
                cycler=cycler_name,
                input_data_path=str(filepath),
                output_data_path=tmp_path,
                overwrite_existing=True,
                **kwargs,
            )
            df = pl.read_parquet(tmp_path).to_pandas()
            cols = _find_record_columns(df)
            if cols is None:
                continue
            return _group_curves(df, cols)
        except Exception:
            continue
        finally:
            if tmp_path:
                try:
                    Path(tmp_path).unlink(missing_ok=True)
                except Exception:
                    pass
    return None


def load_curves(filepath: str | Path, cycler: CyclerName = "auto") -> dict[int, dict[str, list[float]]] | None:
    path = Path(filepath)
    curves = _load_curves_pyprobe(path, cycler)
    if curves:
        return curves

    # Fallback parser for Neware-like record sheets.
    df = pd.read_excel(path, sheet_name="record")
    cols = _find_record_columns(df)
    if cols is None:
        return None
    return _group_curves(df, cols)
