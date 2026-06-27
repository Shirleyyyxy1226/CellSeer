"""Cell-record API, split into record / differential / rate / protocol routers.

A single combined ``router`` is assembled here and mounted by api.py. The
catch-all ``GET /api/cell-record/{cell_id:path}`` (record.py) is registered
LAST so the more specific ``/differential`` and ``/cycle-summary`` routes win.
"""

from fastapi import APIRouter

from . import differential, protocol, rate, record

# Re-exported for existing imports elsewhere (routers/master_plot.py, tests).
from ._common import _load_rate_cells, invalidate_rate_cache  # noqa: F401
from .rate import rate_performance  # noqa: F401

router = APIRouter()
router.include_router(differential.router)
router.include_router(rate.router)
router.include_router(protocol.router)
router.include_router(record.router)  # keep last: catch-all /api/cell-record/{path}
