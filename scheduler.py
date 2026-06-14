#!/usr/bin/env python3
"""
Scheduler script to send daily messages to players.
Can be triggered by GitHub Actions cron or external service.

Usage:
    python scheduler.py morning   # Send morning plans
    python scheduler.py evening   # Send evening check-in reminders
"""

import os
import sys
import json
from pathlib import Path
from datetime import datetime
import asyncio
import aiohttp

from src.models import PlayerModel
from src.coach_brain import generate_daily_plan, get_system_prompt
from src.storage import load_player, PLAYERS_DIR


TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_API_URL = "https://api.telegram.org/bot"


async def send_telegram_message(chat_id: int, text: str) -> bool:
    """Send message via Telegram API."""
    url = f"{TELEGRAM_API_URL}{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "Markdown"
    }

    async with aiohttp.ClientSession() as session:
        try:
            async with session.post(url, json=payload) as resp:
                return resp.status == 200
        except Exception as e:
            print(f"Error sending message to {chat_id}: {e}")
            return False


async def send_morning_plans():
    """Send daily plans to all registered players."""
    print(f"[{datetime.now().isoformat()}] Sending morning plans...")

    if not PLAYERS_DIR.exists():
        print("No players directory found.")
        return

    player_files = list(PLAYERS_DIR.glob("*.json"))
    print(f"Found {len(player_files)} players")

    for player_file in player_files:
        try:
            user_id = int(player_file.stem)
            player = load_player(user_id)

            if not player:
                continue

            # Skip if user opted out
            if player.language is None:
                continue

            # Generate plan
            plan = generate_daily_plan(player)

            # Format message
            if player.language == "RU":
                message = f"""🎾 **План на сегодня**

**Фокус:** {plan.focus}

**Дрилл:**
{plan.drill}

⏱️ **Время:** {plan.estimated_time_minutes} минут

Вперёд! 💪"""
            else:
                message = f"""🎾 **Today's Plan**

**Focus:** {plan.focus}

**Drill:**
{plan.drill}

⏱️ **Time:** {plan.estimated_time_minutes} minutes

Let's go! 💪"""

            # Send message
            success = await send_telegram_message(user_id, message)
            if success:
                print(f"✓ Sent plan to {user_id} ({player.name})")
            else:
                print(f"✗ Failed to send plan to {user_id}")

        except Exception as e:
            print(f"Error processing {player_file}: {e}")


async def send_evening_reminders():
    """Send evening check-in reminders to all registered players."""
    print(f"[{datetime.now().isoformat()}] Sending evening reminders...")

    if not PLAYERS_DIR.exists():
        print("No players directory found.")
        return

    player_files = list(PLAYERS_DIR.glob("*.json"))

    for player_file in player_files:
        try:
            user_id = int(player_file.stem)
            player = load_player(user_id)

            if not player:
                continue

            # Format reminder
            if player.language == "RU":
                message = "🌅 Время вечернего чек-ина!\n\nКак прошла тренировка?\n\n/checkin"
            else:
                message = "🌅 Time for your evening check-in!\n\nHow was your session?\n\n/checkin"

            # Send message
            success = await send_telegram_message(user_id, message)
            if success:
                print(f"✓ Sent reminder to {user_id} ({player.name})")
            else:
                print(f"✗ Failed to send reminder to {user_id}")

        except Exception as e:
            print(f"Error processing {player_file}: {e}")


async def main():
    if not TELEGRAM_BOT_TOKEN:
        print("ERROR: TELEGRAM_BOT_TOKEN not set")
        sys.exit(1)

    if len(sys.argv) < 2:
        print("Usage: python scheduler.py [morning|evening]")
        sys.exit(1)

    action = sys.argv[1].lower()

    if action == "morning":
        await send_morning_plans()
    elif action == "evening":
        await send_evening_reminders()
    else:
        print(f"Unknown action: {action}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
