import os
from anthropic import Anthropic
from .models import PlayerModel, DailyPlan
from datetime import datetime
import json

# Get API key from environment (loaded by main.py)
_api_key = os.getenv("ANTHROPIC_API_KEY")
if not _api_key:
    raise ValueError("ANTHROPIC_API_KEY not found in environment variables. Check .env file.")

client = Anthropic(api_key=_api_key)


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


def generate_daily_plan(player: PlayerModel, program_context: str = "") -> DailyPlan:
    """Generate daily practice plan using Claude.

    program_context (optional): the current periodization week's focus/phase,
    so the daily plan respects the macrocycle (e.g. base vs peak intensity).
    """

    utr_line = ""
    if player.utr_value is not None:
        utr_line = f"- Estimated UTR: {player.utr_value} (target: {player.target_utr or 'not set'})\n"

    program_block = ""
    if program_context:
        program_block = f"\n\nProgram context (respect this week's phase and focus):\n{program_context}"

    prompt = f"""Based on the player model below, generate today's practice plan.

Player Model:
- Name: {player.name}
- Level: {player.level}
- Experience: {player.experience_years} years
- Strengths: {', '.join(player.strengths) or 'not specified'}
- Weaknesses: {', '.join(player.weaknesses) or 'not specified'}
- Current Focus: {player.current_focus}
{utr_line}- Goals: {', '.join(player.goals) or 'not specified'}
- Streak: {player.streak} days

Generate a JSON response with:
- focus: today's technical focus (1 sentence)
- drill: specific drill to work on (2-3 sentences with clear steps)
- estimated_time_minutes: 30-60 minutes

Keep the language appropriate for {player.language}.{program_block}"""

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
        system=get_coach_persona(player.language),
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


COACH_CHAT_SYSTEM_RU = """Ты — жёсткий и харизматичный личный теннис-коуч. Говоришь как живой
человек у корта: рублено, с напором и эмоцией — НЕ вежливый робот.

Стиль:
- короткие ударные фразы, восклицания, драйв и огонь;
- мотивируешь жёстко, по-спортивному: где-то похвалишь, где-то рявкнешь и поддашь жару;
- ИЗРЕДКА крепкое словцо/лёгкий мат — для эмоций и запала (не в каждом предложении и
  НИКОГДА не унижая игрока: это огонь, а не оскорбление);
- ноль корпоративной вежливости и воды; не «здравствуйте», а как со своим;
- конкретика по технике/тактике/настрою, без занудных лекций.

Опирайся на контекст игрока (UTR, слабые места, цель). 2–5 фраз, динамично, чтобы цепляло.
Не выдумывай факты о матчах, которых не знаешь."""

COACH_CHAT_SYSTEM_EN = """You are a tough, charismatic personal tennis coach. Talk like a real
person courtside: punchy, driven, emotional — NOT a polite robot.

Style:
- short hard-hitting lines, exclamations, fire and drive;
- motivate hard, sports-style: praise sometimes, bark and crank the heat other times;
- OCCASIONAL mild swearing for emphasis (not every sentence, NEVER demeaning the player —
  it's fire, not an insult);
- zero corporate politeness or fluff; talk like to your own guy;
- concrete on technique/tactics/mindset, no boring lectures.

Use the player's context (UTR, weaknesses, goal). 2–5 lines, dynamic, make it land.
Don't invent facts about matches you don't know."""


def get_coach_persona(language: str) -> str:
    return COACH_CHAT_SYSTEM_RU if language == "RU" else COACH_CHAT_SYSTEM_EN


def chat_with_coach(player: PlayerModel, user_message: str, history=None, brief: bool = False) -> str:
    """Free-form conversational coaching, grounded in the player's profile.

    brief=True (web/voice): force 1–2 short sentences so TTS is fast and the chat feels live.
    """
    history = history or []

    parts = [
        f"имя {player.name}",
        f"UTR ~{player.utr_value} (уверенность {player.utr_confidence}%)",
        f"уровень {player.level}",
        f"сильные: {', '.join(player.strengths) or '—'}",
        f"слабые: {', '.join(player.weaknesses) or '—'}",
        f"текущий фокус: {player.current_focus}",
        f"стрик: {player.streak}",
    ]
    if player.target_utr:
        parts.append(f"цель UTR {player.target_utr}")
    context = "Контекст игрока: " + "; ".join(parts) + "."

    system = (COACH_CHAT_SYSTEM_RU if player.language == "RU" else COACH_CHAT_SYSTEM_EN) + "\n\n" + context
    if brief:
        system += (
            "\n\nВАЖНО: отвечай ОЧЕНЬ коротко — 1–2 фразы, максимум ~30 слов. "
            "Это живой голосовой разговор, а не лекция."
            if player.language == "RU"
            else
            "\n\nIMPORTANT: keep it VERY short — 1–2 sentences, ~30 words max. "
            "This is a live voice chat, not a lecture."
        )
    messages = list(history) + [{"role": "user", "content": user_message}]

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=160 if brief else 400,
        system=system,
        messages=messages,
    )
    return response.content[0].text
