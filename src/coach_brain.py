from anthropic import Anthropic
from .models import PlayerModel, DailyPlan
from datetime import datetime
import json


client = Anthropic()


SYSTEM_PROMPT_EN = """You are an expert tennis coach with 20+ years of experience. Your role:
- Generate daily personalized practice plans based on the player's current focus
- Recommend specific drills and technique work
- Provide motivation and accountability
- Analyze check-in responses and update player models

When generating a daily plan, output JSON with: focus, drill, estimated_time_minutes.
Keep responses concise and actionable. Always encourage consistent practice."""

SYSTEM_PROMPT_RU = """Ты — профессиональный теннис-коуч с 20+ годами опыта. Твоя роль:
- Генерировать персонализированные дневные планы тренировок
- Рекомендовать конкретные дрилы и работу над техникой
- Мотивировать и поддерживать ответственность
- Анализировать чек-ины и обновлять модель игрока

При генерации плана выводи JSON: focus, drill, estimated_time_minutes.
Будь кратким и конкретным. Всегда поощряй регулярные тренировки."""


def get_system_prompt(language: str) -> str:
    return SYSTEM_PROMPT_RU if language == "RU" else SYSTEM_PROMPT_EN


def generate_daily_plan(player: PlayerModel) -> DailyPlan:
    """Generate daily practice plan using Claude."""

    prompt = f"""Based on the player model below, generate today's practice plan.

Player Model:
- Name: {player.name}
- Level: {player.level}
- Experience: {player.experience_years} years
- Strengths: {', '.join(player.strengths) or 'not specified'}
- Weaknesses: {', '.join(player.weaknesses) or 'not specified'}
- Current Focus: {player.current_focus}
- Goals: {', '.join(player.goals) or 'not specified'}
- Streak: {player.streak} days

Generate a JSON response with:
- focus: today's technical focus (1 sentence)
- drill: specific drill to work on (2-3 sentences with clear steps)
- estimated_time_minutes: 30-60 minutes

Keep the language appropriate for {player.language}."""

    response = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=500,
        system=get_system_prompt(player.language),
        messages=[{"role": "user", "content": prompt}]
    )

    content = response.content[0].text
    # Extract JSON from response
    try:
        start_idx = content.find('{')
        end_idx = content.rfind('}') + 1
        plan_data = json.loads(content[start_idx:end_idx])

        return DailyPlan(
            date=datetime.now().strftime("%Y-%m-%d"),
            focus=plan_data.get("focus", "Technical improvement"),
            drill=plan_data.get("drill", "Continue current focus"),
            estimated_time_minutes=plan_data.get("estimated_time_minutes", 45)
        )
    except (json.JSONDecodeError, ValueError):
        # Fallback if JSON parsing fails
        return DailyPlan(
            date=datetime.now().strftime("%Y-%m-%d"),
            focus="Technical improvement",
            drill=content[:200],
            estimated_time_minutes=45
        )


def analyze_checkin(player: PlayerModel, checkin_text: str) -> str:
    """Analyze evening check-in and provide feedback."""

    prompt = f"""A player has completed today's session. Analyze their check-in:

Player: {player.name} ({player.level})
Today's Focus: {player.current_focus}
Check-in: {checkin_text}

Provide:
1. Brief feedback on what they did well
2. One area to focus on tomorrow
3. Encouragement to keep their streak

Keep it short (2-3 sentences) and motivating."""

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=300,
        system=get_system_prompt(player.language),
        messages=[{"role": "user", "content": prompt}]
    )

    return response.content[0].text


def update_player_model(player: PlayerModel, checkin_text: str) -> None:
    """Update player model based on check-in feedback."""
    # This is a simplified version - in production, use Claude to analyze
    # and extract insights about strengths/weaknesses

    if "struggled" in checkin_text.lower() or "hard" in checkin_text.lower():
        if player.current_focus not in player.weaknesses:
            player.weaknesses.append(player.current_focus)

    if "good" in checkin_text.lower() or "great" in checkin_text.lower():
        if player.current_focus in player.weaknesses:
            player.weaknesses.remove(player.current_focus)
        if player.current_focus not in player.strengths:
            player.strengths.append(player.current_focus)

    player.streak += 1
    player.last_checkin = datetime.now()
