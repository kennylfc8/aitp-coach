"""
Polish features: streak tracking, reminder escalation, language detection.
"""

from datetime import datetime, timedelta
from .models import PlayerModel
from .storage import save_player


def check_and_update_streak(player: PlayerModel) -> tuple[int, bool]:
    """
    Check if player maintained streak.

    Returns:
        (new_streak, is_broken) — new streak count and whether it was broken today
    """
    if not player.last_checkin:
        return 1, False

    last_checkin = player.last_checkin
    today = datetime.now().date()
    last_checkin_date = last_checkin.date() if isinstance(last_checkin, datetime) else last_checkin

    days_since_checkin = (today - last_checkin_date).days

    if days_since_checkin == 0:
        # Already checked in today
        return player.streak, False

    if days_since_checkin == 1:
        # Consecutive day — increment streak
        return player.streak + 1, False

    # Streak broken
    return 1, True


def get_streak_emoji(streak: int) -> str:
    """Get emoji based on streak length."""
    if streak >= 30:
        return "🔥🔥🔥"
    elif streak >= 14:
        return "🔥🔥"
    elif streak >= 7:
        return "🔥"
    elif streak >= 3:
        return "✅"
    else:
        return "🌱"


def format_streak_message(new_streak: int, is_broken: bool, language: str) -> str:
    """Format streak update message."""
    emoji = get_streak_emoji(new_streak)

    if language == "RU":
        if is_broken:
            return f"Стрик сброшен 😔\n\nДавай начнём заново! Сегодня день 1. {emoji}"
        else:
            if new_streak == 1:
                return f"Отлично! Начали новый стрик 🌱"
            elif new_streak == 7:
                return f"7 дней подряд! Это серьёзное достижение 🔥"
            elif new_streak == 30:
                return f"30 дней!!! Ты легенда! 🔥🔥🔥"
            else:
                return f"День {new_streak}: Продолжай! {emoji}"
    else:
        if is_broken:
            return f"Streak broken 😔\n\nLet's start fresh! Today is day 1. {emoji}"
        else:
            if new_streak == 1:
                return f"Great! Started a new streak 🌱"
            elif new_streak == 7:
                return f"7 days in a row! That's impressive! 🔥"
            elif new_streak == 30:
                return f"30 days!!! You're a legend! 🔥🔥🔥"
            else:
                return f"Day {new_streak}: Keep it up! {emoji}"


def detect_language_from_message(message_text: str) -> str:
    """
    Auto-detect language from user message.

    Returns "RU" or "EN" based on character analysis.
    """
    cyrillic_count = sum(1 for c in message_text if 'Ѐ' <= c <= 'ӿ')
    latin_count = sum(1 for c in message_text if 'a' <= c.lower() <= 'z')

    # If message is too short, use 0.3 threshold, otherwise use 0.5
    threshold = 0.3 if len(message_text) < 10 else 0.5

    if cyrillic_count > 0 or latin_count == 0:
        return "RU"
    elif latin_count > cyrillic_count * threshold:
        return "EN"
    else:
        return "RU"  # Default to RU


def update_language_preference(player: PlayerModel, message_text: str) -> None:
    """Update player language preference based on message."""
    detected = detect_language_from_message(message_text)

    # Only update if different from current preference
    if player.language != detected and detected in ["RU", "EN"]:
        player.language = detected
        save_player(player)


class MissedCheckInTracker:
    """Track missed check-ins and send escalating reminders."""

    REMINDER_THRESHOLDS = [
        (1, "soft"),    # 1 day after: soft reminder
        (3, "medium"),  # 3 days: medium reminder
        (7, "hard"),    # 7 days: serious reminder
    ]

    @staticmethod
    def days_since_checkin(player: PlayerModel) -> int:
        """Calculate days since last check-in."""
        if not player.last_checkin:
            return 999  # Never checked in

        last_date = player.last_checkin.date() if isinstance(player.last_checkin, datetime) else player.last_checkin
        today = datetime.now().date()
        return (today - last_date).days

    @staticmethod
    def get_reminder_level(player: PlayerModel) -> str:
        """Get reminder urgency level."""
        days = MissedCheckInTracker.days_since_checkin(player)

        for threshold, level in MissedCheckInTracker.REMINDER_THRESHOLDS:
            if days >= threshold:
                return level

        return None

    @staticmethod
    def format_reminder(player: PlayerModel) -> tuple[str, str]:
        """
        Format reminder message.

        Returns (message, level): message text and urgency level
        """
        days = MissedCheckInTracker.days_since_checkin(player)
        level = MissedCheckInTracker.get_reminder_level(player)

        if not level:
            return None, None

        if player.language == "RU":
            if level == "soft":
                text = f"Привет {player.name}! 👋\n\nМы не получали от тебя чек-ин {days} дня.\n\nКак дела с тренировками? /checkin"
            elif level == "medium":
                text = f"Hey {player.name}! 🎾\n\nМисс! {days} дней без чек-ина.\n\nРасскажи, как ты занимаешься. /checkin"
            else:
                text = f"{player.name}! 🚨\n\n{days} дней без чек-ина. Где ты?\n\n/checkin"
        else:
            if level == "soft":
                text = f"Hey {player.name}! 👋\n\nWe haven't heard from you in {days} days.\n\nHow's training? /checkin"
            elif level == "medium":
                text = f"Hey {player.name}! 🎾\n\nMissing you! {days} days without check-in.\n\nLet us know how it's going. /checkin"
            else:
                text = f"{player.name}! 🚨\n\n{days} days no check-in. Where are you?\n\n/checkin"

        return text, level
