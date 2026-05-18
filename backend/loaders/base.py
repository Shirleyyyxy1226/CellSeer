from abc import ABC, abstractmethod
from typing import Any, Callable, Optional


class BaseTestTypeLoader(ABC):
    SUPPORTED_EXTENSIONS: list[str]
    FILE_TYPE: str
    DISPLAY_NAME: str
    DESCRIPTION: str

    @abstractmethod
    def ingest(
        self,
        file_bytes: bytes,
        filename: str,
        conn,
        update_progress: Callable[[int, str], None],
        ingest_options: Optional[dict[str, Any]] = None,
    ) -> dict:
        ...
