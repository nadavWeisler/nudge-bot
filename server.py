"""NudgeBot dashboard API server.

Run alongside bot.py:
  uvicorn server:app --host 0.0.0.0 --port 5050
"""
from __future__ import annotations
import os
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

import db

ENV_PATH = Path(__file__).parent / ".env"
STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="NudgeBot Dashboard")

# ── Helpers ───────────────────────────────────────────────────────────────────

ENV_KEYS = ["BOT_TOKEN", "ALLOWED_CHAT_IDS", "NUDGE_SCHEDULES"]


def _split(raw: str) -> list[str]:
    return [x.strip() for x in raw.split(",") if x.strip()]


def read_env() -> dict:
    raw = {k: "" for k in ENV_KEYS}
    if not ENV_PATH.exists():
        return raw
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        if key in ENV_KEYS:
            raw[key] = val.strip()
        # backwards compat: fold old NUDGE_HOUR/NUDGE_MINUTE into NUDGE_SCHEDULES
        if key == "NUDGE_HOUR" and not raw.get("NUDGE_SCHEDULES"):
            raw["_nudge_hour"] = val.strip()
        if key == "NUDGE_MINUTE" and not raw.get("NUDGE_SCHEDULES"):
            raw["_nudge_minute"] = val.strip()

    if not raw["NUDGE_SCHEDULES"] and raw.get("_nudge_hour"):
        h = raw.pop("_nudge_hour", "8").zfill(2)
        m = raw.pop("_nudge_minute", "0").zfill(2)
        raw["NUDGE_SCHEDULES"] = f"{h}:{m}"

    return {
        "bot_token": raw["BOT_TOKEN"],
        "chat_ids": _split(raw["ALLOWED_CHAT_IDS"]),
        "nudge_schedules": _split(raw["NUDGE_SCHEDULES"]) or ["08:00"],
    }


def write_env(data: dict):
    """Write only managed keys; preserve comments and other lines."""
    flat = {
        "BOT_TOKEN": data.get("bot_token", ""),
        "ALLOWED_CHAT_IDS": ",".join(data.get("chat_ids", [])),
        "NUDGE_SCHEDULES": ",".join(data.get("nudge_schedules", [])),
    }
    lines = ENV_PATH.read_text().splitlines() if ENV_PATH.exists() else []
    written = set()

    new_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#") or "=" not in stripped:
            new_lines.append(line)
            continue
        key = stripped.split("=", 1)[0].strip()
        if key in flat:
            new_lines.append(f"{key}={flat[key]}")
            written.add(key)
        elif key in ("NUDGE_HOUR", "NUDGE_MINUTE"):
            pass  # drop old keys
        else:
            new_lines.append(line)

    for key, val in flat.items():
        if key not in written:
            new_lines.append(f"{key}={val}")

    ENV_PATH.write_text("\n".join(new_lines) + "\n")


# ── API routes ────────────────────────────────────────────────────────────────

@app.get("/api/stats")
def get_stats():
    db.init_db()
    return {
        "open": len(db.list_tasks("open")),
        "done": len(db.list_tasks("done")),
    }


@app.get("/api/tasks")
def get_tasks(status: str = "open"):
    db.init_db()
    return db.list_tasks(status)


class TaskCreate(BaseModel):
    title: str
    assigned_to: str = ""


@app.post("/api/tasks")
def create_task(body: TaskCreate):
    db.init_db()
    if not body.title.strip():
        raise HTTPException(400, "title required")
    return db.add_task(body.title.strip(), created_by="dashboard", assigned_to=body.assigned_to.strip())


class DoneBody(BaseModel):
    done_by: str = "dashboard"


@app.post("/api/tasks/{task_id}/done")
def done_task(task_id: int, body: DoneBody):
    db.init_db()
    task = db.complete_task(task_id, body.done_by)
    if not task or task["status"] != "done":
        raise HTTPException(404, "Task not found or already done")
    return task


@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: int):
    db.init_db()
    if not db.delete_task(task_id):
        raise HTTPException(404, "Task not found")
    return {"ok": True}


@app.get("/api/settings")
def get_settings():
    return read_env()


class SettingsBody(BaseModel):
    bot_token: str = ""
    chat_ids: list[str] = []
    nudge_schedules: list[str] = []


@app.post("/api/settings")
def save_settings(body: SettingsBody):
    write_env(body.model_dump())
    return {"ok": True}


@app.post("/api/nudge")
async def send_nudge():
    """Fire a nudge via the Telegram Bot API directly (no running bot needed)."""
    import httpx
    cfg = read_env()
    cfg = read_env()
    token = cfg.get("bot_token", "")
    chat_ids = cfg.get("chat_ids", [])
    if not token or not chat_ids:
        raise HTTPException(400, "BOT_TOKEN and ALLOWED_CHAT_IDS must be set")

    db.init_db()
    tasks = db.list_tasks("open")
    if not tasks:
        text = "🎉 No open tasks! All clear."
    else:
        lines = [f"📣 *Manual nudge — {len(tasks)} open task(s):*\n"]
        for t in tasks:
            assigned = f" → _{t['assigned_to']}_" if t.get("assigned_to") else ""
            lines.append(f"• #{t['id']} {t['title']}{assigned}")
        text = "\n".join(lines)

    async with httpx.AsyncClient(timeout=10) as client:
        for chat_id in chat_ids:
            r = await client.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"},
            )
            if not r.is_success:
                raise HTTPException(502, f"Telegram error for {chat_id}: {r.text}")

    return {"ok": True}


# ── Serve built React UI ──────────────────────────────────────────────────────

if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_ui(full_path: str):
        return FileResponse(STATIC_DIR / "index.html")
