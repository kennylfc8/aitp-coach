import os
import tempfile
from aiogram import Router, F
from aiogram.types import Message, User, FSInputFile, Voice
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
import asyncio

from .models import PlayerModel, TrainingSession
from .storage import load_player, save_player, create_player
from .coach_brain import generate_daily_plan, analyze_checkin, update_player_model
from .tts import generate_daily_voice_message, generate_checkin_feedback_voice
from .videos import recommend_videos, format_video_recommendations
from .polish import (
    check_and_update_streak,
    format_streak_message,
    detect_language_from_message,
    update_language_preference,
)
from .assessment import ASSESSMENT_QUESTIONS, DetailedPlayerAssessment, format_assessment_summary
from .stt import transcribe_voice
from .training_schedule import TRAINING_TEMPLATES, format_schedule_summary
from .plan_generator import get_today_sessions, format_daily_plan


router = Router()


class OnboardingStates(StatesGroup):
    waiting_for_name = State()
    waiting_for_level = State()
    waiting_for_experience = State()
    assessment_question = State()
    assessment_complete = State()


LEVEL_BUTTONS = ["Beginner", "Intermediate", "Advanced", "Professional"]
LANG_KEY = "language"


def get_user_language(user_data: dict) -> str:
    return user_data.get(LANG_KEY, "RU")


def format_plan_message(daily_plan, player: PlayerModel) -> str:
    language = player.language
    focus_keywords = [player.current_focus]
    if player.weaknesses:
        focus_keywords.extend(player.weaknesses[:2])

    videos = recommend_videos(focus_keywords, language, player.level, limit=2)
    video_text = format_video_recommendations(videos, language) if videos else ""

    if language == "RU":
        plan_text = f"""🎾 **План на сегодня**

**Фокус:** {daily_plan.focus}

**Дрилл:**
{daily_plan.drill}

⏱️ **Время:** {daily_plan.estimated_time_minutes} минут

{video_text}
Вперёд! 💪"""
    else:
        plan_text = f"""🎾 **Today's Plan**

**Focus:** {daily_plan.focus}

**Drill:**
{daily_plan.drill}

⏱️ **Time:** {daily_plan.estimated_time_minutes} minutes

{video_text}
Let's go! 💪"""

    return plan_text


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
    await state.update_data(experience_years=years, assessment_answers={}, question_index=0)
    await state.set_state(OnboardingStates.assessment_question)

    await message.answer(
        "Спасибо! 🎾\n\n"
        "Теперь пройдём подробный опрос (10 вопросов) для персонализированного плана.\n\n"
        "Готов начинать?"
    )

    # Ask first question
    await ask_assessment_question(message, state)


async def ask_assessment_question(message: Message, state: FSMContext):
    data = await state.get_data()
    question_index = data.get("question_index", 0)

    if question_index >= len(ASSESSMENT_QUESTIONS):
        # Assessment complete
        await complete_assessment(message, state)
        return

    question = ASSESSMENT_QUESTIONS[question_index]
    question_text = question.question_ru

    if question.question_type == "choice":
        options = question.options_ru or []
        buttons_text = "\n".join([f"• {opt}" for opt in options])
        await message.answer(f"{question_index + 1}. {question_text}\n\n{buttons_text}")
    elif question.question_type == "multiselect":
        options = question.options_ru or []
        buttons_text = "\n".join([f"• {opt}" for opt in options])
        await message.answer(f"{question_index + 1}. {question_text}\n\n{buttons_text}\n\n(Напиши номера через запятую, например: 1, 3, 5)")
    else:
        await message.answer(f"{question_index + 1}. {question_text}")


async def complete_assessment(message: Message, state: FSMContext):
    data = await state.get_data()
    user: User = message.from_user

    player = create_player(
        user_id=user.id,
        name=data["name"],
        level=data["level"],
        experience_years=data.get("experience_years", 0),
        assessment_data=data.get("assessment_answers", {})
    )

    await state.clear()
    await message.answer(
        f"✅ Профиль готов!\n\n"
        f"Спасибо, {player.name}! Генерирую твой первый план..."
    )

    # Generate first daily plan
    plan = generate_daily_plan(player)
    await message.answer(format_plan_message(plan, player))


@router.message(Command("plan"))
async def cmd_plan(message: Message):
    user: User = message.from_user
    player = load_player(user.id)

    if not player:
        await message.answer("Сначала создай профиль: /start")
        return

    # Send "generating..." indicator
    status_msg = await message.answer(
        "⏳ Generating your plan..." if player.language == "EN" else "⏳ Генерирую план..."
    )

    plan = generate_daily_plan(player)

    # Send text plan with videos
    await message.answer(format_plan_message(plan, player))

    # Generate and send voice (optional, non-blocking)
    try:
        voice_data = await generate_daily_voice_message(
            plan.focus, plan.drill, player.language
        )
        if voice_data and len(voice_data) > 1000:  # Valid audio data
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp.write(voice_data)
                tmp_path = tmp.name

            try:
                await message.answer_voice(FSInputFile(tmp_path))
            finally:
                os.unlink(tmp_path)
    except Exception as e:
        print(f"Voice generation error: {e}")

    # Delete status message
    await status_msg.delete()


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


@router.message(OnboardingStates.assessment_question)
async def process_assessment_answer(message: Message, state: FSMContext):
    """Process assessment question answer and move to next."""
    data = await state.get_data()
    question_index = data.get("question_index", 0)
    assessment_answers = data.get("assessment_answers", {})

    if question_index >= len(ASSESSMENT_QUESTIONS):
        await complete_assessment(message, state)
        return

    question = ASSESSMENT_QUESTIONS[question_index]
    assessment_answers[question.id] = message.text

    # Move to next question
    question_index += 1
    await state.update_data(question_index=question_index, assessment_answers=assessment_answers)

    if question_index >= len(ASSESSMENT_QUESTIONS):
        await complete_assessment(message, state)
    else:
        await ask_assessment_question(message, state)


@router.message(F.text)
async def handle_checkin_text(message: Message, state: FSMContext):
    user: User = message.from_user
    player = load_player(user.id)

    if not player:
        return

    data = await state.get_data()
    if not data.get("waiting_for_checkin"):
        return

    # Auto-detect language from check-in text
    update_language_preference(player, message.text)

    # Analyze check-in
    feedback = analyze_checkin(player, message.text)
    update_player_model(player, message.text)

    # Update streak
    new_streak, is_broken = check_and_update_streak(player)
    player.streak = new_streak
    save_player(player)

    await state.clear()

    # Send feedback
    await message.answer(feedback)

    # Send streak update
    streak_msg = format_streak_message(new_streak, is_broken, player.language)
    await message.answer(streak_msg)

    # Send encouragement
    if player.language == "RU":
        await message.answer(
            "Спасибо за работу! 💪\n\n"
            "Возвращайся завтра для нового плана!"
        )
    else:
        await message.answer(
            "Thanks for the work! 💪\n\n"
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


@router.message(Command("videos"))
async def cmd_videos(message: Message):
    user: User = message.from_user
    player = load_player(user.id)

    if not player:
        await message.answer("Сначала создай профиль: /start")
        return

    focus_keywords = [player.current_focus]
    if player.weaknesses:
        focus_keywords.extend(player.weaknesses[:2])

    videos = recommend_videos(focus_keywords, player.language, player.level, limit=5)

    if videos:
        msg = format_video_recommendations(videos, player.language)
        await message.answer(msg)
    else:
        if player.language == "RU":
            await message.answer("К сожалению, видео не найдены.")
        else:
            await message.answer("Unfortunately, no videos found.")


@router.message(Command("schedule"))
async def cmd_schedule(message: Message):
    """Show current training schedule"""
    user: User = message.from_user
    player = load_player(user.id)

    if not player:
        await message.answer("Сначала создай профиль: /start")
        return

    if not player.training_sessions:
        if player.language == "RU":
            await message.answer(
                "У тебя пока нет расписания тренировок.\n\n"
                "Выбери готовый шаблон:\n"
                "/schedule_casual (30 мин/день)\n"
                "/schedule_intermediate (2 часа + тренировки)\n"
                "/schedule_serious (3-4 часа/день)\n\n"
                "Или создай свой: /schedule_custom"
            )
        else:
            await message.answer(
                "You don't have a training schedule yet.\n\n"
                "Choose a template:\n"
                "/schedule_casual (30 min/day)\n"
                "/schedule_intermediate (2h + sessions)\n"
                "/schedule_serious (3-4h/day)\n\n"
                "Or create custom: /schedule_custom"
            )
        return

    # Show current schedule
    schedule_text = format_schedule_summary(
        {"sessions": [{"id": s.id, "name": s.name, "day_of_week": s.day_of_week,
                       "time": s.time, "duration_minutes": s.duration_minutes,
                       "focus_areas": s.focus_areas, "session_type": s.session_type,
                       "location": s.location, "description": s.name}
         for s in player.training_sessions]},
        player.language
    )
    await message.answer(schedule_text)

    # Show today's sessions
    today_sessions = get_today_sessions(player)
    if today_sessions:
        daily_plan = format_daily_plan(player, player.language)
        await message.answer(daily_plan)


@router.message(Command("schedule_casual"))
async def cmd_schedule_casual(message: Message):
    """Set casual training template"""
    user: User = message.from_user
    player = load_player(user.id)

    if not player:
        await message.answer("Сначала создай профиль: /start")
        return

    template = TRAINING_TEMPLATES.get("casual")
    if template:
        player.training_sessions = [
            TrainingSession(**session.dict()) for session in template.sessions
        ]
        player.weekly_training_minutes = sum(s.duration_minutes for s in template.sessions) * 7

        save_player(player)

        if player.language == "RU":
            await message.answer(
                "✅ Расписание установлено: Casual\n\n"
                "30 мин в день shadow-swings\n\n"
                "/schedule - посмотри полное расписание"
            )
        else:
            await message.answer(
                "✅ Schedule set: Casual\n\n"
                "30 min/day shadow swings\n\n"
                "/schedule - view full schedule"
            )


@router.message(Command("schedule_intermediate"))
async def cmd_schedule_intermediate(message: Message):
    """Set intermediate training template"""
    user: User = message.from_user
    player = load_player(user.id)

    if not player:
        await message.answer("Сначала создай профиль: /start")
        return

    template = TRAINING_TEMPLATES.get("intermediate")
    if template:
        player.training_sessions = [
            TrainingSession(**session.dict()) for session in template.sessions
        ]
        player.weekly_training_minutes = 20 + 20 + 120 * 3  # Morning + evening + 3x court

        save_player(player)

        if player.language == "RU":
            await message.answer(
                "✅ Расписание установлено: Intermediate\n\n"
                "20 мин утро (shadow-swings)\n"
                "20 мин вечер (footwork)\n"
                "3 тренировки в неделю (2 часа каждая)\n\n"
                "/schedule - посмотри полное расписание"
            )
        else:
            await message.answer(
                "✅ Schedule set: Intermediate\n\n"
                "20 min morning (shadow-swings)\n"
                "20 min evening (footwork)\n"
                "3 trainings/week (2 hours each)\n\n"
                "/schedule - view full schedule"
            )


@router.message(F.voice)
async def handle_voice_message(message: Message, state: FSMContext):
    """Handle voice messages - transcribe and process as text."""
    user: User = message.from_user
    player = load_player(user.id)

    if not player:
        await message.answer("Сначала создай профиль: /start")
        return

    # Show processing indicator
    status_msg = await message.answer("⏳ Слушаю и разбираю...")

    try:
        # Download voice file
        voice_file = message.voice
        file = await message.bot.get_file(voice_file.file_id)
        voice_data = await message.bot.download_file(file.file_path)

        # Transcribe voice to text
        transcribed_text = await transcribe_voice(voice_data.read())

        if not transcribed_text:
            await message.edit_text("❌ Не понял голос. Напиши текстом: /checkin")
            return

        await message.edit_text(f"✓ Я понял: \"{transcribed_text}\"")

        # Check if waiting for check-in
        data = await state.get_data()
        if data.get("waiting_for_checkin"):
            # Process as check-in
            await state.clear()

            # Analyze check-in
            feedback = analyze_checkin(player, transcribed_text)
            update_player_model(player, transcribed_text)

            # Update streak
            new_streak, is_broken = check_and_update_streak(player)
            player.streak = new_streak
            save_player(player)

            await message.answer(feedback)

            streak_msg = format_streak_message(new_streak, is_broken, player.language)
            await message.answer(streak_msg)

            if player.language == "RU":
                await message.answer(
                    "Спасибо за работу! 💪\n\nВозвращайся завтра для нового плана!"
                )
            else:
                await message.answer(
                    "Thanks for the work! 💪\n\nSee you tomorrow for a new plan!"
                )

    except Exception as e:
        print(f"Voice processing error: {e}")
        await message.edit_text("❌ Ошибка при обработке голоса. Попробуй текстом.")


def _make_buttons(options):
    # Simplified button keyboard - aiogram requires proper imports for InlineKeyboardMarkup
    return None  # We'll use simple text responses for now
