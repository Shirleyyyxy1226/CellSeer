#!/usr/bin/env python3
"""Generate api.html — three-column xyd-style API reference. Run from repo root or repo-docs."""
from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).resolve().parent / "api.html"
BASE = "http://localhost:8000"
TOKEN = "YOUR_TOKEN"

AUTH_NOTE = (
    "When <code>CELLSEER_API_TOKEN</code> is set, requests require "
    "<code>Authorization: Bearer &lt;token&gt;</code>. "
    "When unset (local dev), no auth. <code>/api/health</code> is always exempt."
)


def P(name: str, typ: str, required: bool, desc: str, *, default=None, constraints=None):
    return {
        "name": name,
        "type": typ,
        "required": required,
        "description": desc,
        "default": default,
        "constraints": constraints or [],
    }


def R(status: int, desc: str, example: dict, *, schema=None, content_type="application/json"):
    return {
        "status": status,
        "description": desc,
        "contentType": content_type,
        "example": example,
        "schema": schema or _schema_from_example(example),
    }


def _schema_from_example(obj, desc=""):
    if isinstance(obj, dict):
        return {
            "type": "object",
            "properties": {
                k: _schema_from_example(v, "")
                for k, v in obj.items()
            },
        }
    if isinstance(obj, list):
        item = _schema_from_example(obj[0]) if obj else {"type": "any"}
        return {"type": "array", "items": item}
    if isinstance(obj, bool):
        return {"type": "boolean", "description": desc}
    if isinstance(obj, int):
        return {"type": "integer", "description": desc}
    if isinstance(obj, float):
        return {"type": "number", "description": desc}
    return {"type": "string", "description": desc}


def _auth_header() -> str:
    return f' -H "Authorization: Bearer {TOKEN}"'


def _path_with_samples(path: str) -> str:
    return (
        path.replace("{project_id}", "proj_abc123")
        .replace("{cell_id}", "Cell-001")
        .replace("{task_id}", "550e8400-e29b-41d4-a716-446655440000")
        .replace("{template_id}", "tmpl_custom_01")
        .replace("{collection_id}", "col_42")
        .replace("{test_type}", "cycling")
    )


def _query_string(params: list[dict]) -> str:
    parts = []
    for p in params or []:
        if p["name"] in ("projectId", "project_id"):
            parts.append("projectId=proj_abc123")
        elif p["name"] == "direction":
            parts.append("direction=discharge")
        elif p["name"] == "cycles":
            parts.append("cycles=10,20,50")
        elif p["name"] == "maxLevels":
            parts.append("maxLevels=4")
    return ("?" + "&".join(parts)) if parts else ""


def build_request_examples(ep: dict) -> dict:
    method = ep["method"]
    path = _path_with_samples(ep["path"])
    qs = _query_string(ep.get("queryParams") or [])
    url = f"{BASE}{path}{qs}"
    auth = "" if ep.get("auth") == "exempt" else _auth_header()

    body = ep.get("_sample_body")
    body_flag = ""
    if body is not None and method in ("POST", "PUT", "PATCH"):
        body_json = json.dumps(body, indent=2)
        body_flag = f" \\\n  -H 'Content-Type: application/json' \\\n  -d '{json.dumps(body)}'"
    elif ep.get("formParams"):
        body_flag = ' \\\n  -F "file=@/path/to/data.csv"'
        if any(p["name"] == "projectId" for p in ep["formParams"]):
            body_flag += ' \\\n  -F "projectId=proj_abc123"'

    shell = f"curl -X {method}{auth} \\\n  '{url}'{body_flag}"

    js_body = ""
    if body is not None and method in ("POST", "PUT", "PATCH"):
        js_body = f",\n  body: JSON.stringify({json.dumps(body)}),\n  headers: {{ 'Content-Type': 'application/json'{', Authorization: `Bearer ${TOKEN}`' if auth else ''} }}"
    elif auth:
        js_body = f",\n  headers: {{ Authorization: 'Bearer {TOKEN}' }}"

    javascript = f"const res = await fetch('{url}', {{ method: '{method}'{js_body} }});\nconst data = await res.json();"

    py_kw = ""
    if body is not None and method in ("POST", "PUT", "PATCH"):
        py_kw = f", json={repr(body)}"
    python = (
        f"import requests\n\nheaders = {{'Authorization': 'Bearer {TOKEN}'}} if {bool(auth)} else {{}}\n"
        f"r = requests.{method.lower()}('{url}'{py_kw}, headers=headers)\n"
        f"r.raise_for_status()\nprint(r.json())"
    )

    return {"shell": shell, "javascript": javascript, "python": python}


CELL_PATH = P(
    "cell_id",
    "string",
    True,
    "Cell identifier. Uses {cell_id:path} — URL-encode slashes and special characters.",
)

# Shared sample payloads
SAMPLE_PROJECT = {
    "id": "proj_abc123",
    "name": "P5K benchmark",
    "createdAt": "2025-11-01T10:00:00Z",
    "updatedAt": "2026-03-15T14:22:00Z",
    "cellCount": 48,
    "cathodeTypes": ["NMC811", "LFP"],
}

SAMPLE_PROTOCOL_SEGMENTS = [
    {"cycleStart": 1, "cycleEnd": 3, "cRate": 0.1, "name": "Formation"},
    {"cycleStart": 4, "cycleEnd": 10, "cRate": 1.0, "name": "C/1"},
]

ENDPOINTS: list[dict] = [
    {
        "id": "get-health",
        "method": "GET",
        "path": "/api/health",
        "title": "Liveness probe",
        "navLabel": "Health check",
        "description": "Returns a minimal JSON payload for platform health checks and uptime monitors.",
        "auth": "exempt",
        "keywords": "health liveness status ok",
        "responses": [R(200, "Service is running.", {"status": "ok"})],
        "examples": {"responses": {"200": {"status": "ok"}}},
    },
    {
        "id": "get-projects",
        "method": "GET",
        "path": "/api/projects",
        "title": "List all projects",
        "description": "Returns every project with cell counts and a sample of distinct cathode types.",
        "auth": "bearer",
        "keywords": "projects list",
        "responses": [
            R(200, "Array of project objects.", {"projects": [SAMPLE_PROJECT]}),
        ],
        "examples": {"responses": {"200": {"projects": [SAMPLE_PROJECT]}}},
    },
    {
        "id": "post-projects",
        "method": "POST",
        "path": "/api/projects",
        "title": "Create a project",
        "description": "Creates a new project with a generated ID and the given display name.",
        "auth": "bearer",
        "keywords": "projects create",
        "bodyParams": [P("name", "string", True, "Display name (max 120 chars, trimmed).")],
        "_sample_body": {"name": "New campaign"},
        "responses": [
            R(200, "Created project object.", {**SAMPLE_PROJECT, "cellCount": 0, "cathodeTypes": []}),
            R(400, "Empty or missing name.", {"detail": "Project name is required"}),
        ],
        "examples": {
            "responses": {
                "200": {**SAMPLE_PROJECT, "cellCount": 0, "cathodeTypes": []},
                "400": {"detail": "Project name is required"},
            }
        },
    },
    {
        "id": "patch-projects",
        "method": "PATCH",
        "path": "/api/projects/{project_id}",
        "title": "Rename a project",
        "description": "Updates the project display name.",
        "auth": "bearer",
        "keywords": "projects rename patch",
        "pathParams": [P("project_id", "string", True, "Project ID.")],
        "bodyParams": [P("name", "string", True, "New display name.")],
        "_sample_body": {"name": "Renamed campaign"},
        "responses": [
            R(200, "Update succeeded.", {"ok": True}),
            R(404, "Project not found.", {"detail": "Project not found"}),
        ],
        "examples": {"responses": {"200": {"ok": True}, "404": {"detail": "Project not found"}}},
    },
    {
        "id": "delete-projects",
        "method": "DELETE",
        "path": "/api/projects/{project_id}",
        "title": "Delete a project",
        "description": "Deletes the project and cascades cleanup across cells, datasets, annotations, upload tasks, and ingest logs.",
        "auth": "bearer",
        "keywords": "projects delete",
        "pathParams": [P("project_id", "string", True, "Project ID.")],
        "responses": [
            R(200, "Delete succeeded.", {"ok": True}),
            R(404, "Project not found.", {"detail": "Project not found"}),
        ],
        "examples": {"responses": {"200": {"ok": True}, "404": {"detail": "Project not found"}}},
    },
    {
        "id": "get-project-readiness",
        "method": "GET",
        "path": "/api/projects/{project_id}/readiness",
        "title": "Project dataset readiness",
        "navLabel": "Project readiness",
        "description": "Summarises whether the project has metadata and cycling files sufficient to enter the analysis dashboard.",
        "auth": "bearer",
        "keywords": "readiness dashboard metadata cycling",
        "pathParams": [P("project_id", "string", True, "Project ID.")],
        "responses": [
            R(
                200,
                "Readiness flags for dashboard gate.",
                {
                    "projectId": "proj_abc123",
                    "projectName": "P5K benchmark",
                    "hasMetadata": True,
                    "metadataColumnCount": 8,
                    "cyclingFileCount": 42,
                    "canEnterDashboard": True,
                },
            ),
            R(404, "Project not found.", {"detail": "Project not found"}),
        ],
        "examples": {
            "responses": {
                "200": {
                    "projectId": "proj_abc123",
                    "projectName": "P5K benchmark",
                    "hasMetadata": True,
                    "metadataColumnCount": 8,
                    "cyclingFileCount": 42,
                    "canEnterDashboard": True,
                },
                "404": {"detail": "Project not found"},
            }
        },
    },
    {
        "id": "get-hierarchy",
        "method": "GET",
        "path": "/api/hierarchy",
        "title": "Hierarchy tree from DB metadata",
        "navLabel": "Hierarchy tree",
        "description": "Builds the hierarchy tree, colour maps, and analysis dimensions from cell metadata in PostgreSQL.",
        "auth": "bearer",
        "keywords": "hierarchy tree",
        "queryParams": [
            P("maxLevels", "integer", False, "Max hierarchy depth.", default=4, constraints=["range: x >= 1"]),
            P("projectId", "string", False, "Project scope."),
        ],
        "responses": [
            R(
                200,
                "Tree, analysis, and colour maps.",
                {
                    "projectKey": "proj_abc123",
                    "tree": {"name": "root", "children": [{"name": "NMC811", "count": 24}]},
                    "analysis": {"dimensions": ["cathode", "separator_type"]},
                    "colourMaps": {},
                },
            ),
            R(404, "No metadata in DB.", {"detail": "No cell metadata found"}),
        ],
        "examples": {
            "responses": {
                "200": {
                    "projectKey": "proj_abc123",
                    "tree": {"name": "root", "children": [{"name": "NMC811", "count": 24}]},
                    "analysis": {"dimensions": ["cathode", "separator_type"]},
                    "colourMaps": {},
                },
                "404": {"detail": "No cell metadata found"},
            }
        },
    },
    {
        "id": "post-hierarchy-analyse",
        "method": "POST",
        "path": "/api/hierarchy/analyse",
        "title": "Analyse CSV hierarchy dimensions",
        "navLabel": "Analyse CSV",
        "description": "Parses uploaded CSV text and returns hierarchy analysis without persisting.",
        "auth": "bearer",
        "keywords": "hierarchy analyse csv",
        "bodyParams": [
            P("csvText", "string", True, "Raw CSV content."),
            P("maxLevels", "integer", False, "Max depth.", default=4),
            P("userHierJs", "integer[]", False, "Custom dimension order."),
        ],
        "_sample_body": {"csvText": "cell_id,cathode\nCell-001,NMC811\n", "maxLevels": 4},
        "responses": [
            R(200, "Parsed data, analysis, tree, colour maps.", {"data": [], "analysis": {}, "tree": {}, "colourMaps": {}}),
            R(400, "Invalid CSV.", {"detail": "Could not parse CSV"}),
        ],
        "examples": {
            "responses": {
                "200": {"data": [], "analysis": {}, "tree": {}, "colourMaps": {}},
                "400": {"detail": "Could not parse CSV"},
            }
        },
    },
    {
        "id": "get-hierarchy-order",
        "method": "GET",
        "path": "/api/hierarchy-order",
        "title": "Get custom dimension order",
        "navLabel": "Get dimension order",
        "description": "Returns persisted hierarchy column ordering per project.",
        "auth": "bearer",
        "keywords": "hierarchy order",
        "queryParams": [
            P("projectId", "string", False, "Project scope."),
            P("projectKey", "string", False, "Legacy alias for projectId."),
        ],
        "responses": [R(200, "Saved column indices.", {"order": [2, 0, 1, 3]})],
        "examples": {"responses": {"200": {"order": [2, 0, 1, 3]}}},
    },
    {
        "id": "put-hierarchy-order",
        "method": "PUT",
        "path": "/api/hierarchy-order",
        "title": "Save custom dimension order",
        "navLabel": "Save dimension order",
        "description": "Persists hierarchy dimension order to ui_preference.",
        "auth": "bearer",
        "keywords": "hierarchy order save",
        "queryParams": [
            P("projectId", "string", False, "Project scope."),
            P("projectKey", "string", False, "Legacy alias."),
        ],
        "bodyParams": [P("order", "integer[]", True, "Non-negative column indices.", constraints=["min length: 1"])],
        "_sample_body": {"order": [2, 0, 1, 3]},
        "responses": [R(200, "Persisted order.", {"order": [2, 0, 1, 3]})],
        "examples": {"responses": {"200": {"order": [2, 0, 1, 3]}}},
    },
    {
        "id": "delete-hierarchy-order",
        "method": "DELETE",
        "path": "/api/hierarchy-order",
        "title": "Clear custom dimension order",
        "navLabel": "Clear dimension order",
        "description": "Removes persisted hierarchy order.",
        "auth": "bearer",
        "keywords": "hierarchy order clear",
        "queryParams": [
            P("projectId", "string", False, "Project scope."),
            P("projectKey", "string", False, "Legacy alias."),
        ],
        "responses": [R(200, "Cleared.", {"ok": True})],
        "examples": {"responses": {"200": {"ok": True}}},
    },
    {
        "id": "get-cell-index",
        "method": "GET",
        "path": "/api/cell-record-index",
        "title": "Cell metadata index",
        "navLabel": "Cell index",
        "description": "Lightweight list of all cells with metadata, datasets, and protocol chips.",
        "auth": "bearer",
        "keywords": "cell index metadata",
        "queryParams": [P("projectId", "string", False, "Project scope.")],
        "responses": [
            R(
                200,
                "All cells in project.",
                {
                    "cells": [
                        {
                            "cellId": "Cell-001",
                            "idNo": 1,
                            "cathode": "NMC811",
                            "datasets": ["cycling", "discharge_dqdv"],
                            "protocolName": "Standard C/1",
                        }
                    ]
                },
            )
        ],
        "examples": {
            "responses": {
                "200": {
                    "cells": [
                        {
                            "cellId": "Cell-001",
                            "idNo": 1,
                            "cathode": "NMC811",
                            "datasets": ["cycling", "discharge_dqdv"],
                            "protocolName": "Standard C/1",
                        }
                    ]
                }
            }
        },
    },
    {
        "id": "get-cell-index-json",
        "method": "GET",
        "path": "/api/cell-record-index.json",
        "title": "Cell index (legacy alias)",
        "navLabel": "Cell index (.json)",
        "description": "Identical to <code>/api/cell-record-index</code>.",
        "auth": "bearer",
        "keywords": "cell index legacy",
        "legacy": "Legacy <code>.json</code> suffix for static-file deployment.",
        "queryParams": [P("projectId", "string", False, "Project scope.")],
        "responses": [R(200, "Same as cell-record-index.", {"cells": []})],
        "examples": {"responses": {"200": {"cells": []}}},
    },
    {
        "id": "get-cell-record",
        "method": "GET",
        "path": "/api/cell-record/{cell_id}",
        "title": "Full cycling curves",
        "navLabel": "Cycling curves",
        "description": "Per-cycle traces from cycling Parquet (voltage, capacity, time).",
        "auth": "bearer",
        "keywords": "cell record gcd cycling",
        "pathParams": [CELL_PATH],
        "queryParams": [
            P("projectId", "string", False, "Project scope."),
            P("maxPointsPerCycle", "integer", False, "Downsample per cycle.", default=None, constraints=["min: 50"]),
        ],
        "responses": [
            R(
                200,
                "Curves keyed by cycle number.",
                {
                    "cellId": "Cell-001",
                    "idNo": 1,
                    "curves": {"1": {"voltage": [3.0, 3.5], "capacity": [0.0, 1.2]}},
                },
            ),
            R(404, "Cell not found.", {"detail": "Cell 'Cell-001' not found"}),
        ],
        "examples": {
            "responses": {
                "200": {
                    "cellId": "Cell-001",
                    "idNo": 1,
                    "curves": {"1": {"voltage": [3.0, 3.5], "capacity": [0.0, 1.2]}},
                },
                "404": {"detail": "Cell 'Cell-001' not found"},
            }
        },
    },
    {
        "id": "get-cycle-summary",
        "method": "GET",
        "path": "/api/cell-record/{cell_id}/cycle-summary",
        "title": "Sparse per-cycle metrics",
        "navLabel": "Cycle summary",
        "description": "Retention, coulombic efficiency, and capacity at requested cycles.",
        "auth": "bearer",
        "keywords": "cycle summary",
        "pathParams": [CELL_PATH],
        "queryParams": [
            P("projectId", "string", False, "Project scope."),
            P("cycles", "string", False, "Comma-separated cycle numbers.", default="10,20,50,80"),
        ],
        "responses": [
            R(
                200,
                "Metrics at requested cycles.",
                {
                    "cellId": "Cell-001",
                    "idNo": 1,
                    "cycles": [{"cycle": 10, "retention": 98.2, "ce": 99.1, "capacity": 1.18}],
                },
            ),
            R(404, "Cell not in rate data.", {"detail": "Cell not found in rate-performance data"}),
        ],
        "examples": {
            "responses": {
                "200": {
                    "cellId": "Cell-001",
                    "idNo": 1,
                    "cycles": [{"cycle": 10, "retention": 98.2, "ce": 99.1, "capacity": 1.18}],
                },
                "404": {"detail": "Cell not found in rate-performance data"},
            }
        },
    },
    {
        "id": "get-differential",
        "method": "GET",
        "path": "/api/cell-record/{cell_id}/differential",
        "title": "dQ/dV and dV/dQ curves",
        "navLabel": "Differential curves",
        "description": "Pre-computed differential capacity datasets per cycle.",
        "auth": "bearer",
        "keywords": "differential dqdv dvdq",
        "pathParams": [CELL_PATH],
        "queryParams": [
            P("projectId", "string", False, "Project scope."),
            P("direction", "string", False, "discharge or charge.", default="discharge"),
        ],
        "responses": [
            R(
                200,
                "Per-cycle dqdv and dvdq arrays.",
                {
                    "cellId": "Cell-001",
                    "direction": "discharge",
                    "cycles": {"1": {"dqdv": {"v": [3.2], "dq": [0.01]}, "dvdq": {"q": [0.5], "dv": [0.02]}}},
                },
            ),
            R(404, "Cell not found.", {"detail": "Cell 'Cell-001' not found"}),
        ],
        "examples": {
            "responses": {
                "200": {
                    "cellId": "Cell-001",
                    "direction": "discharge",
                    "cycles": {"1": {"dqdv": {"v": [3.2], "dq": [0.01]}, "dvdq": {"q": [0.5], "dv": [0.02]}}},
                },
                "404": {"detail": "Cell 'Cell-001' not found"},
            }
        },
    },
    {
        "id": "get-differential-cells",
        "method": "GET",
        "path": "/api/differential-cells",
        "title": "Cells with differential data",
        "navLabel": "Differential cell list",
        "description": "Cell IDs with both dQ/dV and dV/dQ for the given direction.",
        "auth": "bearer",
        "keywords": "differential cells list",
        "queryParams": [
            P("projectId", "string", False, "Project scope."),
            P("direction", "string", False, "discharge or charge.", default="discharge"),
        ],
        "responses": [R(200, "Matching cell IDs.", {"cellIds": ["Cell-001", "Cell-002"]})],
        "examples": {"responses": {"200": {"cellIds": ["Cell-001", "Cell-002"]}}},
    },
    {
        "id": "get-rate-performance",
        "method": "GET",
        "path": "/api/rate-performance",
        "title": "Rate-performance bulk payload",
        "navLabel": "Rate performance",
        "description": "Per-cell per-cycle capacity arrays and protocols. Large payload; gzip-compressed when ≥ 1 KB.",
        "auth": "bearer",
        "keywords": "rate performance",
        "queryParams": [
            P("projectId", "string", False, "Project scope."),
            P("cathode", "string", False, "Cathode filter."),
            P("separator", "string", False, "Separator filter."),
            P("spacer", "string", False, "Spacer mm filter."),
        ],
        "responses": [
            R(
                200,
                "cells array + protocols list.",
                {
                    "cells": [{"cellId": "Cell-001", "capacities": [1.2, 1.19], "cycles": [1, 2]}],
                    "protocols": ["Standard C/1"],
                },
            )
        ],
        "examples": {
            "responses": {
                "200": {
                    "cells": [{"cellId": "Cell-001", "capacities": [1.2, 1.19], "cycles": [1, 2]}],
                    "protocols": ["Standard C/1"],
                }
            }
        },
    },
    {
        "id": "get-rate-performance-json",
        "method": "GET",
        "path": "/api/rate-performance.json",
        "title": "Rate performance (legacy)",
        "navLabel": "Rate performance (.json)",
        "description": "Identical to <code>/api/rate-performance</code>.",
        "auth": "bearer",
        "keywords": "rate performance legacy",
        "legacy": "Legacy <code>.json</code> suffix.",
        "queryParams": [P("projectId", "string", False, "Project scope.")],
        "responses": [R(200, "Same as rate-performance.", {"cells": [], "protocols": []})],
        "examples": {"responses": {"200": {"cells": [], "protocols": []}}},
    },
    {
        "id": "patch-cell",
        "method": "PATCH",
        "path": "/api/cells/{cell_id}",
        "title": "Update cell metadata",
        "navLabel": "Patch cell metadata",
        "description": "Partial update of allow-listed fields. Pass <code>null</code> to clear a field.",
        "auth": "bearer",
        "keywords": "cell metadata patch",
        "pathParams": [CELL_PATH],
        "queryParams": [P("projectId", "string", False, "Project scope.")],
        "bodyParams": [
            P("cathode", "string", False, "Cathode material."),
            P("anode", "string", False, "Anode material."),
            P("notes", "string", False, "Free-text notes."),
        ],
        "_sample_body": {"cathode": "NMC811", "notes": "Re-test after separator swap"},
        "responses": [
            R(200, "Refreshed cell + updated field list.", {"cell": {"cellId": "Cell-001"}, "updated": ["cathode", "notes"]}),
            R(404, "Cell not found.", {"detail": "Cell not found"}),
        ],
        "examples": {
            "responses": {
                "200": {"cell": {"cellId": "Cell-001", "cathode": "NMC811"}, "updated": ["cathode", "notes"]},
                "404": {"detail": "Cell not found"},
            }
        },
    },
    {
        "id": "put-cell-protocol",
        "method": "PUT",
        "path": "/api/cells/{cell_id}/protocol",
        "title": "Attach protocol to cell",
        "navLabel": "Attach protocol",
        "description": "Writes protocol_segments to cell and mirrors to cycling dataset meta.",
        "auth": "bearer",
        "keywords": "protocol attach",
        "pathParams": [CELL_PATH],
        "queryParams": [P("projectId", "string", False, "Project scope.")],
        "bodyParams": [
            P("protocolName", "string", False, "Display label."),
            P("segments", "object[]", True, "cycleStart, cycleEnd, cRate, optional name."),
        ],
        "_sample_body": {"protocolName": "Standard C/1", "segments": SAMPLE_PROTOCOL_SEGMENTS},
        "responses": [
            R(200, "Updated cell with protocol.", {"cell": {"cellId": "Cell-001"}, "protocolName": "Standard C/1"}),
            R(404, "Cell not found.", {"detail": "Cell not found"}),
        ],
        "examples": {
            "responses": {
                "200": {"cell": {"cellId": "Cell-001"}, "protocolName": "Standard C/1"},
                "404": {"detail": "Cell not found"},
            }
        },
    },
    {
        "id": "post-protocol-bulk",
        "method": "POST",
        "path": "/api/cells/protocol/bulk",
        "title": "Bulk protocol attach",
        "navLabel": "Bulk attach protocol",
        "description": "Apply the same protocol schedule to many cells.",
        "auth": "bearer",
        "keywords": "protocol bulk",
        "queryParams": [P("projectId", "string", False, "Project scope.")],
        "bodyParams": [
            P("cellIds", "string[]", True, "Target cell IDs."),
            P("protocolName", "string", False, "Display label."),
            P("segments", "object[]", True, "Protocol segments."),
        ],
        "_sample_body": {"cellIds": ["Cell-001", "Cell-002"], "protocolName": "Standard C/1", "segments": SAMPLE_PROTOCOL_SEGMENTS},
        "responses": [
            R(
                200,
                "Applied count and any missing IDs.",
                {"applied": 2, "missing": [], "protocolName": "Standard C/1", "segments": SAMPLE_PROTOCOL_SEGMENTS},
            )
        ],
        "examples": {
            "responses": {
                "200": {"applied": 2, "missing": [], "protocolName": "Standard C/1", "segments": SAMPLE_PROTOCOL_SEGMENTS}
            }
        },
    },

    {
        "id": "delete-cell",
        "method": "DELETE",
        "path": "/api/cells/{cell_id}",
        "title": "Soft-delete a cell",
        "navLabel": "Delete cell",
        "description": "Sets <code>deleted_at</code> on the cell and its datasets (Parquet files remain on disk).",
        "auth": "bearer",
        "keywords": "cell delete soft",
        "pathParams": [CELL_PATH],
        "queryParams": [P("projectId", "string", False, "Project scope.")],
        "responses": [
            R(200, "Cell soft-deleted.", {"ok": True, "cellId": "Cell-001"}),
            R(404, "Cell not found.", {"detail": "Cell 'Cell-001' not found in project 'default'"}),
        ],
        "examples": {"responses": {"200": {"ok": True, "cellId": "Cell-001"}, "404": {"detail": "Cell 'Cell-001' not found in project 'default'"}}},
    },
    {
        "id": "get-master-plot-overview",
        "method": "GET",
        "path": "/api/master-plot/overview",
        "title": "Master Plot overview",
        "navLabel": "Overview aggregates",
        "description": "Per-condition aggregates and per-cell scalars (no per-cycle arrays).",
        "auth": "bearer",
        "keywords": "master plot overview aggregate",
        "queryParams": [P("projectId", "string", False, "Project scope.")],
        "responses": [
            R(
                200,
                "Overview payload for campaign dashboard.",
                {
                    "projectId": "proj_abc123",
                    "cellCount": 48,
                    "conditionCount": 6,
                    "protocolCellCount": 40,
                    "cells": [{"cellId": "Cell-001", "retention50": 96.5}],
                    "conditions": [{"key": "NMC811|PP", "cellCount": 24, "medianRetention50": 95.8}],
                },
            )
        ],
        "examples": {
            "responses": {
                "200": {
                    "projectId": "proj_abc123",
                    "cellCount": 48,
                    "conditionCount": 6,
                    "protocolCellCount": 40,
                    "cells": [{"cellId": "Cell-001", "retention50": 96.5}],
                    "conditions": [{"key": "NMC811|PP", "cellCount": 24, "medianRetention50": 95.8}],
                }
            }
        },
    },
    {
        "id": "get-master-plot-peak-shift",
        "method": "GET",
        "path": "/api/master-plot/peak-shift",
        "title": "Master Plot dQ/dV peak-shift",
        "navLabel": "Peak-shift scalars",
        "description": "Lazy per-cell dQ/dV peak-shift scalars (ΔV between early and late dominant peaks). Fetched on demand when the <code>dqdv-peak-shift</code> metric is selected — not part of the overview parity harness.",
        "auth": "bearer",
        "keywords": "master plot peak shift dqdv differential",
        "queryParams": [P("projectId", "string", False, "Project scope.")],
        "responses": [
            R(
                200,
                "Peak-shift scalars for cells with discharge dQ/dV data.",
                {
                    "cellCount": 42,
                    "valueCount": 38,
                    "cells": [{"cellId": "Cell-001", "peakShiftMv": 12.4}],
                },
            )
        ],
        "examples": {
            "responses": {
                "200": {
                    "cellCount": 42,
                    "valueCount": 38,
                    "cells": [{"cellId": "Cell-001", "peakShiftMv": 12.4}],
                }
            }
        },
    },
    {
        "id": "get-cell-annotation",
        "method": "GET",
        "path": "/api/cell-annotation/{cell_id}",
        "title": "Get annotation",
        "navLabel": "Get annotation",
        "description": "Note and tags for one cell.",
        "auth": "bearer",
        "keywords": "annotation get",
        "pathParams": [CELL_PATH],
        "queryParams": [P("projectId", "string", False, "Project scope.")],
        "responses": [
            R(
                200,
                "Annotation record.",
                {"cellId": "Cell-001", "note": "Suspect contact resistance", "tags": ["review"], "updatedAt": "2026-03-01T09:00:00Z"},
            ),
            R(404, "Cell not found.", {"detail": "Cell not found"}),
        ],
        "examples": {
            "responses": {
                "200": {"cellId": "Cell-001", "note": "Suspect contact resistance", "tags": ["review"], "updatedAt": "2026-03-01T09:00:00Z"},
                "404": {"detail": "Cell not found"},
            }
        },
    },
    {
        "id": "get-cell-annotations",
        "method": "GET",
        "path": "/api/cell-annotations",
        "title": "All annotations",
        "navLabel": "List annotations",
        "description": "Map keyed by cellId for the project.",
        "auth": "bearer",
        "keywords": "annotations bulk",
        "queryParams": [P("projectId", "string", False, "Project scope.")],
        "responses": [
            R(
                200,
                "Annotations keyed by cell ID.",
                {"annotations": {"Cell-001": {"note": "OK", "tags": [], "updatedAt": "2026-03-01T09:00:00Z"}}},
            )
        ],
        "examples": {
            "responses": {"200": {"annotations": {"Cell-001": {"note": "OK", "tags": [], "updatedAt": "2026-03-01T09:00:00Z"}}}}
        },
    },
    {
        "id": "put-cell-annotation",
        "method": "PUT",
        "path": "/api/cell-annotation/{cell_id}",
        "title": "Upsert annotation",
        "navLabel": "Upsert annotation",
        "description": "Partial note/tags update; creates or updates the record.",
        "auth": "bearer",
        "keywords": "annotation put",
        "pathParams": [CELL_PATH],
        "queryParams": [P("projectId", "string", False, "Project scope.")],
        "bodyParams": [
            P("note", "string", False, "Free-text note."),
            P("tags", "string[]", False, "Tag list."),
        ],
        "_sample_body": {"note": "Re-test scheduled", "tags": ["follow-up"]},
        "responses": [
            R(200, "Updated annotation.", {"cellId": "Cell-001", "note": "Re-test scheduled", "tags": ["follow-up"]}),
            R(404, "Cell not found.", {"detail": "Cell not found"}),
        ],
        "examples": {
            "responses": {
                "200": {"cellId": "Cell-001", "note": "Re-test scheduled", "tags": ["follow-up"]},
                "404": {"detail": "Cell not found"},
            }
        },
    },
    {
        "id": "get-upload-loaders",
        "method": "GET",
        "path": "/api/upload/loaders",
        "title": "Supported loaders",
        "navLabel": "Upload loaders",
        "description": "Test types and accepted file extensions for ingest.",
        "auth": "bearer",
        "keywords": "upload loaders",
        "responses": [
            R(
                200,
                "Loader registry.",
                {"loaders": [{"id": "metadata", "extensions": [".csv", ".xlsx"]}, {"id": "cycling", "extensions": [".csv", ".txt"]}]},
            )
        ],
        "examples": {
            "responses": {
                "200": {"loaders": [{"id": "metadata", "extensions": [".csv", ".xlsx"]}, {"id": "cycling", "extensions": [".csv", ".txt"]}]}
            }
        },
    },
    {
        "id": "post-upload",
        "method": "POST",
        "path": "/api/upload",
        "title": "Upload single file",
        "navLabel": "Upload file",
        "description": "Queues background ingest. Max 512 MB per file.",
        "auth": "bearer",
        "keywords": "upload file",
        "formParams": [
            P("file", "file", True, "File to ingest."),
            P("projectId", "string", False, "Target project."),
            P("fileType", "string", False, "Loader hint (metadata, cycling, …)."),
            P("primaryKeyHeader", "string", False, "Metadata primary-key column."),
            P("idNoHeader", "string", False, "Id-no column."),
            P("displayNameTemplate", "string", False, "Display name template."),
            P("metadataSheet", "string", False, "Spreadsheet sheet name."),
        ],
        "responses": [
            R(200, "Queued task.", {"taskId": "550e8400-e29b-41d4-a716-446655440000", "status": "queued"}),
            R(413, "File too large.", {"detail": "File exceeds 512 MB limit"}),
            R(415, "No matching loader.", {"detail": "Unsupported file type"}),
        ],
        "examples": {
            "responses": {
                "200": {"taskId": "550e8400-e29b-41d4-a716-446655440000", "status": "queued"},
                "413": {"detail": "File exceeds 512 MB limit"},
                "415": {"detail": "Unsupported file type"},
            }
        },
    },
    {
        "id": "post-upload-batch",
        "method": "POST",
        "path": "/api/upload/batch",
        "title": "Upload batch",
        "navLabel": "Batch upload",
        "description": "Multi-file upload as a single background task.",
        "auth": "bearer",
        "keywords": "upload batch",
        "formParams": [
            P("files", "file[]", True, "Files to ingest."),
            P("projectId", "string", False, "Target project."),
            P("fileType", "string", False, "Loader hint."),
        ],
        "responses": [
            R(200, "Queued batch.", {"taskId": "550e8400-e29b-41d4-a716-446655440001", "itemCount": 12}),
            R(415, "Incompatible loader.", {"detail": "Files require different loaders"}),
        ],
        "examples": {
            "responses": {
                "200": {"taskId": "550e8400-e29b-41d4-a716-446655440001", "itemCount": 12},
                "415": {"detail": "Files require different loaders"},
            }
        },
    },
    {
        "id": "post-metadata-options",
        "method": "POST",
        "path": "/api/upload/metadata-options",
        "title": "Inspect metadata file",
        "navLabel": "Metadata inspect",
        "description": "Returns column candidates before committing a metadata upload.",
        "auth": "bearer",
        "keywords": "metadata inspect",
        "formParams": [P("file", "file", True, "Spreadsheet or CSV.")],
        "responses": [
            R(
                200,
                "Column and sheet candidates.",
                {"keyCandidates": ["cell_id", "id_no"], "sheetNames": ["Sheet1"], "headerColumns": ["cell_id", "cathode"]},
            ),
            R(415, "No loader.", {"detail": "Unsupported file type"}),
        ],
        "examples": {
            "responses": {
                "200": {"keyCandidates": ["cell_id", "id_no"], "sheetNames": ["Sheet1"], "headerColumns": ["cell_id", "cathode"]},
                "415": {"detail": "Unsupported file type"},
            }
        },
    },
    {
        "id": "post-cell-file",
        "method": "POST",
        "path": "/api/cells/{cell_id}/files/{test_type}",
        "title": "Attach file to cell",
        "navLabel": "Attach cell file",
        "description": "Per-cell cycling file attach (cycling test type only).",
        "auth": "bearer",
        "keywords": "cell file attach",
        "pathParams": [
            P("cell_id", "string", True, "Cell ID."),
            P("test_type", "string", True, "Test type, e.g. cycling."),
        ],
        "formParams": [
            P("file", "file", True, "Cycling data file."),
            P("projectId", "string", False, "Project scope."),
        ],
        "responses": [
            R(200, "Queued attach.", {"taskId": "550e8400-e29b-41d4-a716-446655440002", "cellId": "Cell-001"}),
            R(404, "Cell not found.", {"detail": "Cell not found"}),
            R(415, "Unsupported type.", {"detail": "Only cycling attachments supported"}),
        ],
        "examples": {
            "responses": {
                "200": {"taskId": "550e8400-e29b-41d4-a716-446655440002", "cellId": "Cell-001"},
                "404": {"detail": "Cell not found"},
                "415": {"detail": "Only cycling attachments supported"},
            }
        },
    },
    {
        "id": "get-upload-status",
        "method": "GET",
        "path": "/api/upload/status/{task_id}",
        "title": "Upload task status",
        "navLabel": "Upload status",
        "description": "Poll ingest progress by task ID.",
        "auth": "bearer",
        "keywords": "upload status",
        "pathParams": [P("task_id", "string", True, "Task UUID.")],
        "queryParams": [P("projectId", "string", False, "Project scope.")],
        "responses": [
            R(
                200,
                "upload_task row.",
                {
                    "taskId": "550e8400-e29b-41d4-a716-446655440000",
                    "status": "completed",
                    "progress": 100,
                    "message": "Ingest finished",
                },
            ),
            R(404, "Task not found.", {"detail": "Upload task not found"}),
        ],
        "examples": {
            "responses": {
                "200": {
                    "taskId": "550e8400-e29b-41d4-a716-446655440000",
                    "status": "completed",
                    "progress": 100,
                    "message": "Ingest finished",
                },
                "404": {"detail": "Upload task not found"},
            }
        },
    },
    {
        "id": "get-upload-history",
        "method": "GET",
        "path": "/api/upload/history",
        "title": "Upload history",
        "navLabel": "Upload history",
        "description": "Last 20 upload tasks for the project.",
        "auth": "bearer",
        "keywords": "upload history",
        "queryParams": [P("projectId", "string", False, "Project scope.")],
        "responses": [
            R(
                200,
                "Recent tasks.",
                {"tasks": [{"taskId": "550e8400-e29b-41d4-a716-446655440000", "status": "completed", "createdAt": "2026-03-10T12:00:00Z"}]},
            )
        ],
        "examples": {
            "responses": {
                "200": {"tasks": [{"taskId": "550e8400-e29b-41d4-a716-446655440000", "status": "completed", "createdAt": "2026-03-10T12:00:00Z"}]}
            }
        },
    },
    {
        "id": "get-protocol-templates",
        "method": "GET",
        "path": "/api/protocol-templates",
        "title": "List protocol templates",
        "navLabel": "List templates",
        "description": "Built-in and user-saved C-rate schedule templates.",
        "auth": "bearer",
        "keywords": "protocol templates",
        "queryParams": [P("projectId", "string", False, "Project scope.")],
        "responses": [
            R(
                200,
                "Template list.",
                {
                    "templates": [
                        {"id": "builtin_c1", "name": "Standard C/1", "builtin": True, "segments": SAMPLE_PROTOCOL_SEGMENTS}
                    ]
                },
            )
        ],
        "examples": {
            "responses": {
                "200": {
                    "templates": [
                        {"id": "builtin_c1", "name": "Standard C/1", "builtin": True, "segments": SAMPLE_PROTOCOL_SEGMENTS}
                    ]
                }
            }
        },
    },
    {
        "id": "post-protocol-templates",
        "method": "POST",
        "path": "/api/protocol-templates",
        "title": "Create protocol template",
        "navLabel": "Create template",
        "description": "Save a reusable C-rate schedule template.",
        "auth": "bearer",
        "keywords": "protocol template create",
        "queryParams": [P("projectId", "string", False, "Project scope.")],
        "bodyParams": [
            P("name", "string", True, "Template name."),
            P("description", "string", False, "Optional description."),
            P("segments", "object[]", True, "Protocol segments."),
        ],
        "_sample_body": {"name": "Fast charge", "description": "2C mid-life", "segments": SAMPLE_PROTOCOL_SEGMENTS},
        "responses": [
            R(200, "Created template.", {"id": "tmpl_custom_01", "name": "Fast charge", "segments": SAMPLE_PROTOCOL_SEGMENTS}),
            R(400, "Invalid segments.", {"detail": "Invalid protocol segments"}),
        ],
        "examples": {
            "responses": {
                "200": {"id": "tmpl_custom_01", "name": "Fast charge", "segments": SAMPLE_PROTOCOL_SEGMENTS},
                "400": {"detail": "Invalid protocol segments"},
            }
        },
    },
    {
        "id": "delete-protocol-template",
        "method": "DELETE",
        "path": "/api/protocol-templates/{template_id}",
        "title": "Delete protocol template",
        "navLabel": "Delete template",
        "description": "Deletes a user template. Built-in templates cannot be removed.",
        "auth": "bearer",
        "keywords": "protocol template delete",
        "pathParams": [P("template_id", "string", True, "Template ID.")],
        "queryParams": [P("projectId", "string", False, "Project scope.")],
        "responses": [
            R(200, "Deleted.", {"id": "tmpl_custom_01"}),
            R(403, "Built-in template.", {"detail": "Cannot delete built-in template"}),
            R(404, "Not found.", {"detail": "Template not found"}),
        ],
        "examples": {
            "responses": {
                "200": {"id": "tmpl_custom_01"},
                "403": {"detail": "Cannot delete built-in template"},
                "404": {"detail": "Template not found"},
            }
        },
    },
    {
        "id": "post-digibat-connect",
        "method": "POST",
        "path": "/api/digibat/connect",
        "title": "Connect DIGIBAT",
        "navLabel": "Connect DIGIBAT",
        "description": "Store DIGIBAT API credentials for a project.",
        "auth": "bearer",
        "keywords": "digibat connect",
        "bodyParams": [
            P("projectId", "string", True, "Project ID."),
            P("apiKey", "string", False, "User API key."),
            P("useDefault", "boolean", False, "Use server env key."),
            P("baseUrl", "string", False, "DIGIBAT base URL override."),
        ],
        "_sample_body": {"projectId": "proj_abc123", "useDefault": True},
        "responses": [
            R(200, "Connected.", {"ok": True, "projectId": "proj_abc123"}),
            R(400, "Missing key.", {"detail": "API key required"}),
        ],
        "examples": {"responses": {"200": {"ok": True, "projectId": "proj_abc123"}, "400": {"detail": "API key required"}}},
    },
    {
        "id": "post-digibat-manual",
        "method": "POST",
        "path": "/api/digibat/manual-project",
        "title": "Manual DIGIBAT project",
        "navLabel": "Manual project",
        "description": "Create a project with placeholder cells for manual DIGIBAT workflow.",
        "auth": "bearer",
        "keywords": "digibat manual",
        "bodyParams": [
            P("projectName", "string", True, "Display name."),
            P("cells", "object[]", False, "Optional cellName and idNo pairs."),
        ],
        "_sample_body": {"projectName": "Lab batch A", "cells": [{"cellName": "Cell-001", "idNo": 1}]},
        "responses": [R(200, "Created.", {"ok": True, "projectId": "proj_manual_01"})],
        "examples": {"responses": {"200": {"ok": True, "projectId": "proj_manual_01"}}},
    },
    {
        "id": "get-digibat-collections",
        "method": "GET",
        "path": "/api/digibat/collections",
        "title": "List DIGIBAT collections",
        "navLabel": "List collections",
        "description": "Proxy to DIGIBAT collections API for the configured project.",
        "auth": "bearer",
        "keywords": "digibat collections",
        "queryParams": [P("projectId", "string", True, "Project (required).")],
        "responses": [
            R(
                200,
                "Configuration flag and collections.",
                {"configured": True, "collections": [{"id": "col_42", "name": "March batch", "cellCount": 96}]},
            )
        ],
        "examples": {
            "responses": {"200": {"configured": True, "collections": [{"id": "col_42", "name": "March batch", "cellCount": 96}]}}
        },
    },
    {
        "id": "get-digibat-collection-cells",
        "method": "GET",
        "path": "/api/digibat/collections/{collection_id}/cells",
        "title": "DIGIBAT collection cells",
        "navLabel": "Collection cells",
        "description": "Preview remote cells in a DIGIBAT collection.",
        "auth": "bearer",
        "keywords": "digibat collection cells",
        "pathParams": [P("collection_id", "string", True, "Collection ID.")],
        "queryParams": [P("projectId", "string", True, "Project scope.")],
        "responses": [
            R(
                200,
                "Remote cell previews.",
                {"cells": [{"refcode": "DB-001", "name": "Cell A", "status": "completed"}]},
            )
        ],
        "examples": {"responses": {"200": {"cells": [{"refcode": "DB-001", "name": "Cell A", "status": "completed"}]}}},
    },
    {
        "id": "post-digibat-sync",
        "method": "POST",
        "path": "/api/projects/{project_id}/digibat/sync",
        "title": "Start DIGIBAT sync",
        "navLabel": "Start sync",
        "description": "Queue a background incremental sync from DIGIBAT collections.",
        "auth": "bearer",
        "keywords": "digibat sync",
        "pathParams": [P("project_id", "string", True, "Project ID.")],
        "bodyParams": [
            P("collectionIds", "string[]", True, "Collections to sync."),
            P("selectedRefcodes", "string[]", False, "Cell subset."),
            P("maxItems", "integer", False, "Import cap."),
            P("dryRun", "boolean", False, "Simulate only."),
            P("fullResync", "boolean", False, "Ignore incremental cursor."),
            P("includeCycling", "boolean", False, "Pull cycling data."),
            P("verbose", "boolean", False, "Verbose logging."),
        ],
        "_sample_body": {"collectionIds": ["col_42"], "includeCycling": True},
        "responses": [
            R(200, "Queued sync.", {"status": "queued", "requestId": "sync_req_01"}),
            R(409, "Sync conflict.", {"detail": "Sync already in progress"}),
        ],
        "examples": {
            "responses": {
                "200": {"status": "queued", "requestId": "sync_req_01"},
                "409": {"detail": "Sync already in progress"},
            }
        },
    },
    {
        "id": "get-digibat-status",
        "method": "GET",
        "path": "/api/projects/{project_id}/digibat/status",
        "title": "DIGIBAT sync status",
        "navLabel": "Sync status",
        "description": "Latest sync run state and imported dataset count.",
        "auth": "bearer",
        "keywords": "digibat status",
        "pathParams": [P("project_id", "string", True, "Project ID.")],
        "responses": [
            R(
                200,
                "Current sync state.",
                {"status": "idle", "lastRun": "2026-03-14T18:00:00Z", "datasetCount": 128},
            )
        ],
        "examples": {"responses": {"200": {"status": "idle", "lastRun": "2026-03-14T18:00:00Z", "datasetCount": 128}}},
    },
    {
        "id": "get-digibat-runs",
        "method": "GET",
        "path": "/api/projects/{project_id}/digibat/runs",
        "title": "DIGIBAT sync runs",
        "navLabel": "Sync runs",
        "description": "Last 20 DIGIBAT sync runs for the project.",
        "auth": "bearer",
        "keywords": "digibat runs",
        "pathParams": [P("project_id", "string", True, "Project ID.")],
        "responses": [
            R(
                200,
                "Run history.",
                {"runs": [{"requestId": "sync_req_01", "status": "completed", "imported": 42, "startedAt": "2026-03-14T17:55:00Z"}]},
            )
        ],
        "examples": {
            "responses": {
                "200": {"runs": [{"requestId": "sync_req_01", "status": "completed", "imported": 42, "startedAt": "2026-03-14T17:55:00Z"}]}
            }
        },
    },
]

GROUPS = [
    ("HEALTH", ["get-health"]),
    ("PROJECTS", ["get-projects", "post-projects", "patch-projects", "delete-projects", "get-project-readiness"]),
    (
        "HIERARCHY & ANALYSIS",
        [
            "get-hierarchy",
            "post-hierarchy-analyse",
            "get-hierarchy-order",
            "put-hierarchy-order",
            "delete-hierarchy-order",
        ],
    ),
    (
        "CELLS & CYCLING",
        [
            "get-cell-index",
            "get-cell-index-json",
            "get-cell-record",
            "get-cycle-summary",
            "get-differential",
            "get-differential-cells",
            "get-rate-performance",
            "get-rate-performance-json",
            "patch-cell",
            "put-cell-protocol",
            "post-protocol-bulk",
            "delete-cell",
        ],
    ),
    ("MASTER PLOT", ["get-master-plot-overview", "get-master-plot-peak-shift"]),
    ("ANNOTATIONS", ["get-cell-annotation", "get-cell-annotations", "put-cell-annotation"]),
    (
        "UPLOAD & INGEST",
        [
            "get-upload-loaders",
            "post-upload",
            "post-upload-batch",
            "post-metadata-options",
            "post-cell-file",
            "get-upload-status",
            "get-upload-history",
        ],
    ),
    ("PROTOCOL TEMPLATES", ["get-protocol-templates", "post-protocol-templates", "delete-protocol-template"]),
    (
        "DIGIBAT",
        [
            "post-digibat-connect",
            "post-digibat-manual",
            "get-digibat-collections",
            "get-digibat-collection-cells",
            "post-digibat-sync",
            "get-digibat-status",
            "get-digibat-runs",
        ],
    ),
]


def _strip_private(ep: dict) -> dict:
    out = {k: v for k, v in ep.items() if not k.startswith("_")}
    for key in ("pathParams", "queryParams", "bodyParams", "formParams"):
        out.setdefault(key, [])
    if "examples" not in out:
        out["examples"] = {"responses": {str(r["status"]): r["example"] for r in out["responses"]}}
    out["examples"]["request"] = build_request_examples(ep)
    if "responses" not in out["examples"]:
        out["examples"]["responses"] = {}
    for r in out["responses"]:
        out["examples"]["responses"].setdefault(str(r["status"]), r["example"])
    return out


def build_spec() -> dict:
    by_id = {ep["id"]: _strip_private(ep) for ep in ENDPOINTS}
    ordered = [by_id[eid] for eid in (eid for _, ids in GROUPS for eid in ids)]
    groups = [{"title": title, "endpointIds": ids} for title, ids in GROUPS]
    return {"groups": groups, "endpoints": ordered}


def render_page(spec: dict) -> str:
    n = len(spec["endpoints"])
    spec_json = json.dumps(spec, ensure_ascii=False, separators=(",", ":"))
    # Prevent </script> breakage
    spec_json = spec_json.replace("</", "<\\/")

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>REST API — CellSeer</title>
<link rel="stylesheet" href="styles.css">
</head>
<body class="api-page">
<header class="topbar">
  <a class="logo" href="index.html"><img src="assets/cellseer.svg" alt="CellSeer"> CellSeer repo</a>
  <span class="spacer"></span>
  <a class="ghlink cross-site" href="../index.html">User guide</a>
</header>

<div class="api-layout">
  <aside class="api-sidebar">
    <div class="api-sidebar-head">
      <nav class="api-breadcrumb" aria-label="Breadcrumb">
        <a href="index.html">Repo docs</a>
        <span class="sep">/</span>
        <span aria-current="page">API</span>
      </nav>
      <p class="api-sidebar-title">REST API reference</p>
    </div>
    <div class="api-sidebar-search-wrap">
      <input type="search" class="api-sidebar-search" id="api-search" placeholder="Search endpoints…" autocomplete="off" aria-label="Search endpoints">
      <span class="api-count" id="api-count">{n} endpoints</span>
    </div>
    <nav class="api-nav" id="api-nav" aria-label="Endpoints"></nav>
    <p class="api-sidebar-foot">{AUTH_NOTE}</p>
  </aside>

  <main class="api-main" id="api-main" aria-live="polite"></main>

  <aside class="api-examples" id="api-examples" aria-label="Code examples"></aside>
</div>

<script type="application/json" id="api-spec">{spec_json}</script>
<script src="api-app.js"></script>
</body>
</html>
"""


def main():
    spec = build_spec()
    assert len(spec["endpoints"]) == 45  # includes legacy .json aliases, f"Expected 45 endpoints, got {len(spec['endpoints'])}"
    page = render_page(spec)
    OUT.write_text(page)
    print(f"Wrote {OUT} ({len(spec['endpoints'])} endpoints, {len(page):,} bytes)")


if __name__ == "__main__":
    main()
