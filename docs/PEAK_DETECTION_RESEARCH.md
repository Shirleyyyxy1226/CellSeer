# Peak Detection & Tracking for dQ/dV — Research (for the peak-shift metric)

**Context:** CellSeer reports a "peak shift" in mV — the voltage of the dominant dQ/dV peak, early-life vs late-life — as a degradation indicator. Current implementation (`backend/master_plot_peakshift.py`): take the *already Savitzky–Golay-smoothed* stored dQ/dV → apply a **second** smoothing (moving average, window 5) → **global `argmax`** of `|dQ/dV|` → shift = early peak V − late peak V, averaging first-3 / last-3 cycles, with a `>800 mV → null` guard.
**Purpose:** decide how to detect/track the peak robustly, backed by literature, before changing code.
**Prepared:** 2026-06-26 (literature search across battery-diagnostics, spectroscopy, signal-processing).

> **Citation honesty:** high-confidence anchors are Dubarry & Anseán 2022, Bloom et al. 2005, Dubarry/Truchot/Liaw 2012, Birkl et al. 2017, Chen/Naylor-Marlow/Jiang/Wu 2022, Du/Kibbe/Lin 2006, Savitzky & Golay 1964, and the SciPy docs. Items marked "(verify)" had DOI/venue reconstructed from indexers and should be confirmed before going into the MEng bibliography.

---

## 1. What peak features mean (degradation mapping)

ICA (dQ/dV vs V) and DVA (dV/dQ vs Q) turn sloping voltage plateaus into peaks/valleys whose **position, height, and area** are tracked. Mapping to degradation modes (Dubarry/Truchot/Liaw 2012; Birkl et al. 2017):
- **LLI (loss of lithium inventory)** → electrode curves *slip* relative to each other → peaks **shift in voltage/position**, inter-peak spacing changes. *This is the classic peak-shift signature.*
- **LAM (loss of active material)** → peaks lose **height/area**, broaden, can vanish.
- **Resistance / polarization** → peaks broaden, lower, and **also shift** (rate-dependent).

**Implication:** a peak-voltage shift is a recognized degradation signal, but it **conflates LLI with polarization** — so it should be labelled a *general degradation / LLI-leaning indicator*, not "LLI mV". Cross-checking against the DVA (dV/dQ) capacity-axis peak helps disambiguate LLI vs LAM (Bloom 2005; Chen et al. 2022).

---

## 2. Why our current detection is fragile

- **Global `argmax` → peak-hopping.** When the dominant peak and a neighbour are close in height, noise/aging flips which is the global max → a discontinuous, spurious multi-hundred-mV "shift." Our `>800 mV → null` guard is a band-aid for exactly this. The literature's fix is **not** a guard but **region-of-interest (ROI) windowing**: restrict the search to a voltage window around the known dominant phase-transition peak, enforcing peak identity across cycles (Weng et al. 2013/2016; Chen et al. 2022).
- **Double smoothing → peak broadening/position bias.** Our window-5 moving-average runs on already-SG-smoothed dQ/dV. Dubarry & Anseán (2022): *smoothing after derivation distorts much more than before, and ~5–10 % over-smoothing starts to move peaks.* A boxcar moving average is the **most position-biasing** common smoother (flat local fit). Stacking it on SG compounds the effective window (broadening) in an undocumented way — and a peak *shift* of order ~10 mV is exactly the regime where this bias matters.
- **`argmax` gives only integer-sample position** — ±½-grid quantization jitter that hops between samples under noise. Sub-sample fitting fixes this (see §3).

---

## 3. The robust recipe the literature converges on

A consistent "detect robustly, then measure precisely" pattern across battery + spectroscopy/chromatography:

1. **Work in V–Q first; smooth once, before differentiating.** Average Q(V) across the few cycles in each window (V–Q domain, not the derivative domain), resample to **~1–2 mV** uniform ΔV, then differentiate once with a *single* peak-preserving filter (ideally a Savitzky–Golay *derivative*; see `DIFFERENTIATION_METHODOLOGY_RESEARCH.md`). **No second smoothing of dQ/dV.** (Dubarry & Anseán 2022.)
2. **Detect with ROI + prominence, not global argmax.** Restrict to a voltage window around the dominant peak; use `scipy.signal.find_peaks` with a **prominence** floor (robust to baseline drift), plus **width** and **distance** floors to reject noise spikes/shoulders. Pick the **maximum-prominence** peak in the window, not merely the tallest. (SciPy docs; O'Haver; HPLC-py methodology.) For noisier cells, cross-check with a **CWT ridge detector** (`find_peaks_cwt` / Du, Kibbe & Lin 2006), which removes slowly-varying baseline automatically and rejects noise via cross-scale persistence.
3. **Refine position to sub-sample by fitting.** Around the detected apex, fit a **Gaussian / Pseudo-Voigt** (fallback Lorentzian, or fast 3-point parabolic in log-magnitude) over ~1–2 peak-widths and report the **fitted centroid**. This removes grid quantization jitter and is far more stable than argmax. Key principle (O'Haver): **smooth aggressively only to *detect*; measure position by fitting the lightly-/un-smoothed data** — peak parameters from a fit are *not* distorted by detection-stage smoothing.
4. **Guard merging.** If a secondary peak is close, fit the two **jointly** rather than smoothing them together; report the dominant component's center.
5. **Verify shift-free filtering.** Confirm the apex voltage doesn't move under ±1 step of filter strength, and that ≥5 grid points span the peak half-width (Dubarry & Anseán 2022).
6. **Match the cycles.** Average **comparable** cycles only (same C-rate / temperature / SOC span; ICA is only diagnostic at low rate, ≤C/10, ideally ~C/25). Equal early/late N. Consider skipping formation cycles for the "early" baseline. No canonical N, but ~3–5 is typical; average V–Q then differentiate once.

**One-line summary:** *ROI-window + prominence (and/or CWT) to find the dominant peak robustly, then Gaussian/Pseudo-Voigt centroid fit for a stable sub-sample position — and smooth once, before differentiation, never twice.*

---

## 4. The C-rate confound — why the current metric is unsafe

ICA peaks shift with **C-rate** (polarization), not only with degradation. The current metric takes the **first-3 vs last-3 cycles by index, blind to C-rate**. In this dataset many cells are **rate tests**: e.g. CEL-1's discharge current steps from −0.00022 A (cyc 1) up to −0.00432 A (cyc 16–19, **20×**) and back to −0.00043 A (cyc 28, **2×**). So the "early vs late" windows compare **different C-rates**, and the reported shift mixes rate-dependence with degradation — it can be largely an artifact.

A correct metric must **lock C-rate**: compare early vs late peaks only within cycles at the **same (ideally lowest / diagnostic) C-rate**. That requires **protocol segmentation** — the very thing `retention` and `medianCE` are already gated on.

## 5. DECISION (2026-06-26): remove the computation, gate like CE

Because the metric is C-rate-contaminated and a correct version needs protocol segmentation we don't yet have, **the dQ/dV peak-shift ("drift") computation is removed and the metric is protocol-gated exactly like `medianCE`/`retention`** — locked, showing "coming soon", until segment-aware (same-C-rate) computation lands.

**Implementation (mirror the CE shelving):**
- **Backend:** `peakShiftMv` is **nulled at source** (the `peak_shift_mv` argmax/double-smooth computation is retired); `build_peak_shift` returns null values.
- **Frontend:** the `dqdv-peak-shift` metric (`overview/metrics.ts`) gets **`requiresProtocol: true`** → lock → "coming soon" flow, same as `ce`/`retention`.
- **Tests:** update/relax `test_peak_shift.py` to assert the gated (null) behaviour.

**When it returns** (future, after protocol segmentation): rebuild it with the §3 recipe — single upstream smoothing (no 2nd smooth), ROI + prominence detection, Gaussian/Pseudo-Voigt apex fit, **same-C-rate early/late windows**, and honest LLI-leaning labelling.

---

## References

1. **Bloom, I., et al. (2005).** Differential voltage analyses of high-power lithium-ion cells (Parts 1 & 2). *J. Power Sources*, 139, 295–313. https://doi.org/10.1016/j.jpowsour.2004.07.021 — *foundational DVA; peak-position/spacing tracking.*
2. **Dubarry, M., Truchot, C., & Liaw, B. Y. (2012).** Synthesize battery degradation modes via a diagnostic and prognostic model. *J. Power Sources*, 219, 204–216. https://doi.org/10.1016/j.jpowsour.2012.07.016 — *peak-change → LLI/LAM/ORI mapping.*
3. **Han, X., et al. (2014).** A comparative study of commercial Li-ion battery cycle life in EVs: aging-mechanism identification. *J. Power Sources*, 251, 38–54. https://doi.org/10.1016/j.jpowsour.2013.11.029.
4. **Weng, C., Cui, Y., Sun, J., & Peng, H. (2013).** On-board SOH monitoring … incremental capacity analysis with SVR. *J. Power Sources*, 235, 36–44. https://doi.org/10.1016/j.jpowsour.2013.02.012 — *single-peak tracking as a health indicator.*
5. **Weng, C., Feng, X., Sun, J., & Peng, H. (2016).** SOH monitoring of modules/packs via incremental capacity peak tracking. *Applied Energy*, 180, 360–368. https://doi.org/10.1016/j.apenergy.2016.07.126.
6. **Birkl, C. R., et al. (2017).** Degradation diagnostics for lithium-ion cells. *J. Power Sources*, 341, 373–386. https://doi.org/10.1016/j.jpowsour.2016.12.011 — *model-based LLI/LAM quantification.*
7. **Chen, J., Naylor Marlow, M., Jiang, Q., & Wu, B. (2022).** Peak-tracking method to quantify degradation modes via DVA and ICA. *J. Energy Storage*, 45, 103669. https://doi.org/10.1016/j.est.2021.103669 — *most directly relevant peak-tracking template (≈±2 % RMSE).*
8. **Dubarry, M., & Anseán, D. (2022).** Best practices for incremental capacity analysis. *Frontiers in Energy Research*, 10, 1023555. https://doi.org/10.3389/fenrg.2022.1023555 — *smooth before derivation; over-smoothing moves peaks; ≥5 pts/half-width; apex vs onset.*
9. **Du, P., Kibbe, W. A., & Lin, S. M. (2006).** Improved peak detection in mass spectrum by incorporating CWT-based pattern matching. *Bioinformatics*, 22(17), 2059–2065. https://doi.org/10.1093/bioinformatics/btl355 — *CWT ridge detection; baseline-robust, noise-robust.*
10. **Virtanen, P., et al. (2020).** SciPy 1.0 — `scipy.signal.find_peaks` / `peak_prominences` / `find_peaks_cwt`. *Nature Methods*, 17, 261–272. https://doi.org/10.1038/s41592-019-0686-2 — *prominence/width/distance peak gating.*
11. **Smith, J. O. III (2011).** *Spectral Audio Signal Processing* — quadratic (parabolic) interpolation of spectral peaks + its bias. https://ccrma.stanford.edu/~jos/sasp/ — *sub-sample apex localization.*
12. **O'Haver, T. C.** *A Pragmatic Introduction to Signal Processing* (Univ. Maryland) — peak finding/measurement; smooth-to-detect, fit-to-measure; smooth-ratio/over-smoothing bias. https://terpconnect.umd.edu/~toh/spectrum/PeakFindingandMeasurement.htm.
13. **Savitzky, A., & Golay, M. J. E. (1964).** Smoothing and differentiation of data by simplified least squares procedures. *Analytical Chemistry*, 36(8), 1627–1639. https://doi.org/10.1021/ac60214a047.
14. **Beatty, M., Strickland, D., & Ferreira, P. (2024).** A review of methods of generating IC–DV curves for battery health determination. *Energies*, 17(17), 4309. https://doi.org/10.3390/en17174309 — *filter choice changes peak intensity; no standard pipeline.*

**(verify):** Pseudo-Voigt IC-peak fitting (*Applied Energy* 2020, Luenberger–Gaussian-MA IC extraction); rate-dependency of ICA (*J. Energy Storage* 25, 2019); Li et al. comparative curve-determination study (*J. Energy Storage* 27, 2019/2020); wavelet IC denoising (*J. Energy Storage* 2021). Confirm authors/DOI before formal citation.
