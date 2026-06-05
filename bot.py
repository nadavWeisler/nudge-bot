"""NudgeBot — couple task manager bot.

Commands:
  /add <task>          Add a task (optionally: /add <task> @name)
  /list                Show all open tasks
  /done <id>           Mark a task as done
  /delete <id>         Delete a task
  /assign <id> @name   Assign a task to someone
  /done_list           Show recently completed tasks
  /nudge               Manually trigger a nudge summary
  /chatid              Show this chat's ID (for config)
  /help                Show help
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
ALLOWED_CHAT_ID = int(os.environ["ALLOWED_CHAT_ID"]) if os.environ.get("ALLOWED_CHAT_ID") else None
NUDGE_HOUR = int(os.environ.get("NUDGE_HOUR", 8))
NUDGE_MINUTE = int(os.environ.get("NUDGE_MINUTE", 0))


# ── Helpers ───────────────────────────────────────────────────────────────────

def display_name(user) -> str:
    if user.first_name:
        return user.first_name
    return user.username or str(user.id)


def task_line(t: dict) -> str:
    assigned = f" → @{t['assigned_to']}" if t.get("assigned_to") else ""
    return f"*#{t['id']}* {t['title']}{assigned}"


def build_done_keyboard(task_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ Done", callback_data=f"done:{task_id}"),
        InlineKeyboardButton("🗑 Delete", callback_data=f"delete:{task_id}"),
    ]])


async def guard(update: Update) -> bool:
    """Return True if message is allowed."""
    if ALLOWED_CHAT_ID and update.effective_chat.id != ALLOWED_CHAT_ID:
        await update.effective_message.reply_text("⛔ This bot is private.")
        return False
    return True


def format_open_tasks(tasks: list[dict]) -> str:
    if not tasks:
        return "🎉 No open tasks! You're all caught up."
    lines = ["📋 *Open tasks:*\n"]
    for t in tasks:
        assigned = f" _{t['assigned_to']}_" if t.get("assigned_to") else ""
        lines.append(f"• #{t['id']} {t['title']}{assigned}")
    return "\n".join(lines)


# ── Commands ──────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    await update.message.reply_text(
        "👋 *NudgeBot* is ready!\n\n"
        "I help you and your partner stay on top of shared tasks.\n\n"
        "• `/add Buy milk` — add a task\n"
        "• `/add Fix shelf @Nadav` — add & assign\n"
        "• `/list` — see open tasks\n"
        "• `/done 3` — mark task #3 done\n"
        "• `/nudge` — ping everyone with open tasks\n"
        "• `/help` — full command list",
        parse_mode="Markdown",
    )


async def cmd_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    await update.message.reply_text(
        "*NudgeBot commands:*\n\n"
        "➕ `/add <task>` — add a task\n"
        "➕ `/add <task> @name` — add & assign to someone\n"
        "📋 `/list` — show open tasks\n"
        "✅ `/done <id>` — mark task done\n"
        "🗑 `/delete <id>` — delete a task\n"
        "👤 `/assign <id> @name` — reassign a task\n"
        "🕐 `/done_list` — recently completed tasks\n"
        "📣 `/nudge` — send open tasks reminder\n"
        "🆔 `/chatid` — show this chat's ID",
        parse_mode="Markdown",
    )


async def cmd_chatid(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(f"Chat ID: `{update.effective_chat.id}`", parse_mode="Markdown")


async def cmd_add(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    text = " ".join(ctx.args).strip()
    if not text:
        await update.message.reply_text("Usage: `/add <task description>`", parse_mode="Markdown")
        return

    # Parse optional trailing @name assignment
    assigned = ""
    m = re.search(r"\s+@(\S+)$", text)
    if m:
        assigned = m.group(1)
        text = text[: m.start()].strip()

    who = display_name(update.effective_user)
    task = db.add_task(text, created_by=who, assigned_to=assigned)
    assign_str = f" → _{assigned}_" if assigned else ""
    await update.message.reply_text(
        f"✅ Added *#{task['id']}* {task['title']}{assign_str}\n\nPress done when finished:",
        parse_mode="Markdown",
        reply_markup=build_done_keyboard(task["id"]),
    )


async def cmd_list(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    tasks = db.list_tasks("open")
    msg = format_open_tasks(tasks)
    if not tasks:
        await update.message.reply_text(msg, parse_mode="Markdown")
        return

    # Build inline buttons for each task
    buttons = [
        [InlineKeyboardButton(f"✅ #{t['id']} {t['title'][:30]}", callback_data=f"done:{t['id']}")]
        for t in tasks
    ]
    await update.message.reply_text(
        msg, parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


async def cmd_done(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    if not ctx.args or not ctx.args[0].isdigit():
        await update.message.reply_text("Usage: `/done <task_id>`", parse_mode="Markdown")
        return

    task_id = int(ctx.args[0])
    who = display_name(update.effective_user)
    task = db.complete_task(task_id, who)
    if not task:
        await update.message.reply_text(f"Task #{task_id} not found or already done.")
        return
    if task["status"] != "done":
        await update.message.reply_text(f"Task #{task_id} not found or already done.")
        return

    remaining = db.list_tasks("open")
    remaining_str = f"\n\n{len(remaining)} task(s) still open." if remaining else "\n\n🎉 All done!"
    await update.message.reply_text(
        f"✅ *{who}* marked done: _{task['title']}_{remaining_str}",
        parse_mode="Markdown",
    )


async def cmd_delete(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    if not ctx.args or not ctx.args[0].isdigit():
        await update.message.reply_text("Usage: `/delete <task_id>`", parse_mode="Markdown")
        return
    task_id = int(ctx.args[0])
    task = db.get_task(task_id)
    if not task:
        await update.message.reply_text(f"Task #{task_id} not found.")
        return
    db.delete_task(task_id)
    await update.message.reply_text(f"🗑 Deleted: _{task['title']}_", parse_mode="Markdown")


async def cmd_assign(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    if len(ctx.args) < 2 or not ctx.args[0].isdigit():
        await update.message.reply_text("Usage: `/assign <id> @name`", parse_mode="Markdown")
        return
    task_id = int(ctx.args[0])
    name = ctx.args[1].lstrip("@")
    task = db.assign_task(task_id, name)
    if not task:
        await update.message.reply_text(f"Task #{task_id} not found.")
        return
    await update.message.reply_text(
        f"👤 Task *#{task_id}* assigned to _{name}_", parse_mode="Markdown"
    )


async def cmd_done_list(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    tasks = db.list_tasks("done")[-10:]  # last 10
    if not tasks:
        await update.message.reply_text("No completed tasks yet.")
        return
    lines = ["✅ *Recently completed:*\n"]
    for t in reversed(tasks):
        by = f" by _{t['done_by']}_" if t.get("done_by") else ""
        lines.append(f"• ~~{t['title']}~~{by}")
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def cmd_nudge(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    await send_nudge(ctx, chat_id=update.effective_chat.id)


async def send_nudge(ctx: ContextTypes.DEFAULT_TYPE, chat_id: int):
    tasks = db.list_tasks("open")
    if not tasks:
        await ctx.bot.send_message(chat_id, "🎉 No open tasks! All clear.")
        return
    lines = [f"📣 *Daily nudge — {len(tasks)} open task(s):*\n"]
    for t in tasks:
        assigned = f" → _{t['assigned_to']}_" if t.get("assigned_to") else ""
        lines.append(f"• #{t['id']} {t['title']}{assigned}")

    buttons = [
        [InlineKeyboardButton(f"✅ #{t['id']} {t['title'][:30]}", callback_data=f"done:{t['id']}")]
        for t in tasks
    ]
    await ctx.bot.send_message(
        chat_id,
        "\n".join(lines),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


# ── Inline button callbacks ───────────────────────────────────────────────────

async def on_button(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    action, task_id_str = query.data.split(":", 1)
    task_id = int(task_id_str)
    who = display_name(query.from_user)

    if action == "done":
        task = db.complete_task(task_id, who)
        if not task or task["status"] != "done":
            await query.edit_message_text("Task not found or already done.")
            return
        remaining = db.list_tasks("open")
        remaining_str = f"\n\n{len(remaining)} task(s) still open." if remaining else "\n\n🎉 All done!"
        await query.edit_message_text(
            f"✅ *{who}* marked done: _{task['title']}_{remaining_str}",
            parse_mode="Markdown",
        )

    elif action == "delete":
        task = db.get_task(task_id)
        if not task:
            await query.edit_message_text("Task not found.")
            return
        db.delete_task(task_id)
        await query.edit_message_text(f"🗑 Deleted: _{task['title']}_", parse_mode="Markdown")


# ── Scheduled daily nudge ────────────────────────────────────────────────────

async def daily_nudge(ctx: ContextTypes.DEFAULT_TYPE):
    if not ALLOWED_CHAT_ID:
        logger.warning("ALLOWED_CHAT_ID not set — skipping scheduled nudge")
        return
    logger.info("Sending daily nudge to chat %s", ALLOWED_CHAT_ID)
    await send_nudge(ctx, chat_id=ALLOWED_CHAT_ID)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    db.init_db()
    logger.info("NudgeBot starting (nudge at %02d:%02d)", NUDGE_HOUR, NUDGE_MINUTE)

    app = Application.builder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("chatid", cmd_chatid))
    app.add_handler(CommandHandler("add", cmd_add))
    app.add_handler(CommandHandler("list", cmd_list))
    app.add_handler(CommandHandler("done", cmd_done))
    app.add_handler(CommandHandler("delete", cmd_delete))
    app.add_handler(CommandHandler("assign", cmd_assign))
    app.add_handler(CommandHandler("done_list", cmd_done_list))
    app.add_handler(CommandHandler("nudge", cmd_nudge))
    app.add_handler(CallbackQueryHandler(on_button))

    # Daily nudge job
    app.job_queue.run_daily(
        daily_nudge,
        time=dtime(hour=NUDGE_HOUR, minute=NUDGE_MINUTE),
        name="daily_nudge",
    )

    logger.info("NudgeBot polling…")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
