from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from ._cycler import CyclerName, load_curves as load_cycler_curves

_V_ALIASES = ("voltage [v]", "voltage", "v")
_Q_ALIASES = ("capacity [ah]", "capacity_ah", "capacity", "q")
_I_ALIASES = ("current [a]", "current", "i")
_CYC_ALIASES = ("cycle", "cycle index", "cycle_index", "cycle no")


@dataclass
class CellData:
    curves: dict[int, dict[str, list[float]]]
    cell_id: str = ""
    label: str = ""
    color: str | None = None
    meta: dict[str, Any] = field(default_factory=dict)


def _match(cols_lower: dict[str, str], aliases: tuple[str, ...]) -> str | None:
    for alias in aliases:
        if alias in cols_lower:
            return cols_lower[alias]
    return None


def _df_to_curves(df: pd.DataFrame) -> dict[int, dict[str, list[float]]]:
    cols_lower = {c.strip().lower(): c for c in df.columns}
    cyc_col = _match(cols_lower, _CYC_ALIASES)
    v_col = _match(cols_lower, _V_ALIASES)
    q_col = _match(cols_lower, _Q_ALIASES)
    i_col = _match(cols_lower, _I_ALIASES)
    if cyc_col is None or v_col is None or q_col is None:
        raise ValueError("Could not find cycle/voltage/capacity columns in input DataFrame.")

    grouped: dict[int, dict[str, list[float]]] = {}
    for cyc, chunk in df.groupby(cyc_col):
        cycle = int(cyc)
        q_vals = chunk[q_col].astype(float).tolist()
        # Scale down if values are likely in mAh
        if q_vals and max(abs(x) for x in q_vals) > 5:
            q_vals = [x / 1000.0 for x in q_vals]
        grouped[cycle] = {
            "Voltage [V]": chunk[v_col].astype(float).tolist(),
            "Capacity [Ah]": q_vals,
            "Current [A]": chunk[i_col].astype(float).tolist() if i_col else [0.0] * len(chunk),
        }
    return grouped


def _is_bare_curves(d: Any) -> bool:
    if not isinstance(d, dict) or not d:
        return False
    for k, v in d.items():
        if not str(k).isdigit():
            return False
        if not isinstance(v, dict):
            return False
    return True


def is_record_dict(d: Any) -> bool:
    return isinstance(d, dict) and (
        "curves" in d or "cell_id" in d or "cellId" in d or "label" in d or "name" in d
    )


def load(data: Any, *, label: str | None = None, cycler: CyclerName = "auto") -> CellData:
    """Coerce any supported input into a single CellData.

    Accepts: CellData (returned as-is), pandas DataFrame, a path to .csv /
    .xlsx (Neware) / .parquet, a bare curves dict ({cycle: {column: values}}),
    or a PyProBE-like object. Column names are alias-matched, so Neware,
    PyProBE and CellSeer data-lake spellings all work.

    >>> cell = cellseer.load(df, label="CEL-1")
    """
    if isinstance(data, CellData):
        return data if label is None else CellData(**{**data.__dict__, "label": label})

    if isinstance(data, pd.DataFrame):
        curves = _df_to_curves(data)
        return CellData(curves=curves, label=label or "DataFrame")

    if isinstance(data, (str, Path)):
        path = Path(data)
        suffix = path.suffix.lower()
        file_label = label or path.stem
        if suffix == ".csv":
            df = pd.read_csv(path)
            return CellData(curves=_df_to_curves(df), label=file_label, cell_id=path.stem)
        if suffix in {".xlsx", ".xlsm"}:
            curves = load_cycler_curves(path, cycler=cycler)
            if not curves:
                raise ValueError(f"Could not load curves from {path}")
            return CellData(curves=curves, label=file_label, cell_id=path.stem)
        raise ValueError(f"Unsupported file type: {suffix}")

    if is_record_dict(data):
        curves = data.get("curves", {})
        if _is_bare_curves(curves):
            normalized_curves = {
                int(k): {
                    "Voltage [V]": list(v.get("Voltage [V]", [])),
                    "Capacity [Ah]": list(v.get("Capacity [Ah]", [])),
                    "Current [A]": list(v.get("Current [A]", [])),
                }
                for k, v in curves.items()
            }
        else:
            raise ValueError("Record dictionary has invalid curves payload.")
        return CellData(
            curves=normalized_curves,
            cell_id=data.get("cell_id") or data.get("cellId") or "",
            label=label or data.get("label") or data.get("name") or "record",
            color=data.get("color"),
            meta=data.get("meta") or {},
        )

    if _is_bare_curves(data):
        normalized_curves = {
            int(k): {
                "Voltage [V]": list(v.get("Voltage [V]", [])),
                "Capacity [Ah]": list(v.get("Capacity [Ah]", [])),
                "Current [A]": list(v.get("Current [A]", [])),
            }
            for k, v in data.items()
        }
        return CellData(curves=normalized_curves, label=label or "curves")

    raise TypeError(f"Unsupported input type: {type(data)!r}")


def load_many(
    data: Any,
    *,
    labels: list[str] | None = None,
    cycler: CyclerName = "auto",
) -> list[CellData]:
    """Like load(), for a list/dict of inputs → list[CellData].

    labels (optional) are applied positionally; dict keys become labels.
    """
    if isinstance(data, dict) and not is_record_dict(data) and not _is_bare_curves(data):
        out: list[CellData] = []
        for name, value in data.items():
            out.append(load(value, label=name, cycler=cycler))
        return out

    if isinstance(data, (list, tuple)):
        out: list[CellData] = []
        for i, value in enumerate(data):
            item_label = labels[i] if labels and i < len(labels) else None
            out.append(load(value, label=item_label, cycler=cycler))
        return out

    return [load(data, label=labels[0] if labels else None, cycler=cycler)]
