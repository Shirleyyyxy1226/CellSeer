from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class DigibatConfig:
    base_url: str
    api_key: str
    timeout_seconds: int


def load_digibat_config_from_env() -> DigibatConfig:
    base_url = os.environ.get("DATALAB_BASE_URL", "https://digibat.dept.ic.ac.uk").strip().rstrip("/")
    api_key = os.environ.get("DATALAB_API_KEY", "").strip()
    timeout_seconds = int(os.environ.get("DATALAB_TIMEOUT", "60"))
    if not api_key:
        raise RuntimeError("Missing DATALAB_API_KEY in environment")
    return DigibatConfig(
        base_url=base_url,
        api_key=api_key,
        timeout_seconds=timeout_seconds,
    )
