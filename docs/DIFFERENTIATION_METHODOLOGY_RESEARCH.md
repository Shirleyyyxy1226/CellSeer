# dQ/dV & dV/dQ Differentiation — Methodology Research & Proposed Fixes

**Context:** CellSeer computes incremental capacity (dQ/dV, "ICA") and differential voltage (dV/dQ, "DVA") from galvanostatic cycling data. This report reviews the scientific literature on how to do this correctly, and proposes concrete fixes to three issues found in the codebase.
**Prepared:** 2026-06-26, from a literature search across battery-diagnostics and numerical-analysis papers.
**Status:** for discussion before implementation.

> **Citation honesty:** DOIs/venues below were gathered by literature search. The high-confidence anchors (used for the main recommendations) are **Dubarry & Anseán 2022**, **Feng et al. 2020 (LEAN)**, **Savitzky & Golay 1964**, **Birkl et al. 2017**. Items flagged "(verify)" had author/venue/DOI reconstructed from indexer metadata and should be double-checked before going into the MEng bibliography.

---

## Executive summary

1. **Our current order is wrong by best-practice standards.** We do `np.gradient` (differentiate) **then** Savitzky–Golay (smooth). Dubarry & Anseán (2022), the field's "best practices for ICA" paper, state directly: *"Smoothing after derivation is inducing much more distortion of the data and should be avoided."* The correct approaches are **smooth-then-differentiate**, or — cleaner — use a **Savitzky–Golay *derivative* filter** that smooths and differentiates in one least-squares pass (which also makes our separate `np.gradient` redundant).

2. **There is a more rigorous, reproducible option: LEAN** (Feng et al. 2020), a count/bin method that never forms a noisy finite-difference quotient. PyProBE — already a dependency — ships it as `differentiate_lean`. It is parameter-light and was cross-validated across four labs.

3. **The peak-shift metric is double-smoothed** (a 2nd moving-average on already-smoothed dQ/dV) → contradicts the same best-practice guidance and can bias peak position. Fix = one smoothing stage + windowed/prominence-aware peak detection.

4. **Two duplicate capacity functions** cause the threshold conflict (P9). Fix = one source of truth.

---

## Part 1 — Smoothing order: why "differentiate-then-smooth" is wrong

**The numerical-analysis reason.** Differentiation is a high-pass operation: an ideal differentiator multiplies each Fourier component by a factor ∝ its frequency. Broadband measurement noise — negligible in the monotonic Q(V) curve — is amplified enormously in dQ/dV. Smoothing *afterwards* must then remove energy from a band that now contains **both** the (sharpened, narrowed) real peaks **and** the injected noise, folded together; it cannot cleanly separate them, so peak height/position are distorted. Smoothing the **monotonic Q(V) curve first** removes noise *before* amplification; the subsequent derivative is computed from a clean signal.

**Why the order also has a geometric reason** (Dubarry & Anseán 2022): Q(V) is monotonic, so smoothing it is benign; dQ/dV is multi-peaked and non-monotonic, so a smoothing window straddling a peak systematically clips its top and shifts its apex. Hence: smooth the voltage/capacity axis, then differentiate, then **verify peaks are unmoved**.

**The cleanest framing — Savitzky–Golay is itself a differentiating filter.** Savitzky & Golay (1964) fit a local low-order polynomial and can return the *analytic derivative* of that polynomial via one set of convolution coefficients — smoothing and differentiation in a **single** pass (`scipy.signal.savgol_filter(..., deriv=1, delta=dV)`). Our pipeline does the worst of both worlds: a bare `np.gradient` (full noise amplification) *then* a smoothing-only SG (cleanup). The SG machinery we already import can do the differentiation itself, collapsing two steps into one and removing the redundant `np.gradient`.

**Bin size is the primary knob, upstream of any filter.** Dubarry & Anseán: interpolate onto a uniform voltage grid (which we already do) with **ΔV ≈ 1–2 mV**, and keep **≥5 grid points across the narrowest peak's half-width**. A window of 21 points means very different things at 2 mV (42 mV span) vs 0.5 mV (10.5 mV) — the *physical* width of the smoothing window, not the point count, is what clips peaks, so window must be set relative to ΔV. Also: ICA is only quantitative at **low C-rate** (≤C/10, ideally ~C/25, "pseudo-OCV"); higher current smears and shifts peaks (Riviere et al. 2019).

---

## Part 2 — Method survey (and what real tools do)

| Method | How it works | Pro | Con |
|--------|--------------|-----|-----|
| **Fixed-ΔV binning / LEAN** | Bin one axis at a fixed step; **count** samples/charge per level — no finite-difference quotient | Noise-robust **by construction**; reproducible; parameter-light; O(n) | Resolution capped by bin width; coarse bins merge close peaks |
| **Savitzky–Golay *derivative*** | Local least-squares polynomial; analytic derivative = smoothed dQ/dV in one pass | Preserves peak shape; fast; ubiquitous | Two coupled knobs (window, polyorder); assumes ~uniform spacing |
| **Smoothing spline on Q(V)** | Penalized cubic spline, analytic derivative | Handles non-uniform sampling; one knob (λ) | λ/knot choice moves peaks (reproducibility risk) |
| **Gaussian Process Regression** | Bayesian fit; derivative of posterior mean + **uncertainty band** | Principled uncertainty quantification | O(n³); kernel choice matters |
| **TV-regularized differentiation** | Inverse problem with total-variation penalty | Strong noise suppression, keeps sharp transitions | Iterative/slow; tuning weight |
| **Moving average / Gaussian** | Convolve with a kernel | Trivial baseline | Flattens & shifts peaks — worst for the feature you measure |

**What established tools do:**
- **PyProBE** (our dependency) ships **both** a plain `gradient()` *and* `differentiate_lean()` (LEAN, cites Feng 2020). Clearest first-class LEAN implementation in an open tool.
- **BEEP** (Toyota Research): interpolates capacity onto an evenly-spaced **voltage grid** per cycle (fixed-ΔV binning) for ML featurization.
- **cellpy**: built-in ICA with **selectable** smoothing algorithms (smooth-then-differentiate).
- **DiffCapAnalyzer**: cleans then **fits peaks** (Pseudo-Voigt) to parameterize dQ/dV.
- **PyBaMM**: physics simulator, not a dQ/dV post-processor; users roll their own.

**De-facto standard:** there is **no single universal algorithm**. The field splits between **Savitzky–Golay** (smooth-then-differentiate, one-off analysis) and **fixed-ΔV binning** (ML pipelines). **LEAN** is the emerging principled/reproducible choice — and the one PyProBE adopted. Mirroring PyProBE (offer plain gradient + LEAN + optional SG-derivative) matches current best practice.

---

## Part 3 — Peak detection & the double-smoothing problem

**What ICA/DVA peaks mean** (Dubarry/Truchot/Liaw 2012; Birkl et al. 2017): degradation decomposes into Loss of Lithium Inventory (**LLI**), Loss of Active Material (**LAM_PE/LAM_NE**). A horizontal **peak-position shift** is the classic **LLI**-leaning signature; **height/area** loss signals LAM; resistance rise broadens/shifts peaks (rate-dependent). So our peak-shift-in-mV is a recognized degradation indicator — but it conflates LLI with polarization shift, so it should be **labelled as a general degradation signal**, not "LLI mV".

**Robust detection — bare `argmax` is the fragile choice.** It returns the global max and is exactly what causes **peak-hopping** (the dominant peak jumping to a different redox feature → spurious multi-hundred-mV "shift"; our `>800 mV → null` guard is a band-aid for this). Best practice:
- **Restrict the search to a voltage ROI** around the expected feature, so it cannot hop.
- Use **prominence/width thresholds** (e.g. keep peaks ≥ ~30 % of the tallest), not global max.
- Estimate position by **local parabolic/Gaussian fit to the apex** (sub-sample, noise-immune) — which also removes most of the motivation for extra smoothing.

**The double-smoothing verdict.** Our peak-shift applies a moving-average (window 5) to dQ/dV that was *already* Savitzky–Golay-smoothed (window 21). This is "smoothing after derivation" — done **twice** — which Dubarry & Anseán explicitly warn distorts peaks (they show ~10 % over-smoothing visibly shifts peak position). Repeated smoothing compounds the effective window (peak broadening); a boxcar moving average is the most position-biasing common smoother. **Verdict: redundant at best, position-biasing at worst, and it makes the metric depend on an undocumented compound filter** — bad for cross-cell comparability, which is the whole point of the metric.

**Early/late cycle averaging (our first-3/last-3):** a reasonable, common noise-reduction practice — but not a formal standard. Average **comparable cycles only** (same C-rate/temperature/direction), consider skipping formation cycles for the "early" baseline, and average **V–Q then differentiate once** (not average already-derived curves).

---

## Part 4 — Proposed fixes (for discussion)

### Fix ⓪ — differentiation method (DECIDED 2026-06-26: drop Savitzky–Golay)
**Now:** `np.gradient(Q, V)` → `savgol_filter(window=21, polyorder=3)` (differentiate-then-smooth — wrong order).
**DECISION:** **abandon Savitzky–Golay entirely.** Offer only two methods via PyProBE:
- **`raw`** — PyProBE `gradient` (plain finite difference, no smoothing) — the "show me the unprocessed truth" option.
- **`lean`** (default) — PyProBE `differentiate_lean` (LEAN, Feng 2020), the noise-robust count/bin method, with **bin-size protection** (clamp bins to ~60–200 so flat plateaus don't explode the bin count / OOM, as we found).

**UI — "Adjust smoothing" panel:** a button labelled **"Adjust smoothing"** opens a panel of **vertical sliders** for the LEAN parameters, with sensible **defaults** (so a casual user never touches them):
- Slider 1 — **bin size `k`** (resolution ↔ noise; default chosen so each peak half-width spans ≥5 bins).
- Slider 2 — **smoothing kernel** width (3 / 5 / 7-point; default 5-point `[0.0668, 0.2417, 0.3830, 0.2417, 0.0668]`).
- (optional) bin-protection bounds, hidden under "advanced".
Method selector = `raw` / `lean`. No Savitzky–Golay option.

**Why a good default is enough even if not perfect:** (1) default `k` is derived from ΔV + the ≥5-pts/half-width rule, not hard-coded; (2) the **sliders let the user override**; (3) for the peak metric, position is read by *fitting* (detect-vs-measure decoupling), so smoothing strength barely moves the reported value; (4) a shift-free self-check (vary params ±1, confirm peak doesn't move) flags a bad setting.

**Effort:** medium (backend method + bin protection) + medium (frontend slider panel). **Risk:** changes stored dQ/dV → **one-time recompute** from existing raw data (no re-upload).

### Fix ① — peak-shift double smoothing (academically-standard version)
1. **Remove** the window-5 moving average in `master_plot_peakshift.py` (`_SMOOTH_WINDOW`). Do not re-smooth already-smoothed data.
2. If detection is unstable, fix it at the *single* upstream stage (Fix ⓪), not with an analysis-stage patch.
3. Replace bare `argmax` with **ROI-restricted, prominence-aware** detection (`scipy.signal.find_peaks` with `prominence`), then a **parabolic apex fit** for sub-sample position. This removes the motivation for the 2nd smooth and kills peak-hopping at the source (making the `>800 mV → null` guard mostly redundant).
4. Keep first-3/last-3 averaging, but average **comparable** cycles and ideally average V–Q then differentiate once.
5. **Label** the output as a general degradation/LLI-leaning indicator, and document the ROI + filter (results are filter-dependent).
**Effort:** small–medium. **Risk:** changes peak-shift values (they become more correct/stable).

### Fix ② — duplicate capacity code → one source of truth (resolves P9)
- **Now:** `cycle_summary` (`summary.py`, adaptive `|Imax|/1e4`) and `_cycle_capacity_summary` (`routers/cells.py`, hardcoded `1e-9`) both compute per-cycle charge/discharge capacity — with **different thresholds** (the P9 conflict).
- **Proposed:** delete the router's private copy; have the rate endpoint call the canonical `cycle_summary` (adaptive threshold, per the 2026-06-26 decision). Convert to mAh at the edge.
- **Benefit:** one definition of "discharge capacity" app-wide; the threshold conflict cannot recur.
**Effort:** small. **Risk:** rate-plot numbers shift slightly on near-zero-current points (toward the adaptive-threshold definition the rest of the app already uses).

---

## References

1. **Dubarry, M., & Anseán, D. (2022).** Best practices for incremental capacity analysis. *Frontiers in Energy Research*, 10, 1023555. https://doi.org/10.3389/fenrg.2022.1023555 — *primary best-practices source; "smoothing after derivation … should be avoided"; ΔV≈2 mV; ≥5 pts/peak-half-width.*
2. **Feng, X., et al. (2020).** A reliable approach of differentiating discrete sampled-data for battery diagnosis (LEAN). *eTransportation*, 3, 100051. https://doi.org/10.1016/j.etran.2020.100051 — *the LEAN method; cross-validated across four labs.*
3. **Savitzky, A., & Golay, M. J. E. (1964).** Smoothing and differentiation of data by simplified least squares procedures. *Analytical Chemistry*, 36(8), 1627–1639. https://doi.org/10.1021/ac60214a047 — *SG computes derivatives directly via convolution coefficients.*
4. **Birkl, C. R., et al. (2017).** Degradation diagnostics for lithium ion cells. *Journal of Power Sources*, 341, 373–386. https://doi.org/10.1016/j.jpowsour.2016.12.011 — *LLI/LAM decoupling; differentiation amplifies noise.*
5. **Dubarry, M., Truchot, C., & Liaw, B. Y. (2012).** Synthesize battery degradation modes via a diagnostic and prognostic model. *Journal of Power Sources*, 219, 204–216. https://doi.org/10.1016/j.jpowsour.2012.07.016 — *peak-change → degradation-mode mapping.*
6. **Bloom, I., et al. (2005).** Differential voltage analyses of high-power lithium-ion cells (Parts 1 & 2). *Journal of Power Sources*, 139, 295–313. https://doi.org/10.1016/j.jpowsour.2004.07.021 — *foundational DVA technique.*
7. **Schmid, M., Rath, D., & Diebold, U. (2022).** Why and how Savitzky–Golay filters should be replaced. *ACS Measurement Science Au*, 2(2), 185–196. https://doi.org/10.1021/acsmeasuresciau.1c00054 — *SG peak attenuation/undershoot; Whittaker–Henderson alternatives.*
8. **Weng, C., et al. (2013).** On-board SOH monitoring … incremental capacity analysis with support vector regression. *Journal of Power Sources*, 235, 36–44. https://doi.org/10.1016/j.jpowsour.2013.02.012 — *cubic-spline ICA.*
9. **Chen, J., Naylor Marlow, M., Jiang, Q., & Wu, B. (2022).** Peak-tracking method to quantify degradation modes via DVA and ICA. *Journal of Energy Storage*, 45, 103669. https://doi.org/10.1016/j.est.2021.103669 — *directly relevant peak-tracking method.*
10. **Weng, C., Feng, X., Sun, J., & Peng, H. (2016).** SOH monitoring via incremental capacity peak tracking. *Applied Energy*, 180, 360–368. https://doi.org/10.1016/j.apenergy.2016.07.126.
11. **Beatty, M., Strickland, D., & Ferreira, P. (2024).** A review of methods of generating IC–DV curves for battery health determination. *Energies*, 17(17), 4309. https://doi.org/10.3390/en17174309 — *no standardized filter pipeline; results are filter-dependent.*
12. **Herring, P., et al. (2020).** BEEP: A Python library for Battery Evaluation and Early Prediction. *SoftwareX*, 11, 100506. https://doi.org/10.1016/j.softx.2020.100506.
13. **Mæhlen, J. P., et al. (2024).** Cellpy – an open-source library for processing and analysis of battery testing data. *JOSS*. https://doi.org/10.21105/joss.06236.
14. **Thompson, N., et al. (2020).** DiffCapAnalyzer: quantitative analysis of total differential capacity data. *JOSS*, 5(54), 2624. https://doi.org/10.21105/joss.02624.
15. PyProBE, Imperial College London — `pyprobe/analysis/differentiation.py` (`gradient`, `differentiate_lean`).

**(verify):** Riviere et al. 2019 *J. Energy Storage* 25 (rate dependency of dQ/dV); Li & Wang 2019 (ICA+GPR, arXiv:1903.07672); Richardson/Osborne/Howey 2017 (GP-ICE, arXiv:1712.02595); Chartrand 2011 *ISRN Applied Mathematics* (TVRegDiff). Author/venue details should be re-confirmed against the publisher before final citation.

---

## Appendix A — SG-derivative vs LEAN: what they are, parameters, and how widely used

Detail to support the Fix ⓪ decision (which method to default to).

### A.1 Savitzky–Golay *derivative* mode

**What it is.** Fit a local low-order polynomial over a sliding window by least squares; the analytic derivative of that polynomial is a fixed linear combination of the windowed samples (a convolution). `scipy.signal.savgol_filter(y, window_length, polyorder, deriv=1, delta=ΔV)` smooths **and** differentiates in one pass — so a separate `np.gradient` is redundant.

**Parameters to set:**
- `deriv=1` (1st derivative); `deriv=0` is pure smoothing.
- `delta=ΔV` — grid spacing. **Critical:** it rescales the output by 1/ΔV; a wrong `delta` silently rescales the whole curve. SG assumes **uniform spacing**, so interpolate Q onto a uniform V grid first (we already do) and pass `delta=ΔV`.
- `window_length` (odd) and `polyorder` (must be `< window_length`): polyorder **2–4** typical (≥3 needed to represent a derivative through an inflection); window sized in **millivolts** relative to ΔV and the narrowest peak (don't span more than ~one peak half-width, or peaks flatten). Larger window = more noise suppression but more peak attenuation/broadening.
- Pitfalls: edge artifacts (worse for derivatives), mild high-frequency ringing.

**Adoption — very high / canonical.** Savitzky & Golay (1964) is one of *Analytical Chemistry*'s "seminal papers," cited ~20,000+; first-class in SciPy/MATLAB/R/Origin. It is the **most-used** dQ/dV smoother in the battery ICA literature (named/parameterized in many SOH papers, e.g. polyorder 3 + odd per-cycle window). Papers that benchmark it for ICA: **Chen et al. 2024** (compares 8 ICA filters), the **Beatty/Strickland/Ferreira 2024** *Energies* review, and critically **Schmid, Rath & Diebold 2022** (*ACS Meas. Sci. Au*) which argues SG should be *replaced* (boundary/derivative distortion) by Whittaker–Henderson / modified-sinc — worth knowing but SG remains the field default.

### A.2 LEAN (Level Evaluation ANalysis, Feng et al. 2020)

**What it is.** Don't form a finite-difference quotient at all. Sample uniformly in capacity; **bin voltage into fixed levels** of width `k·δR` (δR = the cycler's quantization step, auto-detected as the min voltage spacing); **count** how many samples fall in each voltage bin; `dQ/dV = n·ΔQ/ΔV_bin`. Counting integrates instead of differencing → noise-robust **by construction**, O(n), parameter-light, bit-reproducible across labs.

**Parameters:** `k` (bin-size multiple, default 1) + a short symmetric smoothing kernel (3/5/7-point; PyProBE default 5-point `[0.0668, 0.2417, 0.3830, 0.2417, 0.0668]`). Both **manual** (no auto-tune); choose by noise level (noisier → larger `k` / longer kernel). Practical caveats: needs **CC-step isolation** (uniform-in-capacity assumption); **bin count blows up** if min spacing → 0 (needs bin-protection / dedup, as we found — OOM otherwise); resolution capped by bin width (large `k` merges peaks).

**Adoption — rising but still niche.** Feng 2020 has ~99 Google-Scholar citations (snapshot) — a respected methods paper, not yet a field standard. Shipped first-class in **PyProBE** (`differentiate_lean`, our dependency; PyProBE itself peer-reviewed, Holland/Cummins/Marinescu 2025 *JOSS*). Used mainly in the Imperial/Offer lineage (e.g. Chen et al. 2022 peak-tracking). Review/best-practice papers mention it as a useful *alternative* but still treat SG as the baseline. **A rigorous published LEAN-vs-SG peak-fidelity benchmark appears to be a genuine gap** (closest is Cui et al. 2025, a Faraday FUSE workshop report).

### A.3 Verdict for Fix ⓪

- **Savitzky–Golay derivative** = the smallest correct change, canonical, well-referenced, keeps results close to today's look, fixes the order. **Recommended default.**
- **LEAN** = more rigorous/reproducible by construction and PyProBE-idiomatic, but niche, manual-tuned, and finicky on our data (needs CC-step isolation + bin protection). **Recommended as an optional method behind a selector**, not the silent default.

