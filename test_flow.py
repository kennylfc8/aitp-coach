"""
Local test harness for the AITP Tennis Coach bot.

Drives the REAL aiogram dispatcher + router with fake updates (text messages AND
inline-button callback queries) and a mocked Bot, so the whole funnel + handlers
+ FSM are exercised WITHOUT Telegram.

Run:  py -3.12 test_flow.py
"""

import os
import sys
import re
import asyncio
from datetime import datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-harness-dummy")

from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.client.session.base import BaseSession
from aiogram.types import Update, Message, Chat, User as TgUser, CallbackQuery

import src.bot as botmod
from src.bot import router
from src import funnel as F
from src import utr as U
from src import periodization as PER
from src.training_schedule import SCHED_ORDER
from src.storage import load_player, get_player_file
from src.models import DailyPlan

TEST_USER_ID = 999999001
BOT_ID = 123456


# ---------------------------------------------------------------------------
# Mocked Bot session: records outgoing API calls instead of hitting Telegram.
# ---------------------------------------------------------------------------
class RecordingSession(BaseSession):
    def __init__(self):
        super().__init__()
        self.records = []  # list[(method_name, data)]

    async def close(self):
        pass

    async def stream_content(self, *args, **kwargs):
        yield b""

    async def make_request(self, bot, method, timeout=None):
        name = type(method).__name__
        chat_id = getattr(method, "chat_id", 0) or 0
        text = getattr(method, "text", "") or ""
        self.records.append((name, {"chat_id": chat_id, "text": text}))
        if name == "SendMessage":
            return Message(
                message_id=len(self.records), date=datetime.now(),
                chat=Chat(id=chat_id, type="private"), text=text,
            ).as_(bot)
        if name in ("SendVoice", "SendPhoto", "SendDocument", "SendAudio"):
            return Message(
                message_id=len(self.records), date=datetime.now(),
                chat=Chat(id=chat_id, type="private"),
            ).as_(bot)
        return True


# ---------------------------------------------------------------------------
# Stub Claude / voice so the harness is fast, free and deterministic.
# ---------------------------------------------------------------------------
def _stub_plan(player, *args, **kwargs):
    return DailyPlan(date=datetime.now().strftime("%Y-%m-%d"),
                     focus="Стабильность", drill="Корзина 100 мячей.",
                     estimated_time_minutes=40)


def _stub_checkin(player, text):
    return "Отличная работа! Завтра поработай над подачей. 🔥"


async def _stub_voice(*args, **kwargs):
    return None


botmod.generate_daily_plan = _stub_plan
botmod.analyze_checkin = _stub_checkin
botmod.generate_daily_voice_message = _stub_voice


# ---------------------------------------------------------------------------
# Update builders
# ---------------------------------------------------------------------------
def make_text_update(uid, text, bot):
    user = TgUser(id=TEST_USER_ID, is_bot=False, first_name="Тестер")
    chat = Chat(id=TEST_USER_ID, type="private")
    msg = Message(message_id=uid, date=datetime.now(), chat=chat,
                  from_user=user, text=text).as_(bot)
    return Update(update_id=uid, message=msg)


def make_callback_update(uid, data, bot):
    user = TgUser(id=TEST_USER_ID, is_bot=False, first_name="Тестер")
    chat = Chat(id=TEST_USER_ID, type="private")
    bot_msg = Message(message_id=uid, date=datetime.now(), chat=chat,
                      from_user=TgUser(id=BOT_ID, is_bot=True, first_name="Bot"),
                      text="(keyboard)").as_(bot)
    cb = CallbackQuery(id=str(uid), from_user=user, chat_instance="ci",
                       message=bot_msg, data=data).as_(bot)
    return Update(update_id=uid, callback_query=cb)


# ---------------------------------------------------------------------------
# Harness driver
# ---------------------------------------------------------------------------
class Harness:
    def __init__(self, verbose=False):
        self.session = RecordingSession()
        self.bot = Bot(token=f"{BOT_ID}:TESTtoken_harness-0123456789ABCDEF",
                       session=self.session)
        self.dp = Dispatcher(storage=MemoryStorage())
        self.dp.include_router(router)
        self.errors = []
        self.all_errors = []
        self.verbose = verbose
        self._uid = 1000
        self._seen = 0

        @self.dp.errors()
        async def on_error(event):
            self.errors.append(event.exception)
            return True

    def reset_errors(self):
        self.all_errors = []

    async def send_text(self, text):
        return await self._feed(make_text_update(self._next(), text, self.bot), f"USER ▶ {text}")

    async def send_cb(self, data):
        return await self._feed(make_callback_update(self._next(), data, self.bot), f"TAP  ▶ {data}")

    def _next(self):
        self._uid += 1
        return self._uid

    async def _feed(self, update, label):
        self.errors.clear()
        await self.dp.feed_update(self.bot, update)
        self.all_errors.extend(self.errors)
        new = self.session.records[self._seen:]
        self._seen = len(self.session.records)
        replies = [d.get("text", "") for n, d in new if n == "SendMessage"]
        if self.verbose:
            print("=" * 64)
            print(label)
            for r in replies:
                print(f"BOT  ◀ {r[:300]}")
            if self.errors:
                print(f"!!! ERROR: {type(self.errors[0]).__name__}: {self.errors[0]}")
        return replies


def _answer_value(q):
    if q.qtype == "rating":
        return "4"
    if q.qtype == "choice":
        preferred = {"level": "club", "match_result": "even"}
        return preferred.get(q.id, q.options[0][0])
    if q.qtype == "number":
        return {"years": "5", "height": "182", "first_serve_pct": "62"}.get(q.id, "5")
    return "тест"


async def drive_funnel_questions(h: Harness, target_tier: int):
    """Answer the funnel question-by-question up to target_tier. Returns branch confidences."""
    boundaries = set(F.tier_start_indices().values())
    confidences = []
    i = 0
    total = F.total_questions()
    while i < total:
        if i in boundaries and i > 0:
            # a branch was shown after finishing the previous tier
            completed_tier = F.tier_of_index(i - 1)
            last = h.session.records[-1][1].get("text", "") if h.session.records else ""
            m = re.search(r"Уверенность: (\d+)%", last)
            if m:
                confidences.append(int(m.group(1)))
            if completed_tier >= target_tier:
                await h.send_cb("fb:stop")
                return confidences
            await h.send_cb("fb:deeper")
        q = F.get_question(i)
        value = _answer_value(q)
        if q.qtype in ("choice", "rating"):
            await h.send_cb(f"fa:{q.id}:{value}")
        else:
            await h.send_text(value)
        i += 1
    return confidences  # answered everything -> auto-finalized


async def drive_funnel(h: Harness, target_tier: int):
    """Full onboarding funnel: /start + name + questions up to target_tier."""
    get_player_file(TEST_USER_ID).unlink(missing_ok=True)
    await h.send_text("/start")
    await h.send_text("Тестер")
    return await drive_funnel_questions(h, target_tier)


async def drive_schedule(h: Harness, counts: dict):
    """After the funnel, answer the per-type weekly counts then tap 'done'."""
    for cat in SCHED_ORDER:
        await h.send_cb(f"sc:{cat}:{counts.get(cat, 0)}")
    await h.send_cb("sm:done")


def check(label, passed, results):
    results.append((label, passed))


def unit_checks(results):
    """Pure-function checks for the UTR and periodization engines (no dispatcher)."""
    # UTR anchor: 'club' band midpoint ~5.0, low confidence, wide range at tier 0
    e0 = U.estimate_utr({"level": "club"}, {}, [], 0)
    check("U: club tier0 ~5.0", 4.5 <= e0.value <= 5.5, results)
    check("U: tier0 confidence 25", e0.confidence == 25, results)

    # confidence monotonic with tier
    confs = [U.confidence_for(t, 6, 0) for t in (0, 1, 2, 3)]
    check("U: confidence monotonic by tier", confs == sorted(confs) and len(set(confs)) == 4, results)

    # range narrows as confidence rises
    e_lo = U.estimate_utr({"level": "club"}, {"forehand": 6}, [], 0)
    e_hi = U.estimate_utr({"level": "club"}, {d: 6 for d in U.DIMENSIONS}, [], 3)
    check("U: range narrows with depth", (e_hi.high - e_hi.low) < (e_lo.high - e_lo.low), results)

    # matches push value toward opponent and lift confidence
    matches = [{"opponent_utr": 8.0, "won": True, "games_won": 12, "games_lost": 6}] * 5
    em = U.estimate_utr({"level": "club"}, {d: 6 for d in U.DIMENSIONS}, matches, 2)
    check("U: matches lift confidence (>=90)", em.confidence >= 90, results)
    check("U: matches pull toward opponent", em.value > e_hi.value, results)

    # periodization
    prog = PER.build_program(5.0, 7.0, 12, weak_dims=["serve", "backhand", "movement"])
    check("P: 12 weeks", len(prog.weeks) == 12, results)
    check("P: phases ordered (Foundation first)", prog.weeks[0].phase == "Foundation", results)
    check("P: weak dim weighted highest", prog.weeks[0].focus[0] == "serve", results)
    check("P: retests scheduled", any(w.is_retest for w in prog.weeks), results)
    small = PER.build_program(5.0, 6.0, 4, weak_dims=["serve"])
    check("P: small program sums to weeks", len(small.weeks) == 4, results)

    # schedule builder
    from src import training_schedule as TS
    sess = TS.build_sessions_from_counts({"court": 3, "solo": 7, "gym": 2, "match": 1},
                                         weak_dims=["serve", "backhand"])
    courts = [s for s in sess if s["session_type"] == "court_session"]
    solos = [s for s in sess if s["location"] == "home"]
    check("S: 3 court sessions created", len(courts) == 3, results)
    check("S: solo=7 becomes daily", any(s["day_of_week"] is None for s in solos), results)
    check("S: weekly minutes > 0", TS.weekly_minutes_of(sess) > 0, results)
    check("S: court focus = weak dims", courts[0]["focus_areas"] == ["serve", "backhand"], results)


async def main():
    results = []

    print("\n##### UNIT CHECKS (engines) #####")
    unit_checks(results)

    h = Harness(verbose=True)

    # ---- Scenario A: lazy (tier 0 only) ----
    print("\n##### SCENARIO A: LAZY (tier 0) #####")
    h.reset_errors()
    await drive_funnel(h, target_tier=0)
    lazy = load_player(TEST_USER_ID)
    check("A: profile created", lazy is not None, results)
    if lazy:
        check("A: UTR value set", lazy.utr_value is not None, results)
        check("A: tier == 0", lazy.assessment_tier == 0, results)
        check("A: low confidence (<=40)", lazy.utr_confidence <= 40, results)
        check("A: wide range (>=2.0)", (lazy.utr_high - lazy.utr_low) >= 2.0, results)
    check("A: no errors", not h.all_errors, results)
    lazy_range = (lazy.utr_high - lazy.utr_low) if lazy else None
    # lazy still goes through the schedule step (picks nothing)
    await drive_schedule(h, {})

    # ---- Scenario B: deep (all tiers) ----
    print("\n##### SCENARIO B: DEEP (all tiers) #####")
    h.verbose = False
    h.reset_errors()
    confs = await drive_funnel(h, target_tier=3)
    deep = load_player(TEST_USER_ID)
    check("B: profile created", deep is not None, results)
    if deep:
        check("B: tier == 3", deep.assessment_tier == 3, results)
        check("B: all 11 dims rated", len(deep.skill_ratings) == 11, results)
        check("B: high confidence (>=82)", deep.utr_confidence >= 82, results)
        check("B: narrow range (< lazy)", (deep.utr_high - deep.utr_low) < lazy_range, results)
    check("B: branch confidences increasing", confs == sorted(confs) and len(confs) >= 2, results)
    check("B: no errors", not h.all_errors, results)
    print(f"  branch confidences seen: {confs}")

    # ---- Schedule capture (after funnel, before goal) ----
    print("\n##### SCHEDULE #####")
    h.reset_errors()
    await drive_schedule(h, {"court": 3, "solo": 4, "gym": 1, "match": 1})
    sched = load_player(TEST_USER_ID)
    check("F: sessions created", bool(sched and sched.training_sessions), results)
    if sched and sched.training_sessions:
        check("F: weekly minutes > 0", sched.weekly_training_minutes > 0, results)
        check("F: court focus = weak dims",
              any(s.session_type == "court_session" and s.focus_areas == sched.weaknesses[:2]
                  for s in sched.training_sessions), results)
    # add a custom session
    await h.send_text("/schedule_setup")
    await drive_schedule(h, {"court": 2, "solo": 2, "gym": 0, "match": 1})
    check("F: no errors (schedule)", not h.all_errors, results)

    # ---- Goal -> periodized program ----
    print("\n##### GOAL -> PROGRAM #####")
    h.reset_errors()
    await h.send_text("/goal")
    await h.send_text("7.0")
    await h.send_text("12")
    goaled = load_player(TEST_USER_ID)
    check("C: program built", bool(goaled and goaled.program), results)
    if goaled and goaled.program:
        check("C: target_utr == 7.0", goaled.target_utr == 7.0, results)
        check("C: program has 12 weeks", len(goaled.program.get("weeks", [])) == 12, results)
        check("C: program carries weekly minutes", goaled.program.get("weekly_minutes", 0) > 0, results)
    pr = await h.send_text("/program")
    check("C: /program responds", bool(pr), results)
    check("C: no errors in goal flow", not h.all_errors, results)

    # ---- Match logging -> UTR refine ----
    print("\n##### MATCH LOG #####")
    h.reset_errors()
    await h.send_text("/matchlog")
    await h.send_text("7.0")
    await h.send_cb("ml:won")
    await h.send_text("12-8")
    after = load_player(TEST_USER_ID)
    check("D: match recorded", after and len(after.match_results) == 1, results)
    if after:
        check("D: confidence >=80 after match", after.utr_confidence >= 80, results)
    check("D: no errors (matchlog)", not h.all_errors, results)

    # ---- Re-test (re-run funnel deep) ----
    print("\n##### RETEST #####")
    h.reset_errors()
    await h.send_text("/retest")
    await drive_funnel_questions(h, target_tier=3)
    rt = load_player(TEST_USER_ID)
    check("D: retest kept tier 3", rt and rt.assessment_tier == 3, results)
    check("D: program still present after retest", bool(rt and rt.program), results)
    check("D: no errors (retest)", not h.all_errors, results)

    # ---- Command coverage on the deep player ----
    print("\n##### COMMAND COVERAGE #####")
    h.reset_errors()
    silent = []
    for cmd in ["/profile", "/plan", "/schedule", "/videos", "/en", "/ru"]:
        replies = await h.send_text(cmd)
        if not replies:
            silent.append(cmd)
    check(f"commands respond (silent: {silent})", not silent, results)

    # ---- Summary ----
    print("\n" + "#" * 64)
    print("RESULT")
    print("#" * 64)
    ok = True
    for label, passed in results:
        print(f"  [{'PASS' if passed else 'FAIL'}] {label}")
        ok = ok and passed
    if deep:
        print(f"\n  Deep player UTR: {deep.utr_value} ({deep.utr_low}-{deep.utr_high}) "
              f"conf={deep.utr_confidence}%  tier={deep.assessment_tier}")
        print(f"  skill_ratings: {deep.skill_ratings}")
        print(f"  strengths={deep.strengths}  weaknesses={deep.weaknesses}  focus={deep.current_focus}")
    print("\n" + ("ALL GOOD ✅" if ok else "SOME CHECKS FAILED ❌"))
    await h.bot.session.close()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    asyncio.run(main())
