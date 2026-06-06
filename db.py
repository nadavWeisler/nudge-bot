"""SQLite task store for NudgeBot."""
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

DB_PATH = Path(__file__).parent / "nudge.db"


@contextmanager
def _conn():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init_db():
    with _conn() as con:
        con.executescript("""
            CREATE TABLE IF NOT EXISTS tasks (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                title       TEXT NOT NULL,
                created_by  TEXT NOT NULL,
                assigned_to TEXT DEFAULT '',
                status      TEXT DEFAULT 'open',
                created_at  TEXT DEFAULT (datetime('now')),
                done_at     TEXT,
                done_by     TEXT DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS known_users (
                user_id     INTEGER PRIMARY KEY,
                name        TEXT NOT NULL,
                last_seen   TEXT DEFAULT (datetime('now'))
            );
        """)


# ── Users ─────────────────────────────────────────────────────────────────────

def upsert_user(user_id: int, name: str):
    with _conn() as con:
        con.execute(
            "INSERT INTO known_users (user_id, name, last_seen) VALUES (?,?,datetime('now')) "
            "ON CONFLICT(user_id) DO UPDATE SET name=excluded.name, last_seen=excluded.last_seen",
            (user_id, name),
        )

def list_users() -> list[dict]:
    with _conn() as con:
        rows = con.execute("SELECT * FROM known_users ORDER BY name ASC").fetchall()
        return [dict(r) for r in rows]


# ── Tasks CRUD ────────────────────────────────────────────────────────────────

def add_task(title: str, created_by: str, assigned_to: str = "") -> dict:
    with _conn() as con:
        cur = con.execute(
            "INSERT INTO tasks (title, created_by, assigned_to) VALUES (?,?,?)",
            (title, created_by, assigned_to),
        )
        return get_task(cur.lastrowid)


def get_task(task_id: int) -> Optional[dict]:
    with _conn() as con:
        row = con.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        return dict(row) if row else None


def list_tasks(status: str = "open") -> list[dict]:
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM tasks WHERE status=? ORDER BY created_at ASC",
            (status,),
        ).fetchall()
        return [dict(r) for r in rows]


def complete_task(task_id: int, done_by: str) -> Optional[dict]:
    with _conn() as con:
        con.execute(
            "UPDATE tasks SET status='done', done_by=?, done_at=datetime('now') "
            "WHERE id=? AND status='open'",
            (done_by, task_id),
        )
    return get_task(task_id)


def delete_task(task_id: int) -> bool:
    with _conn() as con:
        cur = con.execute("DELETE FROM tasks WHERE id=?", (task_id,))
        return cur.rowcount > 0


def assign_task(task_id: int, assigned_to: str) -> Optional[dict]:
    with _conn() as con:
        con.execute(
            "UPDATE tasks SET assigned_to=? WHERE id=? AND status='open'",
            (assigned_to, task_id),
        )
    return get_task(task_id)


def stats() -> dict:
    with _conn() as con:
        open_tasks  = con.execute("SELECT COUNT(*) FROM tasks WHERE status='open'").fetchone()[0]
        done_tasks  = con.execute("SELECT COUNT(*) FROM tasks WHERE status='done'").fetchone()[0]
        by_assignee = con.execute(
            "SELECT assigned_to, COUNT(*) as cnt FROM tasks WHERE status='open' GROUP BY assigned_to"
        ).fetchall()
        by_completer = con.execute(
            "SELECT done_by, COUNT(*) as cnt FROM tasks WHERE status='done' AND done_by!='' GROUP BY done_by"
        ).fetchall()
    return {
        "open": open_tasks,
        "done": done_tasks,
        "open_by_assignee": [dict(r) for r in by_assignee],
        "done_by_person":   [dict(r) for r in by_completer],
    }
