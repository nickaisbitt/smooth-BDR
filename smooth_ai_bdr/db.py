import json
import sqlite3
from pathlib import Path

from . import config

DB_PATH = Path(config.env("SAB_DB", str(config.HOME / "data" / "sab.sqlite3")))

SCHEMA = """
CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY,
    website TEXT UNIQUE,
    name TEXT DEFAULT '',
    location TEXT DEFAULT '',
    description TEXT DEFAULT '',
    email TEXT DEFAULT '',
    status TEXT DEFAULT 'discovered',
    fit_score INTEGER DEFAULT 0,
    business_type TEXT DEFAULT '',
    audit_json TEXT DEFAULT '',
    plan_text TEXT DEFAULT '',
    ingested_at TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
"""


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def upsert_discovered(conn, website: str, name: str, description: str) -> bool:
    cur = conn.execute(
        "INSERT OR IGNORE INTO leads (website, name, description) VALUES (?, ?, ?)",
        (website, name, description[:500]),
    )
    conn.commit()
    return cur.rowcount > 0


def pending_audit(conn, limit: int):
    return conn.execute(
        "SELECT * FROM leads WHERE status = 'discovered' ORDER BY id LIMIT ?", (limit,)
    ).fetchall()


def save_audit(conn, lead_id: int, audit: dict, plan_text: str) -> None:
    conn.execute(
        "UPDATE leads SET status=?, fit_score=?, business_type=?, audit_json=?, plan_text=? WHERE id=?",
        (
            "audited",
            int(audit.get("fit_score", 0)),
            audit.get("business_type", ""),
            json.dumps(audit, ensure_ascii=False),
            plan_text,
            lead_id,
        ),
    )
    conn.commit()


def save_email(conn, lead_id: int, email: str) -> None:
    conn.execute("UPDATE leads SET email=?, status='ready' WHERE id=? AND status='audited'", (email, lead_id))
    conn.commit()


def ready_for_ingest(conn, min_fit: int, limit: int):
    return conn.execute(
        "SELECT * FROM leads WHERE status='ready' AND email != '' AND fit_score >= ? AND ingested_at = '' ORDER BY fit_score DESC LIMIT ?",
        (min_fit, limit),
    ).fetchall()


def mark_ingested(conn, lead_id: int) -> None:
    conn.execute("UPDATE leads SET ingested_at=datetime('now') WHERE id=?", (lead_id,))
    conn.commit()


def stats(conn) -> list:
    return conn.execute("SELECT status, COUNT(*) n FROM leads GROUP BY status ORDER BY status").fetchall()
