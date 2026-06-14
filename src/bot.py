import os
from aiogram import Router, F
from aiogram.types import Message, User
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from .models import PlayerModel
from .storage import load_player, save_player, create_player
from .coach_brain import generate_daily_plan, analyze_checkin, update_player_model


router = Router()


class OnboardingStates(StatesGroup):
    waiting_for_name = State()
    waiting_for_level = State()
    waiting_for_experience = State()


LEVEL_BUTTONS = ["Beginner", "Intermediate", "Advanced", "Professional"]
LANG_KEY = "language"


def get_user_language(user_data: dict) -> str:
    return user_data.get(LANG_KEY, "RU")


def format_plan_message(daily_plan, language: str) -> str:
    if language == "RU":
        return f"""🎾 **План на сегодня**

**Фокус:** {daily_plan.focus}

**Дрилл:**
{daily_plan.drill}

⏱️ **Время:** {daily_plan.estimated_time_minutes} минут

Вперёд! 💪"""
    else:
        return f"""🎾 **Today's Plan**

**Focus:** {daily_plan.focus}

**Drill:**
{daily_plan.drill}

⏱️ **Time:** {daily_plan.estimated_time_minutes} minutes

Let's go! 💪"""


@router.message(Command("start"))
async def cmd_start(message: Message, state: FSMContext):
    user: User = message.from_user
    player = load_player(user.id)

    if player:
        lang = player.language
        if lang == "RU":
            await message.answer(
                f"Привет, {player.name}! 👋\n\n"
                "Я твой AI-коуч по теннису.\n\n"
                "Команды:\n"
                "/plan — дневной план\n"
                "/checkin — вечерний чек-ин\n"
                "/profile — твой профиль\n"
                "/en — английский язык\n"
                "/ru — русский язык"
            )
        else:
            await message.answer(
                f"Hello, {player.name}! 👋\n\n"
                "I'm your AI tennis coach.\n\n"
                "Commands:\n"
                "/plan — daily plan\n"
                "/checkin — evening check-in\n"
                "/profile — your profile\n"
                "/en — English\n"
                "/ru — Russian"
            )
    else:
        await state.set_state(OnboardingStates.waiting_for_name)
        await message.answer(
            "👋 Привет! Я твой AI-коуч по теннису.\n\n"
            "Давай начнём. Как тебя зовут?"
        )


@router.message(OnboardingStates.waiting_for_name)
async def process_name(message: Message, state: FSMContext):
    await state.update_data(name=message.text)
    await state.set_state(OnboardingStates.waiting_for_level)
    await message.answer(
        f"Спасибо, {message.text}! 🎾\n\n"
        "Какой у тебя уровень игры?",
        reply_markup=_make_buttons(["Beginner", "Intermediate", "Advanced", "Professional"])
    )


@router.message(OnboardingStates.waiting_for_level)
async def process_level(message: Message, state: FSMContext):
    await state.update_data(level=message.text.lower())
    await state.set_state(OnboardingStates.waiting_for_experience)
    await message.answer(
        "Отлично! 💪\n\n"
        "Сколько лет ты играешь в теннис? (введи число)"
    )


@router.message(OnboardingStates.waiting_for_experience)
async def process_experience(message: Message, state: FSMContext):
    try:
        years = int(message.text)
    except ValueError:
        await message.answer("Введи число, пожалуйста.")
        return

    data = await state.get_data()
    user: User = message.from_user

    player = create_player(
        user_id=user.id,
        name=data["name"],
        level=data["level"],
        experience_years=years
    )

    await state.clear()
    await message.answer(
        f"✅ Профиль создан!\n\n"
        f"Спасибо за информацию, {player.name}.\n\n"
        f"Первый дневной план готовится... "
    )

    # Generate first daily plan
    plan = generate_daily_plan(player)
    await message.answer(format_plan_message(plan, player.language))


@router.message(Command("plan"))
async def cmd_plan(message: Message):
    user: User = message.from_user
    player = load_player(user.id)

    if not player:
        await message.answer("Сначала создай профиль: /start")
        return

    plan = generate_daily_plan(player)
    await message.answer(format_plan_message(plan, player.language))


@router.message(Command("checkin"))
async def cmd_checkin(message: Message, state: FSMContext):
    user: User = message.from_user
    player = load_player(user.id)

    if not player:
        await message.answer("Сначала создай профиль: /start")
        return

    if player.language == "RU":
        await message.answer(
            "Как прошла тренировка? Расскажи, что удалось, что было сложно."
        )
    else:
        await message.answer(
            "How was your session? Tell me what went well and what was challenging."
        )

    # Store that we're waiting for checkin text
    await state.update_data(waiting_for_checkin=True)


@router.message(F.text)
async def handle_checkin_text(message: Message, state: FSMContext):
    user: User = message.from_user
    player = load_player(user.id)

    if not player:
        return

    data = await state.get_data()
    if not data.get("waiting_for_checkin"):
        return

    # Analyze check-in
    feedback = analyze_checkin(player, message.text)
    update_player_model(player, message.text)
    save_player(player)

    await state.clear()
    await message.answer(feedback)

    if player.language == "RU":
        await message.answer(
            f"📊 Streak: {player.streak} дней подряд 🔥\n\n"
            "Возвращайся завтра для нового плана!"
        )
    else:
        await message.answer(
            f"📊 Streak: {player.streak} days in a row 🔥\n\n"
            "See you tomorrow for a new plan!"
        )


@router.message(Command("profile"))
async def cmd_profile(message: Message):
    user: User = message.from_user
    player = load_player(user.id)

    if not player:
        await message.answer("Сначала создай профиль: /start")
        return

    if player.language == "RU":
        profile_text = f"""📋 **Твой профиль**

**Имя:** {player.name}
**Уровень:** {player.level}
**Опыт:** {player.experience_years} лет
**Текущий фокус:** {player.current_focus}
**Streak:** {player.streak} дней 🔥

**Сильные стороны:** {', '.join(player.strengths) or '—'}
**Слабые стороны:** {', '.join(player.weaknesses) or '—'}
**Цели:** {', '.join(player.goals) or '—'}"""
    else:
        profile_text = f"""📋 **Your Profile**

**Name:** {player.name}
**Level:** {player.level}
**Experience:** {player.experience_years} years
**Current Focus:** {player.current_focus}
**Streak:** {player.streak} days 🔥

**Strengths:** {', '.join(player.strengths) or '—'}
**Weaknesses:** {', '.join(player.weaknesses) or '—'}
**Goals:** {', '.join(player.goals) or '—'}"""

    await message.answer(profile_text)


@router.message(Command("en"))
async def cmd_en(message: Message):
    user: User = message.from_user
    player = load_player(user.id)

    if player:
        player.language = "EN"
        save_player(player)
        await message.answer("Language changed to English. 🇺🇸")


@router.message(Command("ru"))
async def cmd_ru(message: Message):
    user: User = message.from_user
    player = load_player(user.id)

    if player:
        player.language = "RU"
        save_player(player)
        await message.answer("Язык изменён на русский. 🇷🇺")


def _make_buttons(options):
    # Simplified button keyboard - aiogram requires proper imports for InlineKeyboardMarkup
    return None  # We'll use simple text responses for now
