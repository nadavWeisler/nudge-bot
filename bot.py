"""NudgeBot — couple task manager bot.

Just send any text to add a task.

Commands:
  /list          Open tasks grouped by assignee (with ✅ buttons)
  /mine          Tasks assigned to you
  /theirs        Tasks assigned to others
  /done <id>     Mark a task done
  /delete <id>   Delete a task
  /assign <id>   Pick who to assign (inline keyboard)
  /stats         Summary: who has what, who completed what
  /history       Recently completed tasks
  /nudge         Send open tasks summary now
  /chatid        Show this chat's ID
  /help          Show help
"""
import logging
import os
import re
from datetime import time as dtime

from dotenv import load_dotenv
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

import db

load_dotenv()
logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("nudgebot")

BOT_TOKEN = os.environ["BOT_TOKEN"]


def _parse_chat_ids(raw: str) -> set[int]:
    return {int(x.strip()) for x in raw.split(",") if x.strip().lstrip("-").isdigit()}

_raw_ids = os.environ.get("ALLOWED_CHAT_IDS") or os.environ.get("ALLOWED_CHAT_ID") or ""
ALLOWED_CHAT_IDS: set[int] = _parse_chat_ids(_raw_ids)


def _parse_schedules(raw: str) -> list[dtime]:
    times = []
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        try:
            h, m = entry.split(":")
            times.append(dtime(hour=int(h), minute=int(m)))
        except Exception:
            logger.warning("Invalid schedule entry: %r", entry)
    return times

_raw_schedules = (
    os.environ.get("NUDGE_SCHEDULES") or
    f"{os.environ.get('NUDGE_HOUR', '8')}:{os.environ.get('NUDGE_MINUTE', '0')}"
)
NUDGE_SCHEDULES: list[dtime] = _parse_schedules(_raw_schedules) or [dtime(hour=8, minute=0)]


# ── Helpers ───────────────────────────────────────────────────────────────────

def display_name(user) -> str:
    return user.first_name or user.username or str(user.id)


async def guard(update: Update) -> bool:
    if ALLOWED_CHAT_IDS and update.effective_chat.id not in ALLOWED_CHAT_IDS:
        await update.effective_message.reply_text("⛔ This bot is private.")
        return False
    return True


def seen(user):
    """Upsert a user so they appear in assignment keyboards."""
    db.upsert_user(user.id, display_name(user))


def assign_keyboard(task_id: int, exclude_name: str = "") -> InlineKeyboardMarkup:
    """Build assignment keyboard from known users + Unassigned."""
    users = [u for u in db.list_users() if u["name"] != exclude_name]
    buttons = [
        InlineKeyboardButton(f"👤 {u['name']}", callback_data=f"assign:{task_id}:{u['name']}")
        for u in users
    ]
    buttons.append(InlineKeyboardButton("⬜ Unassigned", callback_data=f"assign:{task_id}:"))
    # Arrange in rows of 2
    rows = [buttons[i:i+2] for i in range(0, len(buttons), 2)]
    return InlineKeyboardMarkup(rows)


def action_keyboard(task_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ Done", callback_data=f"done:{task_id}"),
        InlineKeyboardButton("👤 Assign", callback_data=f"reassign:{task_id}"),
        InlineKeyboardButton("🗑 Delete", callback_data=f"delete:{task_id}"),
    ]])


def format_task_list(tasks: list[dict], title: str) -> str:
    if not tasks:
        return f"🎉 No tasks in *{title}*!"
    lines = [f"*{title}*\n"]
    for t in tasks:
        assigned = f"  →  _{t['assigned_to']}_" if t.get("assigned_to") else ""
        lines.append(f"• *#{t['id']}* {t['title']}{assigned}")
    return "\n".join(lines)


def grouped_list_message(tasks: list[dict], my_name: str) -> tuple[str, InlineKeyboardMarkup]:
    """Format tasks grouped by assignee with done buttons."""
    if not tasks:
        return "🎉 No open tasks! You're all caught up.", InlineKeyboardMarkup([])

    mine    = [t for t in tasks if t.get("assigned_to") == my_name]
    theirs  = [t for t in tasks if t.get("assigned_to") and t["assigned_to"] != my_name]
    free    = [t for t in tasks if not t.get("assigned_to")]

    lines = [f"📋 *Open tasks ({len(tasks)})*\n"]
    buttons = []

    def render_group(group, label):
        if not group:
            return
        lines.append(f"\n{label}")
        for t in group:
            lines.append(f"  *#{t['id']}* {t['title']}")
            buttons.append([InlineKeyboardButton(
                f"✅ #{t['id']} {t['title'][:28]}",
                callback_data=f"done:{t['id']}"
            )])

    render_group(mine, "👤 *Yours*")
    render_group(theirs, "👥 *Theirs*")
    render_group(free, "⬜ *Unassigned*")

    return "\n".join(lines), InlineKeyboardMarkup(buttons)


# ── Commands ──────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update): return
    seen(update.effective_user)
    await update.message.reply_text(
        "👋 *NudgeBot* is ready!\n\n"
        "Just *send any message* to add a task — I'll ask who it's for.\n\n"
        "📋 /list — all open tasks\n"
        "👤 /mine — your tasks\n"
        "👥 /theirs — tasks for others\n"
        "📊 /stats — who has what\n"
        "📣 /nudge — send reminder now\n"
        "❓ /help — all commands",
        parse_mode="Markdown",
    )


async def cmd_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update): return
    seen(update.effective_user)
    await update.message.reply_text(
        "*NudgeBot commands:*\n\n"
        "💬 Just type anything → adds a task\n\n"
        "📋 /list — open tasks (grouped by assignee)\n"
        "👤 /mine — your tasks only\n"
        "👥 /theirs — tasks assigned to others\n"
        "✅ /done `<id>` — mark task done\n"
        "🗑 /delete `<id>` — delete a task\n"
        "👤 /assign `<id>` — reassign (shows picker)\n"
        "🕐 /history — recently completed\n"
        "📊 /stats — completion summary\n"
        "📣 /nudge — send reminder now\n"
        "🆔 /chatid — this chat's ID",
        parse_mode="Markdown",
    )


async def cmd_chatid(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        f"🆔 Chat ID: `{update.effective_chat.id}`\n"
        f"👤 Your ID: `{update.effective_user.id}`",
        parse_mode="Markdown",
    )


async def cmd_list(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update): return
    seen(update.effective_user)
    tasks = db.list_tasks("open")
    my_name = display_name(update.effective_user)
    text, kb = grouped_list_message(tasks, my_name)
    await update.message.reply_text(text, parse_mode="Markdown", reply_markup=kb)


async def cmd_mine(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update): return
    seen(update.effective_user)
    my_name = display_name(update.effective_user)
    tasks = [t for t in db.list_tasks("open") if t.get("assigned_to") == my_name]
    if not tasks:
        await update.message.reply_text("🎉 No tasks assigned to you!", parse_mode="Markdown")
        return
    lines = [f"👤 *Your tasks ({len(tasks)}):*\n"]
    buttons = []
    for t in tasks:
        lines.append(f"• *#{t['id']}* {t['title']}")
        buttons.append([InlineKeyboardButton(f"✅ #{t['id']} {t['title'][:28]}", callback_data=f"done:{t['id']}")])
    await update.message.reply_text(
        "\n".join(lines), parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(buttons)
    )


async def cmd_theirs(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update): return
    seen(update.effective_user)
    my_name = display_name(update.effective_user)
    tasks = [t for t in db.list_tasks("open") if t.get("assigned_to") and t["assigned_to"] != my_name]
    if not tasks:
        await update.message.reply_text("✨ No tasks assigned to others right now.", parse_mode="Markdown")
        return
    lines = [f"👥 *Their tasks ({len(tasks)}):*\n"]
    buttons = []
    for t in tasks:
        lines.append(f"• *#{t['id']}* {t['title']} → _{t['assigned_to']}_")
        buttons.append([InlineKeyboardButton(f"✅ #{t['id']} {t['title'][:28]}", callback_data=f"done:{t['id']}")])
    await update.message.reply_text(
        "\n".join(lines), parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(buttons)
    )


async def cmd_done(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update): return
    seen(update.effective_user)
    if not ctx.args or not ctx.args[0].isdigit():
        await update.message.reply_text("Usage: /done `<id>`", parse_mode="Markdown")
        return
    task_id = int(ctx.args[0])
    who = display_name(update.effective_user)
    task = db.complete_task(task_id, who)
    if not task or task["status"] != "done":
        await update.message.reply_text(f"Task #{task_id} not found or already done.")
        return
    remaining = len(db.list_tasks("open"))
    tail = f"\n_{remaining} task(s) still open._" if remaining else "\n\n🎉 *All done!*"
    await update.message.reply_text(
        f"✅ *{who}* marked done:\n_{task['title']}_{tail}",
        parse_mode="Markdown",
    )


async def cmd_delete(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update): return
    seen(update.effective_user)
    if not ctx.args or not ctx.args[0].isdigit():
        await update.message.reply_text("Usage: /delete `<id>`", parse_mode="Markdown")
        return
    task_id = int(ctx.args[0])
    task = db.get_task(task_id)
    if not task:
        await update.message.reply_text(f"Task #{task_id} not found.")
        return
    db.delete_task(task_id)
    await update.message.reply_text(f"🗑 Deleted: _{task['title']}_", parse_mode="Markdown")


async def cmd_assign(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update): return
    seen(update.effective_user)
    if not ctx.args or not ctx.args[0].isdigit():
        await update.message.reply_text("Usage: /assign `<id>`", parse_mode="Markdown")
        return
    task_id = int(ctx.args[0])
    task = db.get_task(task_id)
    if not task or task["status"] != "open":
        await update.message.reply_text(f"Task #{task_id} not found.")
        return
    await update.message.reply_text(
        f"👤 Who should handle *#{task_id}* _{task['title']}_?",
        parse_mode="Markdown",
        reply_markup=assign_keyboard(task_id),
    )


async def cmd_stats(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update): return
    seen(update.effective_user)
    s = db.stats()
    lines = [f"📊 *Task Stats*\n\n🔵 Open: *{s['open']}*   ✅ Done: *{s['done']}*"]

    if s["open_by_assignee"]:
        lines.append("\n*Open by person:*")
        for row in s["open_by_assignee"]:
            name = row["assigned_to"] or "Unassigned"
            lines.append(f"  • {name}: {row['cnt']}")

    if s["done_by_person"]:
        lines.append("\n*Completed by:*")
        for row in s["done_by_person"]:
            lines.append(f"  • {row['done_by']}: {row['cnt']} ✅")

    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def cmd_history(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update): return
    seen(update.effective_user)
    tasks = db.list_tasks("done")[-15:]
    if not tasks:
        await update.message.reply_text("No completed tasks yet.")
        return
    lines = [f"🕐 *Recently completed ({len(tasks)}):*\n"]
    for t in reversed(tasks):
        by = f" _by {t['done_by']}_" if t.get("done_by") else ""
        lines.append(f"• ~{t['title']}~{by}")
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def cmd_nudge(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update): return
    seen(update.effective_user)
    await send_nudge(ctx, chat_id=update.effective_chat.id)


# ── Plain text → add task ─────────────────────────────────────────────────────

async def on_plain_text(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update): return
    seen(update.effective_user)
    text = update.message.text.strip()
    who = display_name(update.effective_user)
    task = db.add_task(text, created_by=who)
    await update.message.reply_text(
        f"📝 *Added:* _{task['title']}_\n\nWho should do this?",
        parse_mode="Markdown",
        reply_markup=assign_keyboard(task["id"]),
    )


# ── Inline button callbacks ───────────────────────────────────────────────────

async def on_button(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    who = display_name(query.from_user)
    seen(query.from_user)

    parts = query.data.split(":", 2)
    action = parts[0]
    task_id = int(parts[1])

    if action == "done":
        task = db.complete_task(task_id, who)
        if not task or task["status"] != "done":
            await query.edit_message_text("Already done or not found.")
            return
        remaining = len(db.list_tasks("open"))
        tail = f"\n_{remaining} task(s) still open._" if remaining else "\n\n🎉 *All done!*"
        await query.edit_message_text(
            f"✅ *{who}* marked done:\n_{task['title']}_{tail}",
            parse_mode="Markdown",
        )

    elif action == "assign":
        name = parts[2] if len(parts) > 2 else ""
        task = db.assign_task(task_id, name)
        if not task:
            await query.edit_message_text("Task not found.")
            return
        label = f"_{name}_" if name else "_nobody (unassigned)_"
        await query.edit_message_text(
            f"👤 *#{task_id}* _{task['title']}_\nAssigned to {label}",
            parse_mode="Markdown",
            reply_markup=action_keyboard(task_id),
        )

    elif action == "reassign":
        task = db.get_task(task_id)
        if not task:
            await query.edit_message_text("Task not found.")
            return
        await query.edit_message_text(
            f"👤 Reassign *#{task_id}* _{task['title']}_\nPick someone:",
            parse_mode="Markdown",
            reply_markup=assign_keyboard(task_id),
        )

    elif action == "delete":
        task = db.get_task(task_id)
        if not task:
            await query.edit_message_text("Task not found.")
            return
        db.delete_task(task_id)
        await query.edit_message_text(f"🗑 *{who}* deleted: _{task['title']}_", parse_mode="Markdown")


# ── Scheduled nudge ───────────────────────────────────────────────────────────

async def send_nudge(ctx: ContextTypes.DEFAULT_TYPE, chat_id: int):
    tasks = db.list_tasks("open")
    if not tasks:
        await ctx.bot.send_message(chat_id, "🎉 No open tasks! All clear.")
        return

    lines = [f"📣 *Nudge — {len(tasks)} open task(s):*\n"]
    buttons = []
    for t in tasks:
        assigned = f" → _{t['assigned_to']}_" if t.get("assigned_to") else ""
        lines.append(f"• *#{t['id']}* {t['title']}{assigned}")
        buttons.append([InlineKeyboardButton(
            f"✅ #{t['id']} {t['title'][:28]}", callback_data=f"done:{t['id']}"
        )])

    await ctx.bot.send_message(
        chat_id, "\n".join(lines),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


async def daily_nudge(ctx: ContextTypes.DEFAULT_TYPE):
    if not ALLOWED_CHAT_IDS:
        logger.warning("ALLOWED_CHAT_IDS not set — skipping nudge")
        return
    for chat_id in ALLOWED_CHAT_IDS:
        await send_nudge(ctx, chat_id=chat_id)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    db.init_db()
    schedules_str = ", ".join(t.strftime("%H:%M") for t in NUDGE_SCHEDULES)
    logger.info("NudgeBot starting — nudges at %s — chats: %s", schedules_str, ALLOWED_CHAT_IDS)

    app = Application.builder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler("start",   cmd_start))
    app.add_handler(CommandHandler("help",    cmd_help))
    app.add_handler(CommandHandler("chatid",  cmd_chatid))
    app.add_handler(CommandHandler("list",    cmd_list))
    app.add_handler(CommandHandler("mine",    cmd_mine))
    app.add_handler(CommandHandler("theirs",  cmd_theirs))
    app.add_handler(CommandHandler("done",    cmd_done))
    app.add_handler(CommandHandler("delete",  cmd_delete))
    app.add_handler(CommandHandler("assign",  cmd_assign))
    app.add_handler(CommandHandler("stats",   cmd_stats))
    app.add_handler(CommandHandler("history", cmd_history))
    app.add_handler(CommandHandler("nudge",   cmd_nudge))
    app.add_handler(CallbackQueryHandler(on_button))
    # Plain text → add task (must be last)
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_plain_text))

    for i, t in enumerate(NUDGE_SCHEDULES):
        app.job_queue.run_daily(daily_nudge, time=t, name=f"daily_nudge_{i}")

    logger.info("NudgeBot polling…")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
