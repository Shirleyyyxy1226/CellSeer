from __future__ import annotations

from typing import Iterable

_COLORS = [
    "#1f77b4",
    "#ff7f0e",
    "#2ca02c",
    "#d62728",
    "#9467bd",
    "#8c564b",
    "#e377c2",
    "#7f7f7f",
    "#bcbd22",
    "#17becf",
    "#aec7e8",
    "#ffbb78",
    "#98df8a",
    "#ff9896",
    "#c5b0d5",
    "#c49c94",
]


def _to_int32(n: int) -> int:
    n = n & 0xFFFFFFFF
    if n >= 0x80000000:
        n -= 0x100000000
    return n


def _hash_string(s: str) -> int:
    h = 0
    for char in s:
        h = _to_int32((h << 5) - h + ord(char))
    return abs(h)


def cell_color(cell_id: str, index: int) -> str:
    if not _COLORS:
        return "#1f77b4"
    return _COLORS[_hash_string(cell_id) % len(_COLORS)] or _COLORS[index % len(_COLORS)]


def _hue2rgb(p: float, q: float, t: float) -> float:
    if t < 0:
        t += 1
    if t > 1:
        t -= 1
    if t < 1 / 6:
        return p + (q - p) * 6 * t
    if t < 1 / 2:
        return q
    if t < 2 / 3:
        return p + (q - p) * (2 / 3 - t) * 6
    return p


def _hsl_to_hex(h: float, s: float, l: float) -> str:
    if s == 0:
        r = g = b = l
    else:
        q = l * (1 + s) if l < 0.5 else l + s - l * s
        p = 2 * l - q
        r = _hue2rgb(p, q, h + 1 / 3)
        g = _hue2rgb(p, q, h)
        b = _hue2rgb(p, q, h - 1 / 3)

    def to_hex(x: float) -> str:
        v = int(round(max(0.0, min(1.0, x)) * 255))
        return f"{v:02x}"

    return f"#{to_hex(r)}{to_hex(g)}{to_hex(b)}"


def cell_cycle_color(hex_color: str, t: float) -> str:
    """Tint hex_color toward white for early cycles (t=0 → 50% white, t=1 → full color).

    Matches the TS cellCycleColor function: keeps the hue, only tints toward
    white so every cycle still reads as the same cell colour.
    """
    if not hex_color or len(hex_color) != 7 or hex_color[0] != '#':
        return hex_color
    x = max(0.0, min(1.0, t))
    r = int(hex_color[1:3], 16)
    g = int(hex_color[3:5], 16)
    b = int(hex_color[5:7], 16)
    tint = 0.5 * (1 - x)
    ch = lambda c: int(round(c + (255 - c) * tint))
    return f"#{ch(r):02x}{ch(g):02x}{ch(b):02x}"


def cycle_fade_color(hex_color: str, t: float) -> str:
    r = int(hex_color[1:3], 16) / 255.0
    g = int(hex_color[3:5], 16) / 255.0
    b = int(hex_color[5:7], 16) / 255.0
    max_c = max(r, g, b)
    min_c = min(r, g, b)
    h = 0.0
    s = 0.0
    l = (max_c + min_c) / 2

    if max_c != min_c:
        d = max_c - min_c
        s = d / (2 - max_c - min_c) if l > 0.5 else d / (max_c + min_c)
        if max_c == r:
            h = ((g - b) / d + (6 if g < b else 0)) / 6
        elif max_c == g:
            h = ((b - r) / d + 2) / 6
        else:
            h = ((r - g) / d + 4) / 6

    s_new = 0.35 + t * max(0.0, s - 0.35)
    l_new = min(0.9, l + (1 - t) * 0.35)
    return _hsl_to_hex(h, s_new, l_new)


def base_layout() -> dict:
    """Shared Plotly layout defaults matching the CellSeer web app (PlotlyChart.tsx)."""
    return {
        "template": "plotly_white",
        "font": {"family": "Inter, sans-serif", "size": 13, "color": "#3a3a3c"},
        "paper_bgcolor": "white",
        "plot_bgcolor": "white",
        "margin": {"t": 40, "r": 40, "b": 50, "l": 60},
        "legend": {"bgcolor": "rgba(255,255,255,0.85)", "borderwidth": 0},
        "xaxis": {"gridcolor": "rgba(128,128,128,0.2)"},
        "yaxis": {"gridcolor": "rgba(128,128,128,0.2)"},
    }


def build_shared_grid(
    values: Iterable[float],
    default_min: float,
    default_max: float,
    default_step: float,
    n_pts: int = 150,
) -> list[float]:
    """Uniform grid spanning the data range — mirrors the web app's buildSharedGrid.

    ~150 points between the min and max of ``values`` (avoids the rectangular
    artifact a coarse grid produces). Falls back to ``default_min..default_max``
    stepped by ``default_step`` when ``values`` is empty.
    """
    vals = [float(v) for v in values if v is not None]
    if not vals:
        out = []
        x = default_min
        while x <= default_max:
            out.append(x)
            x += default_step
        return out
    v_min = min(vals)
    v_max = max(vals)
    rng = max(v_max - v_min, default_step)
    step = rng / n_pts
    out: list[float] = []
    x = v_min
    while x <= v_max:
        out.append(round(x, 6))
        x += step
    return out if len(out) >= 2 else [v_min, v_max]


def hex_to_rgba(hex_color: str, alpha: float) -> str:
    """#rrggbb → rgba(r,g,b,a). Mirrors the web app's hexToRgba."""
    r = int(hex_color[1:3], 16)
    g = int(hex_color[3:5], 16)
    b = int(hex_color[5:7], 16)
    return f"rgba({r},{g},{b},{alpha})"


def _lerp(x: float, x0: float, y0: float, x1: float, y1: float) -> float:
    if x1 == x0:
        return y0
    return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0)


def interpolate_onto_grid(
    x: Iterable[float],
    y: Iterable[float],
    x_grid: Iterable[float],
    out_of_range_value: float = 0.0,
) -> list[float]:
    x_vals = list(x)
    y_vals = list(y)
    grid_vals = list(x_grid)
    if len(x_vals) < 2 or len(y_vals) < 2:
        return [out_of_range_value for _ in grid_vals]

    x_min = min(x_vals[0], x_vals[-1])
    x_max = max(x_vals[0], x_vals[-1])
    inc = x_vals[1] >= x_vals[0]

    output: list[float] = []
    for xg in grid_vals:
        if xg < x_min or xg > x_max:
            output.append(out_of_range_value)
            continue
        i = 0
        if inc:
            while i < len(x_vals) - 1 and x_vals[i + 1] < xg:
                i += 1
        else:
            while i < len(x_vals) - 1 and x_vals[i + 1] > xg:
                i += 1
        if i >= len(x_vals) - 1:
            output.append(y_vals[-1] if y_vals else out_of_range_value)
            continue
        output.append(_lerp(xg, x_vals[i], y_vals[i], x_vals[i + 1], y_vals[i + 1]))
    return output
