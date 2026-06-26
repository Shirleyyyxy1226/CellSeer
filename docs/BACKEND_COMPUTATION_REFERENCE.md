# Backend Computation Reference

**Source of truth:** the FastAPI backend (`backend/cellseer/` + `backend/routers/` + `backend/master_plot_*.py`).
**Purpose:** a single authoritative list of every analysis formula, threshold, and magic number the backend uses, with `file:line` evidence, so the standalone Python lib (`cellseer/src/cellseer/`) and the TS frontend (`packages/cellseer-lib/`) can be checked against it.
**Last audited:** 2026-06-26 (read from real code, not docs).

> ⚠️ This repo has **three** parallel implementations of the cycling analysis: the standalone Python lib (notebooks/gallery), this backend (API), and the TS frontend (rendering). This document records **the backend** as the reference. Where the standalone lib disagrees, it is the lib that is wrong unless noted.

---

## A. Current-sign binning (charge / discharge / rest)

The fundamental classifier. Everything downstream (capacity, CE, dQ/dV direction) depends on it.

| Item | Formula | File:line |
|------|---------|-----------|
| Base threshold `thr` | `\|max(Current)\| / 1e4`; if max is 0/falsy → `1e-9` | `backend/cellseer/data/cycling_data.py:76-79` |
| Charge | `Current [A] > thr` | `cycling_data.py:126` |
| Discharge | `Current [A] < -thr` | `cycling_data.py:134` |
| Rest | `\|Current [A]\| <= thr` | `cycling_data.py:142` |
| Constant-current | within `0.1%` of modal current | `cycling_data.py:147-158` |

**Key point:** rest (`i ≈ 0`) is excluded from *both* charge and discharge. The deadband `thr = |Imax|/1e4` (~0.01 % of full current) absorbs near-zero measurement noise.

---

## B. Per-cycle summary (`cycle_summary`)

Uses the adaptive `thr` from §A (`summary.py:57`).

| Item | Formula | File:line |
|------|---------|-----------|
| Charge Capacity [Ah] | `max(Q where i>thr) − min(Q where i>thr)` | `analysis/cycling/summary.py:64-67,77` |
| Discharge Capacity [Ah] | `max(Q where i<-thr) − min(Q where i<-thr)` | `summary.py:68-71,79` |
| Coulombic Efficiency | `Discharge Capacity / Charge Capacity` (0–1) | `summary.py:90-92` |
| Capacity Throughput [Ah] | `cumsum(\|ΔCapacity\|)` | `summary.py:72,81,85-86` |
| SOH Charge [%] | `Charge Cap / cycle-1 Charge Cap × 100` | `summary.py:95-97` |
| SOH Discharge [%] | `Discharge Cap / cycle-1 Discharge Cap × 100` | `summary.py:98-99` |

---

## C. dQ/dV and dV/dQ (precomputed at upload, stored as `*_dqdv.parquet` / `*_dvdq.parquet`)

Computed once during ingest (`ingest.py:246`), per direction of every cycle.

| Item | Formula / parameter | File:line |
|------|---------------------|-----------|
| Grid | `linspace(v[0], v[-1], n_bins=1000)` uniform voltage grid (dV/dQ: uniform capacity grid) | `analysis/cycling/differentiation.py:85,133` |
| Differentiation | `np.gradient` (plain finite difference) | `differentiation.py:89,136` |
| Smoothing | Savitzky–Golay, **window=21, polyorder=3**, applied **after** differentiation | `differentiation.py:92-93,138-139,157-161` |
| Sign | **not negated** (the standalone lib negates → divergence, see §G) | `differentiation.py:89` |
| Clipping | **none** (the standalone lib clips ±100 / ±1e4 → divergence) | — |
| Direction split | `discharge()` / `charge()` = adaptive `thr` (§A) | `backend/cellseer/cell.py:175` |
| Inclusion gates | `min_points=5`, `dV>1e-6`, `dQ>1e-9` | `cell.py:165-167,183` |
| Stored unit | `dQ/dV [Ah/V]`, `dV/dQ [V/Ah]` (frontend rescales to mAh) | `differentiation.py:98,144` |

> ⚠️ **Methodology flag + DECISION (2026-06-26):** smoothing is applied *after* `np.gradient` ("differentiate-then-smooth"), which the ICA literature recommends against. **Decision: drop Savitzky–Golay entirely**; offer `raw` (PyProBE `gradient`) + `lean` (PyProBE `differentiate_lean`, default, with bin protection), with an "Adjust smoothing" slider panel. Requires a one-time recompute of stored dQ/dV. See `DIFFERENTIATION_METHODOLOGY_RESEARCH.md` Fix ⓪.

---

## D. dQ/dV peak shift (degradation metric) — SHELVED (2026-06-26)

**Status:** removed / protocol-gated like `medianCE` & `retention`. `build_peak_shift` now returns `peakShiftMv: null` for every cell (`master_plot_peakshift.py:182-189`); the frontend metric `dqdv-peak-shift` has `requiresProtocol: true` (`overview/metrics.ts`) → lock → "coming soon". The `peak_shift_mv` helpers are kept but unused.

**Why removed:** the old computation (`argmax(|dQ/dV|)` after a 2nd window-5 moving average, first-3 vs last-3 cycles) was **double-smoothed** (on top of §C's SG-21) *and* **C-rate-blind** — ICA peaks shift with C-rate, not only ageing, and many cells are rate tests. A correct version needs same-C-rate windows (protocol segmentation). See `PEAK_DETECTION_RESEARCH.md`.

---

## E. Rate performance / per-cycle capacity (rate plot)

`_cycle_capacity_summary` in the router — a **second, duplicate** capacity computation distinct from §B.

| Item | Formula / parameter | File:line |
|------|---------------------|-----------|
| Charge / discharge capacity | `max(Q) − min(Q)` by current sign | `backend/routers/cells.py:351-357` |
| Threshold `thr` | **hardcoded `1e-9`** ⚠️ (≠ §A/§B adaptive) | `routers/cells.py:348` |
| Unit | `× 1000` → mAh | `routers/cells.py:372-373` |

---

## F. Overview metrics (master plot overview)

| Item | Status | File:line |
|------|--------|-----------|
| Peak capacity | `mAh/g` (if mass present) else `mAh` | `master_plot_overview.py:61-62` |
| Retention / median CE | **intentionally `None`** ("coming soon"; needs protocol-segmented main-cycling phase) | `master_plot_overview.py:71-72` |

---

## G. Known conflicts & divergences (audited)

### G1. CONFLICT — two different current thresholds inside the backend
- §A / §B (`cycle_summary`, dQ/dV split) use **adaptive `|Imax|/1e4`** (`cycling_data.py:79`, `summary.py:57`).
- §E (rate / per-cycle capacity) uses **hardcoded `1e-9`** (`routers/cells.py:348`).
- **Effect:** "what counts as discharge" differs between the rate plot and the rest of the app on near-zero-current points.
- **Decision (2026-06-26):** standardize on the **adaptive `|Imax|/1e4`**. Fix = make `_cycle_capacity_summary` call the same threshold logic.
- **Root cause:** §B and §E are **duplicate capacity-computation code**. The long-term fix is to merge them into one function (see `DIFFERENTIATION_METHODOLOGY_RESEARCH.md`, Proposal ②).

### G2. NOTE — peak-shift is double-smoothed
§D moving-average (window 5) on top of §C Savitzky–Golay (window 21). See Proposal ① in the research report.

### G3. NOTE — differentiate-then-smooth order
§C smooths after `np.gradient`. Literature recommends smooth-then-differentiate or a Savitzky–Golay *derivative* filter. See research report Part 1.

### G4. Standalone-lib divergences (the lib is wrong vs this backend)
- Lib bins rest as **discharge** (`cellseer/src/cellseer/gcd.py:34`, `else` branch) — backend uses strict `i < -thr`.
- Lib has **no smoothing** on dQ/dV (`compute.py:106/117`) — backend has Savitzky–Golay.
- Lib **negates** dQ/dV and **clips** — backend does neither.
- Lib uses pyprobe's plain `gradient`, not the noise-robust `differentiate_lean`.

---

## Appendix — file index

| Concern | File |
|---------|------|
| Current thresholds, charge/discharge/rest | `backend/cellseer/data/cycling_data.py` |
| Per-cycle capacity, CE, SOH, throughput | `backend/cellseer/analysis/cycling/summary.py` |
| dQ/dV, dV/dQ | `backend/cellseer/analysis/cycling/differentiation.py` (orchestrated by `backend/cellseer/cell.py:compute_dqdv`) |
| Savitzky–Golay helper | `backend/cellseer/analysis/base/numerical.py` (note: `differentiation.py` has its own private `_savgol`, does not call this) |
| Peak shift | `backend/master_plot_peakshift.py` |
| Rate / per-cycle capacity (duplicate) | `backend/routers/cells.py:_cycle_capacity_summary` |
| Overview metrics | `backend/master_plot_overview.py` |
| Precompute at upload | `backend/cellseer/ingest.py:246` |
