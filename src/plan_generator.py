"""
Smart plan generation based on player's custom training schedule.
Generates different drills/focuses for morning, evening, and court sessions.
"""

from datetime import datetime
from typing import List, Optional
from .models import PlayerModel, TrainingSession
from .coach_brain import client


def get_today_sessions(player: PlayerModel) -> List[TrainingSession]:
    """Get all training sessions scheduled for today"""
    today = datetime.now().strftime("%a").capitalize()  # "Mon", "Tue", etc

    today_sessions = []
    for session in player.training_sessions:
        # Daily sessions (no day_of_week specified)
        if not session.day_of_week:
            today_sessions.append(session)
        # Specific day sessions
        elif session.day_of_week.lower() == today.lower():
            today_sessions.append(session)

    # Sort by time
    today_sessions.sort(key=lambda s: s.time)
    return today_sessions


def generate_session_plan(
    player: PlayerModel,
    session: TrainingSession,
    session_number: int = 1,
    total_sessions_today: int = 1
) -> str:
    """
    Generate specific plan for a training session.

    Args:
        player: Player profile
        session: Specific training session
        session_number: Which session of the day (1, 2, 3, etc)
        total_sessions_today: Total sessions scheduled for today
    """

    # Build context
    context = f"""Generate a specific training plan for this player's session.

Player Profile:
- Name: {player.name}
- Level: {player.level}
- Experience: {player.experience_years} years
- Weaknesses to focus on: {', '.join(player.weaknesses) or 'not specified'}
- Strengths: {', '.join(player.strengths) or 'not specified'}

Session Details:
- Type: {session.session_type}
- Name: {session.name}
- Duration: {session.duration_minutes} minutes
- Location: {session.location}
- Focus areas: {', '.join(session.focus_areas)}
- Session {session_number} of {total_sessions_today} today

Player's description: {session.name or 'Regular training'}

Generate a SPECIFIC, ACTIONABLE plan for this {session.duration_minutes}-minute session.
Include:
1. Warm-up (if session > 30 min)
2. Main drills (specific to this session's focus_areas and location)
3. Intensity level (based on player level and session type)
4. Cool-down tips
5. Key focus point for this session

Output JSON:
{{
  "warmup": "...",
  "main_drill": "...",
  "intensity": "light/moderate/high",
  "cool_down": "...",
  "key_focus": "...",
  "tips": "..."
}}
"""

    response = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=800,
        system=f"You are a professional tennis coach creating personalized training plans. Current language: {player.language}. Respond in {player.language}.",
        messages=[{"role": "user", "content": context}]
    )

    return response.content[0].text


def format_daily_plan(player: PlayerModel, language: str) -> str:
    """
    Format complete daily training plan for all sessions.
    """
    today_sessions = get_today_sessions(player)

    if not today_sessions:
        if language == "RU":
            return "📅 На сегодня нет запланированных тренировок. Отдыхай! 💪"
        else:
            return "📅 No training sessions scheduled for today. Rest well! 💪"

    if language == "RU":
        plan = f"📅 **ПЛАН НА СЕГОДНЯ** ({len(today_sessions)} тренировок)\n\n"
    else:
        plan = f"📅 **TODAY'S PLAN** ({len(today_sessions)} sessions)\n\n"

    for i, session in enumerate(today_sessions, 1):
        if language == "RU":
            plan += f"**#{i} {session.name}** ({session.time})\n"
            plan += f"   Время: {session.duration_minutes} мин\n"
            plan += f"   Место: {session.location}\n"
            plan += f"   Фокус: {', '.join(session.focus_areas)}\n"
            plan += f"   Тип: {session.session_type}\n\n"
        else:
            plan += f"**#{i} {session.name}** ({session.time})\n"
            plan += f"   Duration: {session.duration_minutes} min\n"
            plan += f"   Location: {session.location}\n"
            plan += f"   Focus: {', '.join(session.focus_areas)}\n"
            plan += f"   Type: {session.session_type}\n\n"

    if language == "RU":
        plan += f"**Итого:** {sum(s.duration_minutes for s in today_sessions)} минут тренировки\n"
    else:
        plan += f"**Total:** {sum(s.duration_minutes for s in today_sessions)} minutes\n"

    return plan


def get_next_session_in(player: PlayerModel) -> Optional[tuple[TrainingSession, int]]:
    """
    Get the next training session and minutes until it starts.

    Returns: (session, minutes_until_start) or None
    """
    import pytz
    from datetime import timedelta

    now = datetime.now()
    today_sessions = get_today_sessions(player)

    for session in today_sessions:
        session_time = datetime.strptime(session.time, "%H:%M").time()
        session_datetime = datetime.combine(now.date(), session_time)

        if session_datetime > now:
            minutes_until = int((session_datetime - now).total_seconds() / 60)
            return (session, minutes_until)

    return None
