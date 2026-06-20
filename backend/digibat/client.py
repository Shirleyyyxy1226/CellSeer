from __future__ import annotations

from typing import Any

import requests


class DigibatClient:
    def __init__(self, base_url: str, api_key: str, timeout_seconds: int = 60):
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.session = requests.Session()
        # DIGIBAT (datalab) expects the DATALAB-API-KEY header (see datalab_api lib).
        self.session.headers.update(
            {
                "DATALAB-API-KEY": api_key,
                "User-Agent": "CellSeer/DigibatClient",
            }
        )

    def get_json(self, path: str) -> dict[str, Any]:
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        response = self.session.get(url, timeout=self.timeout_seconds)
        if response.status_code in (401, 403):
            raise RuntimeError("Unauthorized from DIGIBAT API. Check DATALAB_API_KEY.")
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, dict) and payload.get("status") == "error":
            raise RuntimeError(payload.get("message") or "DIGIBAT returned an error payload.")
        return payload

    def download(self, url: str) -> tuple[bytes, str | None]:
        response = self.session.get(url, timeout=max(120, self.timeout_seconds))
        response.raise_for_status()
        return response.content, response.headers.get("content-type")
