"""Bearer-token authentication middleware.

Single shared token model: every authenticated client sends the same
`Authorization: Bearer <token>` header. Suitable for small internal
deployments (1–3 trusted users); for per-user accounts we'd swap this out
for a session/JWT layer later.

Activation rules:
  - If `CELLSEER_API_TOKEN` is unset or empty, the middleware is a no-op.
    This preserves the original local-dev behaviour (no auth required).
  - When set, every request whose path starts with one of PROTECTED_PREFIXES
    must carry a matching bearer token, otherwise the response is 401.
  - EXEMPT_PATHS (currently just /api/health) bypass the check so platform
    healthchecks keep working without exposing a token.
"""

from __future__ import annotations

import hmac
import os
from typing import Iterable

from fastapi import FastAPI
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


PROTECTED_PREFIXES: tuple[str, ...] = ("/api/",)
EXEMPT_PATHS: frozenset[str] = frozenset({"/api/health"})


def _expected_token() -> str:
    return (os.environ.get("CELLSEER_API_TOKEN") or "").strip()


def _extract_token(request: Request) -> str | None:
    header = request.headers.get("authorization") or ""
    if header.lower().startswith("bearer "):
        return header[7:].strip() or None
    # Allow ?token= on the root page only (initial bootstrap).
    # API paths must use the Authorization header to avoid token leakage into server logs.
    if request.url.path in ("/", ""):
        token_param = request.query_params.get("token")
        if token_param:
            return token_param.strip() or None
    return None


def _is_protected(path: str, protected: Iterable[str]) -> bool:
    if path in EXEMPT_PATHS:
        return False
    return any(path.startswith(prefix) for prefix in protected)


class BearerTokenMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        expected = _expected_token()
        if not expected:
            return await call_next(request)
        if not _is_protected(request.url.path, PROTECTED_PREFIXES):
            return await call_next(request)
        supplied = _extract_token(request)
        if supplied is None or not hmac.compare_digest(supplied, expected):
            return JSONResponse(
                {"detail": "Missing or invalid API token"},
                status_code=401,
                headers={"WWW-Authenticate": 'Bearer realm="cellseer"'},
            )
        return await call_next(request)


def install(app: FastAPI) -> None:
    app.add_middleware(BearerTokenMiddleware)
