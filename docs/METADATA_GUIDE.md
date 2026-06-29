# CellSeer Metadata File Guide

CellSeer builds every project from a **metadata file**: one row per cell, describing
how each cell was built (chemistry, masses, separator, electrolyte, and so on). This
page documents the format and the requirements.

A ready-to-fill Excel template lives at `frontend/public/metadata_template.xlsx`
(regenerate it with `scripts/make_metadata_template.py`). Inside the app, the same file
is offered as a **Metadata template** link above the upload tiles on any project page.

## File format

- One row per cell. The first row is the header.
- Accepted file types: `.csv`, `.xlsx`, `.xls`.
- Header matching is case-insensitive and ignores spaces, underscores, hyphens, and
  units in parentheses. `Cell ID`, `cell_id`, and `cellId` are all the same column.
- For Excel files the header row is detected automatically, so a title or notes row
  above the header is fine. Fully blank rows are skipped.
- Columns the app does not recognise are kept with the cell (stored as custom fields),
  not rejected.

## Required columns

| Column | Why it is required |
|---|---|
| **Cell name** (or Cell ID / ID / Sample ID / Barcode) | The unique cell identifier. The only strictly mandatory column. |
| **ID No** | The numeric key that links a metadata row to that cell's cycling data file. |

Upload fails if the sheet has no numeric ID column at all.

### ID No must match the cycling filename

When you upload a cycling file, CellSeer links it to a cell by reading the number out of
the filename and matching it to **ID No**. For example:

- `1073_Rate testing.xlsx` links to ID No `1073`
- `CEL-100-NMC622.xlsx` links to ID No `100`
- `P025-CEL-9.xlsx` links to ID No `9`

So the **ID No** in the sheet must equal the number embedded in each cell's cycling
filename.

## Important rules

- **Write mass columns with the unit `(mg)`** (for example `Cathode mass (mg)`). The
  unit in the header drives the conversion: `mg` is divided by 1000 into grams, while a
  bare `Cathode mass` is read as grams, which is almost always wrong. `Cathode mass (mg)`
  is the value that feeds specific capacity (mAh/g).
- **Protocol and C-rate information is not part of this file.** Attach it separately in
  the app, per cell, through the protocol wizard.
- **Cell name and ID No cannot be changed after upload**, because they are the keys used
  to join metadata to cycling data. Get them right in the sheet.
- A blank value is treated as "not provided".

## Columns

The recommended header is what the template uses; any alias that normalises to the same
key also works (see the header matching rule above).

| Column (recommended header) | Required | Type | Units / format | Example | Notes |
|---|---|---|---|---|---|
| Cell name | Yes | text | unique | P5K-CEL-12 | Primary identifier. Aliases: Cell ID, ID, Sample ID, Barcode. |
| ID No | Yes | integer | >= 1 | 12 | Links to the cycling filename number. Aliases: Cell No, ID Number, Number. |
| Batch | No | integer | | 1 | Build batch. |
| Category | No | text | | baseline | Free-form grouping label. |
| Repeat | No | integer | | 2 | Replicate index within a condition. |
| Cathode | No | text | | NMC811 (Canrud) | Cathode material / chemistry. Used in cohort filters. |
| Cathode diameter (mm) | No | number | mm | 14.0 | |
| Cathode mass (mg) | No | number | mg | 12 | Cathode active-material mass. Required for specific capacity (mAh/g). |
| Anode | No | text | | Graphite | |
| Anode diameter (mm) | No | number | mm | 15.0 | |
| Anode mass (mg) | No | number | mg | 8 | |
| NP ratio | No | number | ratio | 1.1 | Negative / positive capacity ratio. |
| Separator type | No | text | | Celgard 2325 | Used in cohort filters. |
| Separator diameter (mm) | No | number | mm | 16.0 | |
| Electrolyte | No | text | | 1M LiPF6 EC/DMC | |
| Electrolyte volume (uL) | No | number | uL | 80 | |
| Spacer (mm) | No | number | mm | 1.0 | Cohort filter matches by value, so 1 and 1.0 are the same. |
| Do formation | No | flag | Yes / No | Yes | Plan flag. |
| Do ratetest | No | flag | Yes / No | Yes | Plan flag. |
| Do EIS | No | flag | Yes / No | No | Plan flag. |
| Notes | No | text | | first replicate | Free-form notes. |

## Custom columns

Add any columns you like beyond the standard set — they are kept with the cell, not
discarded, and behave the same whether the metadata came from an upload or a DIGIBAT sync.

- **Cell card** — every custom column is shown. Component-named ones (`Cathode …`,
  `Anode …`, `Electrolyte …`) sit in that component's block; the rest under *Additional
  metadata*.
- **Hierarchy** — a custom column becomes a clickable level under *Available* **only if it
  can group cells**: 2+ distinct values qualifies; a constant or a unique-per-cell value
  does not (still shown on the card, just not offered as a level).

## Example

```csv
Cell name,ID No,Batch,Category,Repeat,Cathode,Cathode diameter (mm),Cathode mass (mg),Anode,Anode diameter (mm),Anode mass (mg),NP ratio,Separator type,Separator diameter (mm),Electrolyte,Electrolyte volume (uL),Spacer (mm),Do formation,Do ratetest,Do EIS,Notes
P5K-CEL-12,12,1,baseline,2,NMC811 (Canrud),14.0,12,Graphite,15.0,8,1.1,Celgard 2325,16.0,1M LiPF6 EC/DMC,80,1.0,Yes,Yes,No,first replicate
P5K-CEL-13,13,1,baseline,3,LFP (Canrud),14.0,11.5,Graphite,15.0,8,1.1,GlassFiber GF/A,16.0,1M LiPF6 EC/DMC,80,1.5,Yes,Yes,No,
```
