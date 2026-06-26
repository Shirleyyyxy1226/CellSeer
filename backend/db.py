"""Shared database connection helper — PostgreSQL via psycopg2, pooled."""

import psycopg2
import psycopg2.extras
import psycopg2.pool
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


# Module-level connection pool. Connections are reused across requests so we pay
# the TCP + auth handshake once per pooled connection instead of on every
# request — the main per-request cost introduced by the SQLite -> PostgreSQL
# switch. ThreadedConnectionPool is safe for FastAPI's threadpool-run sync
# endpoints. Pool is created lazily so importing this module never fails when
# the database is briefly unreachable.
_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        _pool = psycopg2.pool.ThreadedConnectionPool(2, 20, DATABASE_URL)
    return _pool


@contextmanager
def get_db():
    pool = _get_pool()
    raw = pool.getconn()
    conn = _PGConn(raw)
    ensure_project_schema(conn)  # cached after the first call (fast no-op)
    raw.commit()  # persist any first-time schema DDL; an empty commit afterwards
    try:
        yield conn
    except Exception:
        raw.rollback()
        raise
    finally:
        # Reset any leftover / aborted transaction before returning the
        # connection to the pool, so the next borrower starts clean.
        try:
            raw.rollback()
        except Exception:
            pass
        pool.putconn(raw)


def get_or_404(conn, query: str, params: tuple, detail: str):
    from fastapi import HTTPException
    row = conn.execute(query, params).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=detail)
    return row
