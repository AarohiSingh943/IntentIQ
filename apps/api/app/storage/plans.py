"""Durable storage for shared plans. SQLite keeps the service dependency-free; the interface is
narrow enough to swap for Postgres later."""

from __future__ import annotations

import json
import secrets
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from typing import Any

_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


def new_plan_id(length: int = 8) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


class PlanStore:
    def __init__(self, path: str):
        self.path = path
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._lock = Lock()
        self._migrate()

    def _migrate(self) -> None:
        with self._lock:
            self._conn.execute(
                """
                CREATE TABLE IF NOT EXISTS plans (
                    id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    views INTEGER NOT NULL DEFAULT 0,
                    payload TEXT NOT NULL
                )
                """
            )
            self._conn.commit()

    def save(self, payload: dict[str, Any]) -> str:
        body = json.dumps(payload, ensure_ascii=False, default=str)
        with self._lock:
            for _ in range(5):
                plan_id = new_plan_id()
                try:
                    self._conn.execute(
                        "INSERT INTO plans (id, created_at, payload) VALUES (?, ?, ?)",
                        (plan_id, datetime.now(UTC).isoformat(), body),
                    )
                    self._conn.commit()
                    return plan_id
                except sqlite3.IntegrityError:
                    continue
        raise RuntimeError("could not allocate a plan id")

    def get(self, plan_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT payload FROM plans WHERE id = ?", (plan_id,)).fetchone()
            if row is None:
                return None
            self._conn.execute("UPDATE plans SET views = views + 1 WHERE id = ?", (plan_id,))
            self._conn.commit()
        return json.loads(row[0])

    def count(self) -> int:
        with self._lock:
            return int(self._conn.execute("SELECT COUNT(*) FROM plans").fetchone()[0])
