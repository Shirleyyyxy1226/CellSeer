# Sample dataset (synthetic)

> **These are synthetic, computer-generated cells — not real experimental data.**
> They exist so a fresh clone can go from install to a rendered chart without
> supplying its own cycler files. Do not use them for any scientific conclusion.

## What's here

| File | Contents |
|---|---|
| `metadata.csv` | 4 demo cells across two cathode chemistries (NMC811 ×2, LFP ×2), with masses in mg so specific capacity computes |
| `cycling/CEL-1-SYNTHETIC.csv` … `CEL-4-SYNTHETIC.csv` | 10 charge/discharge cycles each, in Neware-style columns (`Cycle Index`, `Step Index`, `Date`, `Current(mA)`, `Voltage(V)`, `Chg. Cap.(mAh)`, `DChg. Cap.(mAh)`) |

Each cycling filename embeds the cell's `ID No` (`CEL-1-…` → ID No `1`), which is
how CellSeer links a cycling file to its metadata row. See
[`docs/METADATA_GUIDE.md`](../../docs/METADATA_GUIDE.md).

## How to load it

With the app running (see the root [README](../../README.md#getting-started)):

1. **Create a project** on the home page.
2. **Upload metadata**: choose `data/samples/metadata.csv`.
3. **Upload cycling files**: select all four files in `data/samples/cycling/`.
4. Wait for ingest to finish on the project detail page, then **open the dashboard**.
5. Explore: the Hierarchy Tree and Master Plot show the two chemistries; GCD, dQ/dV,
   and Rate Performance render per selected cell.
