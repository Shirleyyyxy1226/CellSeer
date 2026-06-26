"""Shared utilities: logging, custom exceptions, deprecation helpers."""
from __future__ import annotations

import functools
import warnings
from typing import Any, Callable


def set_log_level(level: str) -> None:
    """Set the log level for the cellseer library. Accepts standard logging level names."""
    import logging
    logging.getLogger("cellseer").setLevel(getattr(logging, level.upper(), logging.WARNING))


class CellSeerValidationError(ValueError):
    """Raised when a data contract (required columns, schema) is violated."""


class CellSeerReaderError(IOError):
    """Raised when a reader cannot parse an input file."""


def deprecated(reason: str, version: str = "") -> Callable:
    """Decorator that emits a DeprecationWarning and notes the replacement."""
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            msg = f"{func.__name__} is deprecated"
            if version:
                msg += f" since v{version}"
            msg += f". {reason}"
            warnings.warn(msg, DeprecationWarning, stacklevel=2)
            return func(*args, **kwargs)
        return wrapper
    return decorator
