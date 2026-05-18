"""Shared database connection helper."""

import sqlite3
from contextlib import contextmanager

from config import DB_PATH
from project_scope import ensure_project_schema


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    ensure_project_schema(conn)
    try:
        yield conn
    finally:
        conn.close()


def get_or_404(conn: sqlite3.Connection, query: str, params: tuple, detail: str) -> sqlite3.Row:
    from fastapi import HTTPException
    row = conn.execute(query, params).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=detail)
    return row
