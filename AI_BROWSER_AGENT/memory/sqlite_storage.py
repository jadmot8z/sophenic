"""Small, local transactions; no page HTML or screenshots persisted automatically."""

import json
import sqlite3
import threading
from datetime import datetime, timezone


def now():
    return datetime.now(timezone.utc).isoformat()


class SQLiteStorage:
    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        with self.db:
            self.db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY, goal TEXT NOT NULL, status TEXT NOT NULL,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '');
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
                    at TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS event_task ON events(task_id,id);
                CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS lessons (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, action TEXT, error TEXT);
            """)

    def create_task(self, task_id, goal):
        with self.lock, self.db:
            self.db.execute(
                "INSERT INTO tasks VALUES (?,?,?,?,?,?)", (task_id, goal, "queued", now(), now(), "")
            )

    def update_task(self, task_id, status, answer=""):
        with self.lock, self.db:
            self.db.execute(
                "UPDATE tasks SET status=?,answer=?,updated_at=? WHERE id=?", (status, answer, now(), task_id)
            )

    def event(self, task_id, kind, payload):
        with self.lock, self.db:
            self.db.execute(
                "INSERT INTO events(task_id,at,kind,payload) VALUES (?,?,?,?)",
                (task_id, now(), kind, json.dumps(payload, ensure_ascii=False)),
            )

    def tasks(self):
        with self.lock:
            return [
                dict(r) for r in self.db.execute("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100")
            ]

    def events(self, task_id, after=0):
        with self.lock:
            rows = self.db.execute(
                "SELECT * FROM events WHERE task_id=? AND id>? ORDER BY id LIMIT 500", (task_id, after)
            ).fetchall()
            return [{**dict(r), "payload": json.loads(r["payload"])} for r in rows]

    def recover_tasks(self):
        with self.lock, self.db:
            self.db.execute(
                "UPDATE tasks SET status='interrupted', answer=?, updated_at=? "
                "WHERE status IN ('queued', 'running')",
                ("Application interrompue ; relance manuelle requise", now()),
            )

    def close(self):
        with self.lock:
            self.db.close()
