# NudgeBot 🤖

Couples task nudge bot — add tasks, get reminded, mark them done. No more "did you do the thing?"

## Setup

1. **Create the bot** via [@BotFather](https://t.me/botfather) → `/newbot`
2. Copy your token into `.env`:
   ```
   cp .env.example .env
   # edit .env and set BOT_TOKEN
   ```
3. **Add the bot to a shared group** with you and your partner
4. Get the group's chat ID by sending `/chatid` in the group
5. Set `ALLOWED_CHAT_ID` in `.env` to that value
6. Set `NUDGE_HOUR` / `NUDGE_MINUTE` for daily reminders

## Run

```bash
pip install -r requirements.txt
python bot.py
```

## Run with PM2

```bash
pm2 start bot.py --name nudge-bot --interpreter python3
pm2 save
```

## Commands

| Command | Description |
|---|---|
| `/add Buy milk` | Add a task |
| `/add Fix shelf @Nadav` | Add & assign to someone |
| `/list` | Show all open tasks (with ✅ buttons) |
| `/done 3` | Mark task #3 as done |
| `/delete 3` | Delete task #3 |
| `/assign 3 @Sara` | Reassign task #3 |
| `/done_list` | Show recently completed tasks |
| `/nudge` | Manually trigger the open-tasks reminder |
| `/chatid` | Show this chat's ID |
