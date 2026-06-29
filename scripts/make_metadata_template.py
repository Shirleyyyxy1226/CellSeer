"""Generate the CellSeer metadata upload template (Excel).

One row per cell. Bold + frozen header, with cell comments on the columns that
need explaining. Headers match the ingest aliases (case- and punctuation-
insensitive); see docs/METADATA_GUIDE.md.

Run:
    .venv/bin/python scripts/make_metadata_template.py
Writes frontend/public/metadata_template.xlsx
"""

from pathlib import Path

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font

# Standard columns matched by the ingest aliases.
HEADERS = [
    "Cell name", "ID No", "Batch", "Category", "Repeat",
    "Cathode", "Cathode diameter (mm)", "Cathode mass (mg)",
    "Anode", "Anode diameter (mm)", "Anode mass (mg)", "NP ratio",
    "Separator type", "Separator diameter (mm)",
    "Electrolyte", "Electrolyte volume (uL)", "Spacer (mm)",
    "Do formation", "Do ratetest", "Do EIS", "Notes",
]

# Extra columns are optional and illustrative: anything beyond the standard set
# is preserved as-is, shown on the cell card, and offered as a hierarchy filter.
EXTRA_HEADERS = [
    "Cathode supplier", "Electrolyte supplier", "Testing procedure",
]

HEADERS += EXTRA_HEADERS

EXAMPLES = [
    ["P5K-CEL-12", 12, 1, "baseline", 2, "NMC811 (Canrud)", 14.0, 12,
     "Graphite", 15.0, 8, 1.1, "Celgard 2325", 16.0, "1M LiPF6 EC/DMC", 80, 1.0,
     "Yes", "Yes", "No", "first replicate",
     "Canrud", "Canrud", "rate performance"],
    ["P5K-CEL-13", 13, 1, "baseline", 3, "LFP (Canrud)", 14.0, 11.5,
     "Graphite", 15.0, 8, 1.1, "GlassFiber GF/A", 16.0, "1M LiPF6 EC/DMC", 80, 1.5,
     "Yes", "Yes", "No", "",
     "Canrud", "Canrud", "formation"],
]

# Header -> hover comment (only where a note helps).
COMMENTS = {
    "Cell name": "Required. Unique cell identifier.",
    "ID No": "Required. Must equal the number in each cell's cycling filename.",
    "Cathode mass (mg)": "Active-material mass. Required for specific capacity (mAh/g). Keep the (mg) unit.",
    "Spacer (mm)": "Matched by value, so 1 and 1.0 are the same condition.",
    "Cathode supplier": "Optional. Columns beyond the standard set are preserved as-is, "
                        "shown on the cell card, and selectable as a hierarchy filter — add any you need.",
}


def main() -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Cells"

    ws.append(HEADERS)
    for row in EXAMPLES:
        ws.append(row)

    for col_idx, name in enumerate(HEADERS, start=1):
        cell = ws.cell(row=1, column=col_idx)
        cell.font = Font(bold=True)
        cell.alignment = Alignment(vertical="center")
        if name in COMMENTS:
            cell.comment = Comment(COMMENTS[name], "CellSeer")
        widths = [len(name)] + [len(str(r[col_idx - 1])) for r in EXAMPLES]
        ws.column_dimensions[cell.column_letter].width = min(max(widths) + 2, 28)

    ws.freeze_panes = "A2"

    out = Path(__file__).resolve().parent.parent / "frontend" / "public" / "metadata_template.xlsx"
    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
