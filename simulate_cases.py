"""
Simulate 10 player personas clicking through the bot and dump each full
conversation to test_cases/*.txt (+ a SUMMARY.md index).

Personas: 2 lazy, 3 semi-lazy, 5 scrupulous. Answers are randomized (seeded
per case for reproducibility). Drives the REAL aiogram dispatcher + router with
a mocked Bot; Claude/voice are stubbed so it's free and deterministic.

Run:  py -3.12 simulate_cases.py
"""

import os
import sys
import re
import random
import asyncio
from datetime import datetime
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-sim-dummy")

from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.client.session.base import BaseSession
from aiogram.types import Update, Message, Chat, User as TgUser, CallbackQuery

import src.bot as botmod
from src.bot import router
from src import funnel as F
from src.training_schedule import SCHED_ORDER
from src.storage import load_player, get_player_file
from src.models import DailyPlan

OUT_DIR = Path("test_cases")


# --- Mocked session ---------------------------------------------------------
class RecordingSession(BaseSession):
    def __init__(self):
        super().__init__()
        self.records = []

    async def close(self):
        pass

    async def stream_content(self, *a, **k):
        yield b""

    async def make_request(self, bot, method, timeout=None):
        name = type(method).__name__
        chat_id = getattr(method, "chat_id", 0) or 0
        text = getattr(method, "text", "") or ""
        self.records.append((name, {"chat_id": chat_id, "text": text}))
        if name == "SendMessage":
            return Message(message_id=len(self.records), date=datetime.now(),
                           chat=Chat(id=chat_id, type="private"), text=text).as_(bot)
        if name in ("SendVoice", "SendPhoto", "SendDocument", "SendAudio"):
            return Message(message_id=len(self.records), date=datetime.now(),
                           chat=Chat(id=chat_id, type="private")).as_(bot)
        return True


# --- Stubs (free + deterministic, but readable) -----------------------------
def _stub_plan(player, *a, **k):
    focus = player.current_focus or "consistency"
    return DailyPlan(
        date=datetime.now().strftime("%Y-%m-%d"),
        focus=f"Приоритет недели: {focus}",
        drill=(f"Разминка 10 мин; основной блок 30 мин на «{focus}» "
               f"(корзина 80 мячей, техника); игровые очки 15 мин; заминка 5 мин."),
        estimated_time_minutes=60,
    )


def _stub_checkin(player, text):
    return "Хорошая работа! Завтра добавим объёма на слабой стороне. 🔥"


async def _stub_voice(*a, **k):
    return None


botmod.generate_daily_plan = _stub_plan
botmod.analyze_checkin = _stub_checkin
botmod.generate_daily_voice_message = _stub_voice
botmod.generate_checkin_feedback_voice = _stub_voice
botmod.chat_with_coach = lambda player, text, history=None: "Держим фокус — погнали! 🎾"


# --- Harness with transcript ------------------------------------------------
class SimBot:
    def __init__(self):
        self.session = RecordingSession()
        self.bot = Bot(token="123456:SIMtoken_harness-0123456789ABCDEFG",
                       session=self.session)
        self.dp = Dispatcher(storage=MemoryStorage())
        self.dp.include_router(router)
        self.user_id = 990000
        self._uid = 1000
        self._seen = 0
        self.transcript = []
        self.errors = []

        @self.dp.errors()
        async def on_error(event):
            self.errors.append(repr(event.exception))
            return True

    def _next(self):
        self._uid += 1
        return self._uid

    def _text_update(self, text):
        user = TgUser(id=self.user_id, is_bot=False, first_name="Player")
        chat = Chat(id=self.user_id, type="private")
        msg = Message(message_id=self._next(), date=datetime.now(), chat=chat,
                      from_user=user, text=text).as_(self.bot)
        return Update(update_id=self._uid, message=msg)

    def _cb_update(self, data):
        user = TgUser(id=self.user_id, is_bot=False, first_name="Player")
        chat = Chat(id=self.user_id, type="private")
        bot_msg = Message(message_id=self._next(), date=datetime.now(), chat=chat,
                          from_user=TgUser(id=123456, is_bot=True, first_name="Bot"),
                          text="(keyboard)").as_(self.bot)
        cb = CallbackQuery(id=str(self._uid), from_user=user, chat_instance="ci",
                           message=bot_msg, data=data).as_(self.bot)
        return Update(update_id=self._uid, callback_query=cb)

    async def _feed(self, update, user_line):
        self.transcript.append(f"👤 {user_line}")
        await self.dp.feed_update(self.bot, update)
        new = self.session.records[self._seen:]
        self._seen = len(self.session.records)
        for n, d in new:
            if n == "SendMessage":
                self.transcript.append("🤖 " + d.get("text", ""))

    async def send_text(self, text):
        await self._feed(self._text_update(text), text)

    async def tap(self, data, label):
        await self._feed(self._cb_update(data), f"[нажал кнопку: {label}]")


# --- Persona driving --------------------------------------------------------
TEXT_POOL = ["Хочу стабильнее играть", "Выйти на турниры", "Подтянуть подачу",
             "Атакующий с задней линии, но нестабильный", "Люблю длинные розыгрыши"]


def _pick_value(q, rng):
    if q.qtype == "rating":
        return str(rng.randint(2, 5))
    if q.qtype == "choice":
        return rng.choice([v for v, _ in q.options])
    if q.qtype == "number":
        return {"years": str(rng.randint(1, 18)),
                "height": str(rng.randint(160, 198)),
                "first_serve_pct": str(rng.randint(40, 75))}.get(q.id, str(rng.randint(2, 9)))
    return rng.choice(TEXT_POOL)


async def run_funnel(sb: SimBot, target_tier, rng):
    boundaries = set(F.tier_start_indices().values())
    i, total = 0, F.total_questions()
    while i < total:
        if i in boundaries and i > 0:
            completed = F.tier_of_index(i - 1)
            if completed >= target_tier:
                await sb.tap("fb:stop", "✅ Хватит, к плану")
                return
            await sb.tap("fb:deeper", "🔬 Глубже")
        q = F.get_question(i)
        v = _pick_value(q, rng)
        if q.qtype in ("choice", "rating"):
            await sb.tap(f"fa:{q.id}:{v}", dict(q.options)[v])
        else:
            await sb.send_text(v)
        i += 1


async def run_schedule(sb: SimBot, rng, persona):
    if persona == "Ленивый":
        counts = {"court": rng.choice([0, 1]), "solo": rng.choice([0, 1, 2]), "gym": 0, "match": 0}
    elif persona == "Полуленивый":
        counts = {"court": rng.randint(1, 2), "solo": rng.randint(1, 3),
                  "gym": rng.choice([0, 1]), "match": rng.choice([0, 1])}
    else:
        counts = {"court": rng.randint(2, 4), "solo": rng.randint(3, 5),
                  "gym": rng.randint(1, 2), "match": rng.randint(1, 2)}
    for cat in SCHED_ORDER:
        await sb.tap(f"sc:{cat}:{counts[cat]}", f"{cat} = {counts[cat]}/нед")
    # scrupulous players sometimes add a custom session
    if persona == "Скрупулёзный" and rng.random() > 0.4:
        await sb.tap("sm:add", "➕ Добавить свою сессию")
        await sb.send_text("Утро: подача + работа ног")
        cat = rng.choice(["court", "solo", "gym", "match"])
        await sb.tap(f"sa_type:{cat}", f"тип = {cat}")
        day = rng.choice(["Mon", "Wed", "Fri", "Sat", "daily"])
        await sb.tap(f"sa_day:{day}", f"день = {day}")
        await sb.send_text(rng.choice(["07:00", "18:30", "20:00"]))
        await sb.send_text(str(rng.choice([20, 30, 45, 60, 90])))
    await sb.tap("sm:done", "✅ Готово — к цели")


async def run_goal(sb: SimBot, rng):
    p = load_player(sb.user_id)
    target = round(min(16.5, (p.utr_value or 4.0) + rng.choice([0.5, 1.0, 1.5, 2.0])), 1)
    weeks = rng.choice([8, 12, 16, 24])
    await sb.send_text("/goal")
    await sb.send_text(str(target))
    await sb.send_text(str(weeks))


async def run_matches(sb: SimBot, n, rng):
    for _ in range(n):
        cur = (load_player(sb.user_id).utr_value or 5.0)
        opp = round(max(1.0, cur + rng.uniform(-1.5, 1.5)), 1)
        won = rng.random() > 0.5
        if won:
            gw, gl = rng.randint(9, 14), rng.randint(2, 8)
        else:
            gw, gl = rng.randint(2, 8), rng.randint(9, 14)
        await sb.send_text("/matchlog")
        await sb.send_text(str(opp))
        await sb.tap("ml:won" if won else "ml:lost", "✅ Победа" if won else "❌ Поражение")
        await sb.send_text(f"{gw}-{gl}")


async def run_retest(sb: SimBot, tier, rng):
    await sb.send_text("/retest")
    await run_funnel(sb, tier, rng)


CASES = [
    dict(uid=990001, seed=11, name="Лёша", persona="Ленивый", tier=0, goal=False, matches=0, retest=None),
    dict(uid=990002, seed=12, name="Катя", persona="Ленивый", tier=0, goal=False, matches=0, retest=None),
    dict(uid=990003, seed=21, name="Игорь", persona="Полуленивый", tier=1, goal=True, matches=0, retest=None),
    dict(uid=990004, seed=22, name="Марина", persona="Полуленивый", tier=2, goal=True, matches=1, retest=None),
    dict(uid=990005, seed=23, name="Дима", persona="Полуленивый", tier=1, goal=True, matches=0, retest=None),
    dict(uid=990006, seed=31, name="Олег", persona="Скрупулёзный", tier=3, goal=True, matches=2, retest=3),
    dict(uid=990007, seed=32, name="Света", persona="Скрупулёзный", tier=3, goal=True, matches=1, retest=None),
    dict(uid=990008, seed=33, name="Артём", persona="Скрупулёзный", tier=3, goal=True, matches=2, retest=None),
    dict(uid=990009, seed=34, name="Нина", persona="Скрупулёзный", tier=3, goal=True, matches=1, retest=3),
    dict(uid=990010, seed=35, name="Павел", persona="Скрупулёзный", tier=3, goal=True, matches=2, retest=None),
]


def _summary_block(p):
    if not p:
        return "ИТОГ: профиль не создан ❌"
    sched = ""
    if p.training_sessions:
        sched = f"\n  График: {len(p.training_sessions)} сессий/нед, ~{p.weekly_training_minutes} мин/нед"
    prog = ""
    if p.program:
        prog = (f"\n  Цель: UTR {p.target_utr} к {p.target_date} | "
                f"программа {p.program.get('total_weeks')} нед.")
    return (
        "ИТОГ:\n"
        f"  UTR: {p.utr_value} (диапазон {p.utr_low}–{p.utr_high}), уверенность {p.utr_confidence}%\n"
        f"  Тир опроса: {p.assessment_tier} | матчей залогировано: {len(p.match_results)}\n"
        f"  Сильные: {p.strengths or '—'} | Слабые: {p.weaknesses or '—'} | Фокус: {p.current_focus}"
        + sched + prog
    )


async def run_case(sb: SimBot, idx, case):
    sb.user_id = case["uid"]
    sb.transcript = []
    sb.errors = []
    get_player_file(sb.user_id).unlink(missing_ok=True)
    rng = random.Random(case["seed"])

    await sb.send_text("/start")
    await sb.send_text(case["name"])
    await run_funnel(sb, case["tier"], rng)
    await run_schedule(sb, rng, case["persona"])
    if case["goal"]:
        await run_goal(sb, rng)
        await sb.send_text("/program")
    if case["matches"]:
        await run_matches(sb, case["matches"], rng)
    if case["retest"]:
        await run_retest(sb, case["retest"], rng)

    player = load_player(sb.user_id)
    summary = _summary_block(player)

    fname = OUT_DIR / f"case_{idx:02d}_{case['persona'].lower()}_{case['name']}.txt"
    header = (
        f"ТЕСТ-КЕЙС {idx:02d} — {case['persona']} игрок\n"
        f"Имя: {case['name']} | сид: {case['seed']} | целевой тир: {case['tier']}"
        f" | цель: {'да' if case['goal'] else 'нет'} | матчи: {case['matches']}"
        f" | ре-тест: {case['retest'] or 'нет'}\n"
        + "=" * 60 + "\n"
    )
    body = "\n".join(sb.transcript)
    errs = ("\n\n⚠️ ОШИБКИ: " + "; ".join(sb.errors)) if sb.errors else ""
    fname.write_text(header + body + "\n\n" + "=" * 60 + "\n" + summary + errs + "\n",
                     encoding="utf-8")
    return player, fname, sb.errors


async def main():
    OUT_DIR.mkdir(exist_ok=True)
    sb = SimBot()
    rows = []
    any_err = False
    for idx, case in enumerate(CASES, 1):
        player, fname, errs = await run_case(sb, idx, case)
        any_err = any_err or bool(errs)
        rows.append((idx, case, player, fname, errs))
        utr = f"{player.utr_value} ({player.utr_confidence}%)" if player else "—"
        print(f"  case {idx:02d} {case['persona']:13} {case['name']:7} -> "
              f"tier {player.assessment_tier if player else '?'}, UTR {utr}, "
              f"{'errors!' if errs else 'ok'}  -> {fname.name}")

    # SUMMARY.md
    lines = ["# Сводка тест-кейсов\n",
             f"Сгенерировано: {datetime.now():%Y-%m-%d %H:%M}\n",
             "| # | Персона | Имя | Тир | UTR | Уверенность | Матчи | Цель | Ошибки |",
             "|---|---------|-----|-----|-----|-------------|-------|------|--------|"]
    for idx, case, p, fname, errs in rows:
        lines.append(
            f"| {idx:02d} | {case['persona']} | {case['name']} | "
            f"{p.assessment_tier if p else '?'} | {p.utr_value if p else '—'} | "
            f"{p.utr_confidence if p else '—'}% | {len(p.match_results) if p else 0} | "
            f"{(p.target_utr if p and p.target_utr else '—')} | "
            f"{'⚠️' if errs else 'ok'} | [{fname.name}]({fname.name})"
        )
    (OUT_DIR / "SUMMARY.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"\nФайлы записаны в: {OUT_DIR.resolve()}")
    print("Сводка: test_cases/SUMMARY.md")
    print("ИТОГ:", "⚠️ были ошибки в обработчиках" if any_err else "✅ без ошибок обработчиков")
    await sb.bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
