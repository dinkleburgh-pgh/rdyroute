#!/usr/bin/env python3
"""
One-time migration: SQLite (truckv2_prod.db) → PostgreSQL for ReadyRoute V2.

Run inside the readyroutev2-backend container:

    # 1. Copy the SQLite file in
    docker cp /mnt/.ix-apps/docker/volumes/rdyroute_backend_data/_data/truckv2_prod.db \
              readyroutev2-backend:/tmp/truckv2_prod.db

    # 2. Run this script
    docker exec readyroutev2-backend python /app/deploy/migrate_sqlite_to_pg.py

Environment variables (already set by docker-compose):
    DATABASE_URL   — postgresql+psycopg://user:pass@host:port/db
    SQLITE_PATH    — override SQLite source path (default: /tmp/truckv2_prod.db)
"""

import json
import os
import sqlite3
import sys

import psycopg

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SQLITE_PATH = os.environ.get("SQLITE_PATH", "/tmp/truckv2_prod.db")

_raw_url = os.environ.get("DATABASE_URL", "")
if not _raw_url:
    sys.exit("ERROR: DATABASE_URL env var is not set")
# psycopg3 wants postgresql:// not postgresql+psycopg://
PG_DSN = _raw_url.replace("postgresql+psycopg://", "postgresql://")

# ---------------------------------------------------------------------------
# TruckType: SQLite stores Python identifier names; PostgreSQL enum uses values
# ---------------------------------------------------------------------------
TRUCK_TYPE_FIX = {"uniform": "Uniform", "dust": "Dust", "spare": "Spare"}

# ---------------------------------------------------------------------------
# JSON columns: stored as text strings in SQLite, need Python objects for psycopg
# ---------------------------------------------------------------------------
JSON_COLS: dict[str, set[str]] = {
    "trucks":        {"scheduled_off_days"},
    "app_settings":  {"value"},
}

# ---------------------------------------------------------------------------
# Table insertion order (parents before children to satisfy FK constraints)
# ---------------------------------------------------------------------------
TABLES = [
    "app_settings",           # no FK deps
    "users",
    "auth_requests",
    "sessions",
    "communication_messages",
    "trucks",
    "truck_states",           # FK → trucks
    "truck_notes",            # FK → trucks
    "load_durations",
    "shortages",
    "audit_entries",
    "audit_photos",           # FK → audit_entries
    "batches",
    "batch_history",
    "spare_assignments",
    "route_swaps",
    "notices",
]

# Tables whose PK is a TEXT/UUID (no integer sequence to reset)
NO_SEQUENCE_TABLES = {
    "app_settings",
    "sessions",
    "audit_entries",
    "audit_photos",
    "communication_messages",
}


# ---------------------------------------------------------------------------
# Value transformer
# ---------------------------------------------------------------------------

def transform(table: str, col: str, val):
    if val is None:
        return None

    # TruckType enum: name → value  (uniform → Uniform, etc.)
    if table == "trucks" and col == "truck_type":
        return TRUCK_TYPE_FIX.get(val, val)

    # JSON text columns: parse string → Python object
    if table in JSON_COLS and col in JSON_COLS[table]:
        if isinstance(val, str):
            try:
                return json.loads(val)
            except (json.JSONDecodeError, ValueError):
                return val

    return val


# ---------------------------------------------------------------------------
# Per-table migrator
# ---------------------------------------------------------------------------

def _migrate_table(sqlite_con: sqlite3.Connection, cur: psycopg.Cursor, table: str) -> int:
    # Skip tables that don't exist in the source SQLite
    exists = sqlite_con.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    if not exists:
        print(f"  [{table:30s}] not in SQLite — skipping")
        return 0

    rows = sqlite_con.execute(f"SELECT * FROM {table}").fetchall()  # noqa: S608
    if not rows:
        print(f"  [{table:30s}] empty — nothing to copy")
        return 0

    cols = list(rows[0].keys())
    col_list = ", ".join(f'"{c}"' for c in cols)
    placeholders = ", ".join(["%s"] * len(cols))

    cur.execute(f"TRUNCATE {table} CASCADE")  # noqa: S608

    sql = f'INSERT INTO {table} ({col_list}) VALUES ({placeholders})'  # noqa: S608
    data = [tuple(transform(table, c, row[c]) for c in cols) for row in rows]
    cur.executemany(sql, data)

    # Reset serial sequence so future INSERTs don't hit a PK collision
    if table not in NO_SEQUENCE_TABLES:
        cur.execute(f"""
            SELECT setval(
                pg_get_serial_sequence('{table}', 'id'),
                COALESCE(MAX(id), 1)
            ) FROM {table}
        """)  # noqa: S608

    count = len(data)
    print(f"  [{table:30s}] {count} rows migrated")
    return count


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def migrate():
    if not os.path.exists(SQLITE_PATH):
        sys.exit(f"ERROR: SQLite file not found at {SQLITE_PATH}")

    print(f"\nReadyRoute V2 — SQLite → PostgreSQL migration")
    print(f"  Source : {SQLITE_PATH}")
    print(f"  Target : ...@{PG_DSN.split('@', 1)[-1]}\n")  # hide credentials

    sqlite_con = sqlite3.connect(f"file:{SQLITE_PATH}?mode=ro", uri=True)
    sqlite_con.row_factory = sqlite3.Row

    total = 0
    with psycopg.connect(PG_DSN, autocommit=False) as pg_con:
        with pg_con.cursor() as cur:
            for table in TABLES:
                total += _migrate_table(sqlite_con, cur, table)
        pg_con.commit()

    sqlite_con.close()
    print(f"\nDone — {total} total rows committed to PostgreSQL.")


if __name__ == "__main__":
    migrate()
