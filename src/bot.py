import os
import re
import logging
import tempfile
from typing import Optional
from datetime import date, timedelta
from aiogram import Router, F
from aiogram.types import (
    Message, User, FSInputFile, Voice,
    InlineKeyboardMarkup, InlineKeyboardButton, CallbackQuery,
)
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
import asyncio

logger = logging.getLogger("bot")

from .models import PlayerModel, TrainingSession
from .storage import load_player, save_player, create_player
from .coach_brain import generate_daily_plan, analyze_checkin, update_player_model, chat_with_coach
from .tts import generate_daily_voice_message, generate_checkin_feedback_voice
from . import youtube
from .polish import (
    check_and_update_streak,
    format_streak_message,
    detect_language_from_message,
    update_language_preference,
)
from .assessment import ASSESSMENT_QUESTIONS, DetailedPlayerAssessment, format_assessment_summary
from .stt import transcribe_voice
from .training_schedule import (
    TRAINING_TEMPLATES, format_schedule_summary,
    SCHED_TYPES, SCHED_ORDER, build_sessions_from_counts,
    weekly_minutes_of, format_sessions_ru, make_session_dict, DAY_LABELS_RU,
)
from .plan_generator import get_today_sessions, format_daily_plan
from . import funnel
from . import periodization
from .utr import estimate_utr, estimate_for_player, refine_with_match, DIMENSIONS


router = Router()


class OnboardingStates(StatesGroup):
    waiting_for_name = State()
    funnel_question = State()      # waiting for a typed funnel answer (number/text)
    funnel_branch = State()        # waiting for a "deeper / stop" tap
    waiting_target_utr = State()   # waiting for target UTR
    waiting_target_date = State()  # waiting for target deadline
    matchlog_opp = State()         # waiting for opponent UTR
    matchlog_games = State()       # waiting for games score
    sched_count = State()          # picking per-type weekly counts / summary menu
    sched_add_name = State()       # custom session: name
    sched_add_time = State()       # custom session: time
    sched_add_dur = State()        # custom session: duration


LEVEL_BUTTONS = ["Beginner", "Intermediate", "Advanced", "Professional"]
LANG_KEY = "language"


def get_user_language(user_data: dict) -> str:
    return user_data.get(LANG_KEY, "RU")


def format_plan_message(daily_plan, player: PlayerModel) -> str:
    language = player.language
    if language == "RU":
        plan_text = f"""🎾 **План на сегодня**

**Фокус:** {daily_plan.focus}

**Дрилл:**
{daily_plan.drill}

⏱️ **Время:** {daily_plan.estimated_time_minutes} минут

Вперёд! 💪 (видео по теме — /videos)"""
    else:
        plan_text = f"""🎾 **Today's Plan**

**Focus:** {daily_plan.focus}

**Drill:**
{daily_plan.drill}

⏱️ **Time:** {daily_plan.estimated_time_minutes} minutes

Let's go! 💪 (topic videos — /videos)"""

    return plan_text


async def _send_voice(message: Message, audio: Optional[bytes]):
    """OGG/Opus -> Telegram voice note; mp3 (e.g. MiniMax) -> audio message. No-op if empty."""
    if not audio or len(audio) < 800:
        return
    is_ogg = audio[:4] == b"OggS"
    suffix = ".ogg" if is_ogg else ".mp3"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio)
        path = tmp.name
    try:
        if is_ogg:
            await message.answer_voice(FSInputFile(path))
        else:
            await message.answer_audio(FSInputFile(path), title="Coach")
    finally:
        os.unlink(path)


async def _reply(message: Message, player: PlayerModel, text_reply: str, voice_reply: bool):
    """Mirror the input modality: voice in -> voice note (fallback to text); text -> text."""
    if voice_reply:
        audio = None
        try:
            audio = await generate_checkin_feedback_voice(text_reply, player.language)
        except Exception as e:
            logger.warning(f"tts reply failed: {e}")
        if audio and len(audio) >= 800:
            await _send_voice(message, audio)
            return
        # TTS unavailable -> fall back to text so the user isn't left in silence
    await message.answer(text_reply)


async def _coach_chat(message: Message, state: FSMContext, player: PlayerModel,
                      text: str, voice_reply: bool):
    """Free-form chat with the coach (Claude), short rolling history, mirrored modality."""
    data = await state.get_data()
    history = data.get("chat_history", [])
    await message.bot.send_chat_action(message.chat.id, "record_voice" if voice_reply else "typing")
    try:
        reply = chat_with_coach(player, text, history)
    except Exception as e:
        logger.warning(f"coach chat failed: {e}")
        reply = "Чёт связь с коучем подвисла — повтори ещё раз 🎾"
    # keep last 3 exchanges (6 messages) for continuity
    history = (history + [{"role": "user", "content": text},
                          {"role": "assistant", "content": reply}])[-6:]
    await state.update_data(chat_history=history)
    await _reply(message, player, reply, voice_reply)


async def _process_checkin(message: Message, state: FSMContext, player: PlayerModel,
                           text: str, voice_reply: bool):
    """Evening check-in: analyze + update streak. Output mirrors input modality."""
    update_language_preference(player, text)
    feedback = analyze_checkin(player, text)
    update_player_model(player, text)
    new_streak, is_broken = check_and_update_streak(player)
    player.streak = new_streak
    save_player(player)
    await state.update_data(waiting_for_checkin=False)

    await _reply(message, player, feedback, voice_reply)
    # streak line only in text mode (keep voice replies clean = voice only)
    if not voice_reply:
        await message.answer(format_streak_message(new_streak, is_broken, player.language))


@router.message(Command("start"))
async def cmd_start(message: Message, state: FSMContext):
    user: User = message.from_user
    logger.info(f"[/start] from user_id={user.id}, username={user.username}")
    await state.clear()  # Reset any leftover state
    player = load_player(user.id)
    logger.info(f"[/start] player loaded: {player is not None}")

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
    await state.update_data(
        user_id=message.from_user.id,
        name=message.text,
        f_answers={},
        f_index=0,
    )
    await state.set_state(OnboardingStates.funnel_question)
    await message.answer(
        f"Отлично, {message.text}! 🎾\n\n"
        "Начнём с пары быстрых вопросов, чтобы прикинуть твой UTR. "
        "Чем глубже зайдёшь — тем точнее оценка. Поехали 👇"
    )
    await _send_funnel_question(message, state)


# ---------------------------------------------------------------------------
# Adaptive funnel assessment
# ---------------------------------------------------------------------------
def _inline_kb(rows: list) -> InlineKeyboardMarkup:
    """rows: list of (text, callback_data) -> one button per row."""
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=t, callback_data=d)] for t, d in rows]
    )


def _inline_grid(items: list, cols: int = 4) -> InlineKeyboardMarkup:
    """items: list of (text, callback_data) -> packed `cols` per row."""
    rows = [
        [InlineKeyboardButton(text=t, callback_data=d) for t, d in items[i:i + cols]]
        for i in range(0, len(items), cols)
    ]
    return InlineKeyboardMarkup(inline_keyboard=rows)


def _extract_int(text):
    digits = "".join(ch for ch in str(text or "") if ch.isdigit())
    return int(digits) if digits else None


async def _send_funnel_question(message: Message, state: FSMContext):
    data = await state.get_data()
    f_index = data.get("f_index", 0)
    q = funnel.get_question(f_index)
    if q is None:
        await _finalize_funnel(message, state)
        return

    hint = ("\n\n💡 Отвечай кнопками. После каждого блока сможешь остановиться "
            "или копнуть глубже — чем глубже, тем точнее UTR.") if f_index == 0 else ""
    header = f"{funnel.question_label(f_index)}\n\n{q.text_ru}{hint}"
    if q.qtype in ("choice", "rating"):
        rows = [(label, f"fa:{q.id}:{value}") for value, label in q.options]
        await message.answer(header, reply_markup=_inline_kb(rows))
    else:
        await message.answer(header)


async def _advance_funnel(message: Message, state: FSMContext):
    data = await state.get_data()
    f_index = data.get("f_index", 0)
    if f_index >= funnel.total_questions():
        await _finalize_funnel(message, state)
    elif funnel.is_tier_boundary(f_index):
        await _show_branch(message, state)
    else:
        await state.set_state(OnboardingStates.funnel_question)
        await _send_funnel_question(message, state)


async def _show_branch(message: Message, state: FSMContext):
    data = await state.get_data()
    f_index = data.get("f_index", 0)
    answers = data.get("f_answers", {})
    just_done = funnel.tier_of_index(f_index - 1)
    next_tier = funnel.tier_of_index(f_index)

    skill_ratings = funnel.parse_answers(answers)
    est = estimate_utr(answers, skill_ratings, [], just_done)

    text = (
        f"📊 Твоя оценка UTR: {est.value} (диапазон {est.low}–{est.high})\n"
        f"Уверенность: {est.confidence}%\n\n"
        f"{funnel.progress_line(est.confidence, next_tier)}\n\n"
        f"Копаем глубже или хватит?"
    )
    rows = [("🔬 Глубже", "fb:deeper"), ("✅ Хватит, к плану", "fb:stop")]
    await state.set_state(OnboardingStates.funnel_branch)
    await message.answer(text, reply_markup=_inline_kb(rows))


@router.callback_query(F.data.startswith("fa:"))
async def on_funnel_answer(callback: CallbackQuery, state: FSMContext):
    await callback.answer()
    _, qid, value = callback.data.split(":", 2)

    data = await state.get_data()
    f_index = data.get("f_index", 0)
    current_q = funnel.get_question(f_index)
    # Ignore stale taps that don't match the current question
    if not current_q or current_q.id != qid:
        return

    answers = data.get("f_answers", {})
    answers[qid] = value
    await state.update_data(f_answers=answers, f_index=f_index + 1)

    try:
        await callback.message.edit_reply_markup(reply_markup=None)
    except Exception:
        pass
    await _advance_funnel(callback.message, state)


@router.callback_query(F.data.startswith("fb:"))
async def on_funnel_branch(callback: CallbackQuery, state: FSMContext):
    await callback.answer()
    try:
        await callback.message.edit_reply_markup(reply_markup=None)
    except Exception:
        pass

    choice = callback.data.split(":", 1)[1]
    if choice == "deeper":
        await state.set_state(OnboardingStates.funnel_question)
        await _send_funnel_question(callback.message, state)
    else:
        await _finalize_funnel(callback.message, state)


@router.message(OnboardingStates.funnel_question)
async def on_funnel_typed(message: Message, state: FSMContext):
    data = await state.get_data()
    f_index = data.get("f_index", 0)
    q = funnel.get_question(f_index)
    if q is None:
        await _finalize_funnel(message, state)
        return

    if q.qtype == "number":
        if _extract_int(message.text) is None:
            await message.answer("Введи число, пожалуйста.")
            return
        value = str(_extract_int(message.text))
    elif q.qtype == "text":
        value = message.text
    else:
        await message.answer("Выбери вариант кнопкой 👆")
        return

    answers = data.get("f_answers", {})
    answers[q.id] = value
    await state.update_data(f_answers=answers, f_index=f_index + 1)
    await _advance_funnel(message, state)


def _derive_strengths(skill_ratings: dict, answers: dict):
    """Top-2 dimensions = strengths, bottom-2 = weaknesses (fallback to 'weakest' choice)."""
    if skill_ratings:
        ordered = sorted(skill_ratings.items(), key=lambda kv: kv[1])
        weak = [d for d, _ in ordered[:2]]
        strong = [d for d, _ in ordered[-2:]][::-1]
        return strong, weak
    w = answers.get("weakest")
    return [], ([w] if w else [])


async def _finalize_funnel(message: Message, state: FSMContext):
    data = await state.get_data()
    user_id = data["user_id"]
    name = data.get("name", "Игрок")
    answers = data.get("f_answers", {})
    f_index = data.get("f_index", 0)

    skill_ratings = funnel.parse_answers(answers)
    tier = funnel.deepest_completed_tier(f_index)

    if data.get("mode") == "retest":
        await _finalize_retest(message, state, user_id, answers, skill_ratings, tier)
        return

    est = estimate_utr(answers, skill_ratings, [], tier)
    strengths, weaknesses = _derive_strengths(skill_ratings, answers)
    goals = [g for g in [answers.get("goal_short", ""), answers.get("goal_long", "")] if g]

    logger.info(f"[funnel] finalize user_id={user_id}, tier={tier}, utr={est.value}, conf={est.confidence}")

    player = create_player(
        user_id=user_id,
        name=name,
        level=answers.get("level", "recreational"),
        experience_years=_extract_int(answers.get("years")) or 0,
        assessment_data={
            "strengths": strengths,
            "weaknesses": weaknesses,
            "goals": goals,
            "height_cm": _extract_int(answers.get("height")),
            "two_handed_backhand": answers.get("bh_type") == "two",
            "raw": answers,
        },
    )
    player.skill_ratings = skill_ratings
    player.assessment_tier = tier
    player.utr_value = est.value
    player.utr_low = est.low
    player.utr_high = est.high
    player.utr_confidence = est.confidence
    save_player(player)
    await state.clear()

    await message.answer(
        f"✅ Профиль готов, {name}!\n\n"
        f"🎾 Твой ориентировочный UTR: {est.value}\n"
        f"   Диапазон: {est.low}–{est.high}\n"
        f"   Уверенность: {est.confidence}%\n\n"
        "Уточнить позже: глубже опрос (/retest) или логируй матчи (/matchlog).\n\n"
        "Теперь соберём твой недельный график 👇"
    )
    await _start_schedule(message, state, user_id)


async def _finalize_retest(message: Message, state: FSMContext, user_id, answers, skill_ratings, tier):
    """Re-assessment: update an existing player's UTR and rebalance the program."""
    player = load_player(user_id)
    if not player:
        await state.clear()
        await message.answer("Профиль не найден: /start")
        return

    old_utr = player.utr_value
    merged = dict(player.skill_ratings or {})
    merged.update(skill_ratings)
    player.skill_ratings = merged
    player.assessment_tier = max(player.assessment_tier or 0, tier)
    player.assessment = {**(player.assessment or {}), **answers}

    est = estimate_utr(player.assessment, merged, player.match_results or [], player.assessment_tier)
    player.utr_value, player.utr_low, player.utr_high, player.utr_confidence = (
        est.value, est.low, est.high, est.confidence)

    rebalanced = False
    if player.program:
        prog = periodization.apply_retest(player.program, est.value, _weak_dims_for(player))
        player.program = prog.model_dump()
        rebalanced = True

    save_player(player)
    await state.clear()

    arrow = f" (было {old_utr})" if old_utr is not None else ""
    await message.answer(
        f"🔁 Ре-тест готов!\n\n"
        f"🎾 UTR: {est.value}{arrow}\n"
        f"   Диапазон: {est.low}–{est.high}\n"
        f"   Уверенность: {est.confidence}%"
        + ("\n\nПрограмма перебалансирована под текущие слабые зоны. Смотри /program."
           if rebalanced else "")
    )


# ---------------------------------------------------------------------------
# Weekly schedule capture (after funnel, before /goal)
# ---------------------------------------------------------------------------
async def _start_schedule(message: Message, state: FSMContext, user_id):
    await state.set_state(OnboardingStates.sched_count)
    await state.update_data(user_id=user_id, sched_counts={}, sched_idx=0)
    await _ask_sched_count(message, state)


async def _ask_sched_count(message: Message, state: FSMContext):
    data = await state.get_data()
    idx = data.get("sched_idx", 0)
    if idx >= len(SCHED_ORDER):
        await _save_schedule_and_summary(message, state)
        return
    cat = SCHED_ORDER[idx]
    meta = SCHED_TYPES[cat]
    grid = _inline_grid([(str(n), f"sc:{cat}:{n}") for n in range(0, 8)], cols=4)
    await message.answer(f"Сколько раз в неделю: {meta['emoji']} {meta['title']}?",
                         reply_markup=grid)


@router.callback_query(F.data.startswith("sc:"))
async def on_sched_count(callback: CallbackQuery, state: FSMContext):
    await callback.answer()
    try:
        await callback.message.edit_reply_markup(reply_markup=None)
    except Exception:
        pass
    _, cat, n = callback.data.split(":", 2)
    data = await state.get_data()
    counts = data.get("sched_counts", {})
    counts[cat] = int(n)
    await state.update_data(sched_counts=counts, sched_idx=data.get("sched_idx", 0) + 1)
    await _ask_sched_count(callback.message, state)


async def _save_schedule_and_summary(message: Message, state: FSMContext):
    data = await state.get_data()
    player = load_player(data["user_id"])
    if not player:
        await state.clear()
        await message.answer("Профиль не найден: /start")
        return
    dicts = build_sessions_from_counts(data.get("sched_counts", {}),
                                       weak_dims=_weak_dims_for(player))
    player.training_sessions = [TrainingSession(**d) for d in dicts]
    player.weekly_training_minutes = weekly_minutes_of(dicts)
    save_player(player)
    await _show_sched_summary(message, state, player)


async def _show_sched_summary(message: Message, state: FSMContext, player):
    await state.set_state(OnboardingStates.sched_count)
    body = format_sessions_ru(player.training_sessions)
    await message.answer(
        f"📅 Твой недельный график (~{player.weekly_training_minutes} мин/нед):\n\n{body}",
        reply_markup=_inline_kb([
            ("✅ Готово — к цели", "sm:done"),
            ("➕ Добавить свою сессию", "sm:add"),
            ("🔄 Заново", "sm:reset"),
        ]),
    )


@router.callback_query(F.data.startswith("sm:"))
async def on_sched_menu(callback: CallbackQuery, state: FSMContext):
    await callback.answer()
    try:
        await callback.message.edit_reply_markup(reply_markup=None)
    except Exception:
        pass
    action = callback.data.split(":", 1)[1]
    if action == "reset":
        await state.update_data(sched_counts={}, sched_idx=0)
        await _ask_sched_count(callback.message, state)
    elif action == "add":
        await state.set_state(OnboardingStates.sched_add_name)
        await callback.message.answer("Название своей сессии? (например: «Утро: подача + ноги»)")
    else:  # done
        data = await state.get_data()
        player = load_player(data["user_id"])
        await state.clear()
        await callback.message.answer(
            "🎯 График сохранён! Теперь поставь цель: /goal — соберу программу под неё."
        )
        if player:
            plan = generate_daily_plan(player)
            await callback.message.answer(format_plan_message(plan, player))


_SA_TYPE_LABELS = [("🎾 Корт", "court"), ("🤸 Соло", "solo"), ("🏋️ Зал", "gym"), ("🆚 Матч", "match")]
_SA_DAYS = [("Пн", "Mon"), ("Вт", "Tue"), ("Ср", "Wed"), ("Чт", "Thu"),
            ("Пт", "Fri"), ("Сб", "Sat"), ("Вс", "Sun"), ("Каждый день", "daily")]


@router.message(OnboardingStates.sched_add_name)
async def on_sched_add_name(message: Message, state: FSMContext):
    await state.update_data(sa_name=message.text)
    await message.answer("Тип сессии?", reply_markup=_inline_grid(
        [(t, f"sa_type:{v}") for t, v in _SA_TYPE_LABELS], cols=2))


@router.callback_query(F.data.startswith("sa_type:"))
async def on_sched_add_type(callback: CallbackQuery, state: FSMContext):
    await callback.answer()
    try:
        await callback.message.edit_reply_markup(reply_markup=None)
    except Exception:
        pass
    await state.update_data(sa_type=callback.data.split(":", 1)[1])
    await callback.message.answer("В какой день?", reply_markup=_inline_grid(
        [(t, f"sa_day:{v}") for t, v in _SA_DAYS], cols=4))


@router.callback_query(F.data.startswith("sa_day:"))
async def on_sched_add_day(callback: CallbackQuery, state: FSMContext):
    await callback.answer()
    try:
        await callback.message.edit_reply_markup(reply_markup=None)
    except Exception:
        pass
    await state.update_data(sa_day=callback.data.split(":", 1)[1])
    await state.set_state(OnboardingStates.sched_add_time)
    await callback.message.answer("Во сколько? (ЧЧ:ММ, например 18:30)")


@router.message(OnboardingStates.sched_add_time)
async def on_sched_add_time(message: Message, state: FSMContext):
    t = (message.text or "").strip()
    if not re.match(r"^\d{1,2}:\d{2}$", t):
        await message.answer("Формат времени ЧЧ:ММ, например 07:00")
        return
    await state.update_data(sa_time=t)
    await state.set_state(OnboardingStates.sched_add_dur)
    await message.answer("Длительность в минутах? (например 60)")


@router.message(OnboardingStates.sched_add_dur)
async def on_sched_add_dur(message: Message, state: FSMContext):
    dur = _extract_int(message.text)
    if not dur or dur < 5:
        await message.answer("Введи минуты числом, например 60")
        return
    data = await state.get_data()
    player = load_player(data["user_id"])
    if not player:
        await state.clear()
        await message.answer("Профиль не найден: /start")
        return
    cat = data.get("sa_type", "court")
    day = data.get("sa_day")
    day = None if day == "daily" else day
    d = make_session_dict(cat, day, data.get("sa_time", "18:00"), dur,
                          weak_dims=_weak_dims_for(player), name=data.get("sa_name"))
    sessions = list(player.training_sessions) + [TrainingSession(**d)]
    player.training_sessions = sessions
    player.weekly_training_minutes = weekly_minutes_of(sessions)
    save_player(player)
    await message.answer("Добавил! ✅")
    await _show_sched_summary(message, state, player)


@router.message(OnboardingStates.sched_count)
async def on_sched_count_nudge(message: Message, state: FSMContext):
    await message.answer("Жми кнопки выше 👆 (или /goal, если график уже готов).")


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

    # Phase-aware: feed the current periodization week + today's sessions into the generator
    program_context = ""
    if player.program:
        wk = periodization.current_week_focus(player.program)
        if wk:
            program_context = periodization.describe_week(wk)

    today_sessions = get_today_sessions(player)
    if today_sessions:
        sess_line = "; ".join(f"{s.name} {s.time} ({s.duration_minutes}м)" for s in today_sessions)
        program_context += f"\nСессии сегодня: {sess_line}"
        await message.answer("📅 Сегодня по графику:\n" + format_sessions_ru(today_sessions))

    plan = generate_daily_plan(player, program_context)

    # Send text plan with videos
    await message.answer(format_plan_message(plan, player))

    # Delete status message ("⏳") — /plan is a typed command, so text-only reply
    await status_msg.delete()


# ---------------------------------------------------------------------------
# Periodization: target UTR + program
# ---------------------------------------------------------------------------
def _weak_dims_for(player) -> list:
    """Weakest dimensions (ascending) from skill ratings; fallback to weaknesses/default."""
    if player.skill_ratings:
        ordered = sorted(player.skill_ratings.items(), key=lambda kv: kv[1])
        return [d for d, _ in ordered[:3]]
    if player.weaknesses:
        return player.weaknesses[:3]
    return periodization.DEFAULT_WEAK_DIMS


@router.message(Command("goal"))
async def cmd_goal(message: Message, state: FSMContext):
    user: User = message.from_user
    player = load_player(user.id)
    if not player:
        await message.answer("Сначала создай профиль: /start")
        return
    cur = player.utr_value if player.utr_value is not None else "?"
    await state.set_state(OnboardingStates.waiting_target_utr)
    await message.answer(
        f"🎯 Текущий UTR: {cur}.\n\n"
        "Какой целевой UTR хочешь достичь? (например, 7.0)"
    )


@router.message(OnboardingStates.waiting_target_utr)
async def on_target_utr(message: Message, state: FSMContext):
    try:
        target = float((message.text or "").replace(",", "."))
    except ValueError:
        await message.answer("Введи число, например 7.0")
        return
    if not (1.0 <= target <= 16.5):
        await message.answer("UTR бывает от 1.0 до 16.5. Введи реальную цель.")
        return
    await state.update_data(target_utr=target)
    await state.set_state(OnboardingStates.waiting_target_date)
    await message.answer("За сколько недель хочешь дойти? (например, 12)")


@router.message(OnboardingStates.waiting_target_date)
async def on_target_weeks(message: Message, state: FSMContext):
    weeks = _extract_int(message.text)
    if not weeks or weeks < 1:
        await message.answer("Введи число недель, например 12.")
        return
    weeks = min(weeks, 104)

    data = await state.get_data()
    target = data.get("target_utr", 7.0)

    user: User = message.from_user
    player = load_player(user.id)
    if not player:
        await state.clear()
        await message.answer("Профиль не найден: /start")
        return

    current = player.utr_value or 3.0
    feasibility = periodization.assess_goal(current, target, weeks)

    program = periodization.build_program(
        current_utr=current,
        target_utr=target,
        weeks=weeks,
        weak_dims=_weak_dims_for(player),
        weekly_minutes=player.weekly_training_minutes or 0,
    )
    player.target_utr = target
    player.target_date = (date.today() + timedelta(weeks=weeks)).isoformat()
    player.program = program.model_dump()
    save_player(player)
    await state.clear()

    # Warn on unrealistic / ambitious targets (but still build the program)
    note = "" if feasibility["verdict"] == "ok" else feasibility["message"] + "\n\n"
    await message.answer(
        note
        + f"💪 Программа собрана: UTR {program.current_utr} → {target} за {weeks} нед.!\n\n"
        + periodization.format_program(program, player.language)
        + "\n\n/program — посмотреть программу. /plan — план на сегодня по текущей фазе."
    )


@router.message(Command("program"))
async def cmd_program(message: Message):
    user: User = message.from_user
    player = load_player(user.id)
    if not player:
        await message.answer("Сначала создай профиль: /start")
        return
    if not player.program:
        await message.answer("Программы пока нет. Поставь цель: /goal")
        return
    await message.answer(periodization.format_program(player.program, player.language))


# ---------------------------------------------------------------------------
# Match logging + re-test (UTR refinement / progress tracking)
# ---------------------------------------------------------------------------
@router.message(Command("matchlog"))
async def cmd_matchlog(message: Message, state: FSMContext):
    player = load_player(message.from_user.id)
    if not player:
        await message.answer("Сначала создай профиль: /start")
        return
    await state.set_state(OnboardingStates.matchlog_opp)
    await message.answer(
        "🎾 Логируем матч.\n\n"
        "UTR соперника? (число, например 6.5 — если не знаешь, прикинь примерно)"
    )


@router.message(OnboardingStates.matchlog_opp)
async def on_matchlog_opp(message: Message, state: FSMContext):
    try:
        opp = float((message.text or "").replace(",", "."))
    except ValueError:
        await message.answer("Введи число, например 6.5")
        return
    await state.update_data(ml_opp=opp)
    await message.answer(
        "Результат матча?",
        reply_markup=_inline_kb([("✅ Победа", "ml:won"), ("❌ Поражение", "ml:lost")]),
    )


@router.callback_query(F.data.startswith("ml:"))
async def on_match_result(callback: CallbackQuery, state: FSMContext):
    await callback.answer()
    try:
        await callback.message.edit_reply_markup(reply_markup=None)
    except Exception:
        pass
    won = callback.data.split(":", 1)[1] == "won"
    await state.update_data(ml_won=won)
    await state.set_state(OnboardingStates.matchlog_games)
    await callback.message.answer("Счёт в геймах (всего за матч): выиграл-проиграл, например 12-9")


@router.message(OnboardingStates.matchlog_games)
async def on_matchlog_games(message: Message, state: FSMContext):
    m = re.search(r"(\d+)\s*[-:xх]\s*(\d+)", message.text or "")
    if not m:
        await message.answer("Формат: выиграл-проиграл, например 12-9")
        return
    gw, gl = int(m.group(1)), int(m.group(2))

    data = await state.get_data()
    player = load_player(message.from_user.id)
    if not player:
        await state.clear()
        await message.answer("Профиль не найден: /start")
        return

    match = {
        "date": date.today().isoformat(),
        "opponent_utr": data.get("ml_opp"),
        "won": bool(data.get("ml_won")),
        "games_won": gw,
        "games_lost": gl,
        "note": "",
    }
    old = player.utr_value
    est = refine_with_match(player, match)  # appends match + recomputes player.utr_*
    if player.program:
        prog = periodization.apply_retest(player.program, est.value, _weak_dims_for(player))
        player.program = prog.model_dump()
    save_player(player)
    await state.clear()

    arrow = f" (было {old})" if old is not None else ""
    await message.answer(
        f"📈 Матч записан! Всего матчей: {len(player.match_results)}.\n\n"
        f"🎾 UTR: {est.value}{arrow}\n"
        f"   Диапазон: {est.low}–{est.high}\n"
        f"   Уверенность: {est.confidence}% — матчи поднимают точность сильнее всего."
    )


@router.message(Command("retest"))
async def cmd_retest(message: Message, state: FSMContext):
    player = load_player(message.from_user.id)
    if not player:
        await message.answer("Сначала создай профиль: /start")
        return
    await state.set_state(OnboardingStates.funnel_question)
    await state.update_data(
        user_id=player.user_id, name=player.name,
        f_answers={}, f_index=0, mode="retest",
    )
    await message.answer(
        "🔁 Ре-тест: пройди опрос заново (можешь зайти глубже, чем в прошлый раз). "
        "Это обновит твой UTR и перебалансирует программу 👇"
    )
    await _send_funnel_question(message, state)


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


@router.message(F.text & ~F.text.startswith("/"))
async def handle_checkin_text(message: Message, state: FSMContext):
    user: User = message.from_user
    player = load_player(user.id)

    if not player:
        await message.answer("Сначала создай профиль: /start")
        return

    data = await state.get_data()
    if data.get("waiting_for_checkin"):
        await _process_checkin(message, state, player, message.text, voice_reply=False)
    else:
        # No active check-in -> free-form chat with the coach (text in, text out)
        await _coach_chat(message, state, player, message.text, voice_reply=False)


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


@router.message(Command("voice"))
async def cmd_voice(message: Message):
    user: User = message.from_user
    player = load_player(user.id)
    if not player:
        await message.answer("Сначала создай профиль: /start")
        return
    player.voice_enabled = not player.voice_enabled
    save_player(player)
    if player.voice_enabled:
        await message.answer("🔊 Голос коуча включён — буду озвучивать планы и фидбэк.")
    else:
        await message.answer("🔇 Голос выключен — только текст. /voice — включить обратно.")


@router.message(Command("videos"))
async def cmd_videos(message: Message):
    user: User = message.from_user
    player = load_player(user.id)

    if not player:
        await message.answer("Сначала создай профиль: /start")
        return

    focus = [player.current_focus] + (player.weaknesses[:2] if player.weaknesses else [])
    await message.bot.send_chat_action(message.chat.id, "typing")

    try:
        vids = await youtube.recommend(focus, player.language, player.level, limit=5)
    except Exception as e:
        logger.warning(f"youtube recommend failed: {e}")
        vids = None

    if vids:
        await message.answer(youtube.format_videos(vids, player.language))
    else:
        # No API key (or error) -> always-valid trusted-channel search links
        note = ("🔎 Живой YouTube-поиск выключен (добавь YOUTUBE_API_KEY). "
                "Пока — подборки по теме на проверенных каналах:"
                if player.language == "RU" else
                "🔎 Live YouTube search is off (add YOUTUBE_API_KEY). "
                "Meanwhile — topic searches on trusted channels:")
        links = youtube.fallback_links(focus, player.language, limit=4)
        await message.answer(note + "\n\n" + youtube.format_videos(links, player.language))


@router.message(Command("schedule"))
async def cmd_schedule(message: Message):
    """Show current training schedule"""
    user: User = message.from_user
    player = load_player(user.id)

    if not player:
        await message.answer("Сначала создай профиль: /start")
        return

    if not player.training_sessions:
        await message.answer(
            "У тебя пока нет графика тренировок.\n\n"
            "Собрать по типам (корт/соло/зал/матчи): /schedule_setup\n"
            "Или готовый шаблон: /schedule_intermediate"
        )
        return

    # Show current schedule
    await message.answer(
        f"📅 Твой недельный график (~{player.weekly_training_minutes} мин/нед):\n\n"
        + format_sessions_ru(player.training_sessions)
        + "\n\nПересобрать: /schedule_setup"
    )

    # Show today's sessions
    today_sessions = get_today_sessions(player)
    if today_sessions:
        await message.answer("Сегодня:\n" + format_sessions_ru(today_sessions))


@router.message(Command("schedule_setup"))
async def cmd_schedule_setup(message: Message, state: FSMContext):
    player = load_player(message.from_user.id)
    if not player:
        await message.answer("Сначала создай профиль: /start")
        return
    await message.answer("📅 Собираем недельный график. Отвечай кнопками 👇")
    await _start_schedule(message, state, player.user_id)


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

    try:
        # "recording voice…" indicator (transient, no message clutter)
        await message.bot.send_chat_action(message.chat.id, "record_voice")

        file = await message.bot.get_file(message.voice.file_id)
        voice_data = await message.bot.download_file(file.file_path)
        text = await transcribe_voice(voice_data.read())

        if not text:
            await message.answer("❌ Не разобрал голос, повтори?")
            return

        # Voice in -> voice out (unless the user turned voice off with /voice)
        voice_reply = player.voice_enabled
        data = await state.get_data()
        if data.get("waiting_for_checkin"):
            await _process_checkin(message, state, player, text, voice_reply=voice_reply)
        else:
            await _coach_chat(message, state, player, text, voice_reply=voice_reply)

    except Exception as e:
        logger.warning(f"voice processing error: {e}")
        await message.answer("❌ Ошибка с голосом, попробуй ещё раз.")


def _make_buttons(options):
    # Simplified button keyboard - aiogram requires proper imports for InlineKeyboardMarkup
    return None  # We'll use simple text responses for now
