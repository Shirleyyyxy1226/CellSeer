"""Shared database connection helper — PostgreSQL via psycopg2."""

import psycopg2
import psycopg2.extras
from contextlib import contextmanager

from config import DATABASE_URL
from project_scope import ensure_project_schema


def _adapt_sql(sql: str) -> str:
    """Convert SQLite dialect to PostgreSQL dialect."""
    return sql.replace("?", "%s").replace("datetime('now')", "NOW()")


class _PGConn:
    """Thin adapter that makes a psycopg2 connection look like sqlite3 to existing code.

    - .execute(sql, params) returns a RealDictCursor (supports row["col"] access)
    - .commit() / .rollback() / .close() delegate directly
    - SQL placeholders ?  are auto-converted to %s
    - SQLite datetime('now') is auto-converted to NOW()
    """

    def __init__(self, pg_conn) -> None:
        self._conn = pg_conn

    def execute(self, sql: str, params=None):
        sql = _adapt_sql(sql)
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params if params is not None else ())
        return cur

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def close(self) -> None:
        self._conn.close()


@contextmanager
def get_db():
    raw = psycopg2.connect(DATABASE_URL)
    conn = _PGConn(raw)
    ensure_project_schema(conn)
    try:
        yield conn
    except Exception:
        raw.rollback()
        raise
    finally:
        raw.close()


def get_or_404(conn, query: str, params: tuple, detail: str):
    from fastapi import HTTPException
    row = conn.execute(query, params).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=detail)
    return row
