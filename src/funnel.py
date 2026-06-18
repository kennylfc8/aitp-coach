"""
Adaptive "funnel" assessment: general -> specific, opt-in depth.

The player answers tier 0 (3 quick questions) and is then offered to go deeper,
tier by tier. Each tier is a superset of the previous and adds detail that
narrows the UTR estimate and raises confidence. A lazy player can stop after
tier 0; a motivated one can grind all the way to tier 3 (~36 questions).

This module only defines the question bank + pure helpers. The bot drives the
flow (inline keyboards, FSM, branch prompts) and the UTR engine (utr.py) turns
the collected answers into an estimate.
"""

from dataclasses import dataclass, field
from typing import List, Optional

from .utr import confidence_for, DIMENSIONS

# rating answers are a 1..5 scale; mapped to 0..10 for skill_ratings
RATING_OPTIONS = [
    ("1", "1 — очень слабо"),
    ("2", "2 — слабо"),
    ("3", "3 — средне"),
    ("4", "4 — хорошо"),
    ("5", "5 — отлично"),
]


@dataclass
class FunnelQuestion:
    id: str
    tier: int
    text_ru: str
    qtype: str                       # choice | rating | number | text
    options: list = field(default_factory=list)  # [(value, label)] for choice
    dimension: Optional[str] = None  # skill dimension a rating feeds


def _rating(qid, tier, text, dimension):
    return FunnelQuestion(qid, tier, text, "rating", list(RATING_OPTIONS), dimension)


# ---------------------------------------------------------------------------
# Question bank (ordered by tier, then sequence)
# ---------------------------------------------------------------------------
FUNNEL_QUESTIONS: List[FunnelQuestion] = [
    # ---- Tier 0: Quick (3) -> rough UTR band ----
    FunnelQuestion("level", 0, "Какой у тебя уровень игры?", "choice", [
        ("beginner", "Новичок — только учусь"),
        ("recreational", "Любитель — катаю мяч, без соревнований"),
        ("club", "Клубный — уверенно держу розыгрыш"),
        ("strong_club", "Сильный клуб / лиги"),
        ("tournament", "Турнирный игрок"),
        ("open", "Открытый / студенческий уровень"),
        ("national", "Национальный / профи"),
    ]),
    FunnelQuestion("years", 0, "Сколько лет играешь в теннис? (число)", "number"),
    FunnelQuestion("match_result", 0, "Как обычно складываются твои матчи?", "choice", [
        ("mostly_lose", "Чаще проигрываю"),
        ("even", "Примерно 50/50"),
        ("mostly_win", "Чаще выигрываю"),
        ("dominate", "Уверенно доминирую"),
    ]),

    # ---- Tier 1: Standard (8) -> per-shot self ratings ----
    _rating("r_forehand", 1, "Оцени свой форхенд", "forehand"),
    _rating("r_backhand", 1, "Оцени свой бэкхенд", "backhand"),
    _rating("r_serve", 1, "Оцени свою подачу", "serve"),
    _rating("r_return", 1, "Оцени свой приём", "return"),
    _rating("r_volley", 1, "Оцени игру с лёта (волли)", "volley"),
    _rating("r_movement", 1, "Оцени своё передвижение по корту", "movement"),
    _rating("r_consistency", 1, "Оцени стабильность (мало невынужденных ошибок)", "consistency"),
    FunnelQuestion("match_freq", 1, "Как часто играешь матчи?", "choice", [
        ("rare", "Редко (реже раза в месяц)"),
        ("monthly", "1-2 раза в месяц"),
        ("weekly", "1-2 раза в неделю"),
        ("often", "3+ раза в неделю"),
    ]),

    # ---- Tier 2: Deep (12) -> technique, tactics, physical, mental ----
    _rating("r_power", 2, "Оцени мощь своих ударов", "power"),
    _rating("r_tactics", 2, "Оцени тактическое понимание игры", "tactics"),
    _rating("r_mental", 2, "Оцени психологическую устойчивость", "mental"),
    _rating("r_fitness", 2, "Оцени свою физподготовку", "fitness"),
    FunnelQuestion("fh_grip", 2, "Хват на форхенде?", "choice", [
        ("eastern", "Eastern"), ("semiwestern", "Semi-western"),
        ("western", "Western"), ("continental", "Continental"),
    ]),
    FunnelQuestion("bh_type", 2, "Какой бэкхенд?", "choice", [
        ("one", "Одноручный"), ("two", "Двуручный"),
        ("slice", "В основном слайс"), ("weak", "Слабо развит"),
    ]),
    FunnelQuestion("serve_spin", 2, "Владеешь разными подачами?", "choice", [
        ("flat_only", "Только плоская"),
        ("flat_slice", "Плоская + слайс"),
        ("all", "Плоская, слайс и кручёная (kick)"),
    ]),
    _rating("r_second_serve", 2, "Насколько надёжна вторая подача?", "serve"),
    FunnelQuestion("pressure", 2, "Как держишь важные очки?", "choice", [
        ("choke", "Зажимаюсь, теряю технику"),
        ("nervous", "Волнуюсь, но играю"),
        ("calm", "Спокоен, фокусируюсь"),
        ("thrive", "Люблю давление"),
    ]),
    FunnelQuestion("weakest", 2, "Какой удар самый слабый?", "choice", [
        ("forehand", "Форхенд"), ("backhand", "Бэкхенд"),
        ("serve", "Подача"), ("return", "Приём"),
        ("volley", "Волли"), ("movement", "Передвижение"),
    ]),
    FunnelQuestion("surface", 2, "На каком покрытии играешь чаще?", "choice", [
        ("hard", "Хард"), ("clay", "Грунт"),
        ("grass", "Трава"), ("mixed", "По-разному"),
    ]),
    _rating("r_net_game", 2, "Насколько уверен у сетки?", "volley"),

    # ---- Tier 3: Grind (13) -> granular detail + competitive history ----
    FunnelQuestion("first_serve_pct", 3, "Процент попадания первой подачи? (число)", "number"),
    FunnelQuestion("double_faults", 3, "Часто ли двойные ошибки?", "choice", [
        ("many", "Часто"), ("some", "Иногда"), ("rare", "Редко"),
    ]),
    _rating("r_splitstep", 3, "Оцени работу ног / разножку", "movement"),
    _rating("r_endurance", 3, "Оцени выносливость в долгих матчах", "fitness"),
    FunnelQuestion("tournament_level", 3, "На каком уровне играл турниры?", "choice", [
        ("none", "Не играл"), ("local", "Местные/клубные"),
        ("regional", "Региональные"), ("national", "Национальные"),
        ("international", "Международные"),
    ]),
    FunnelQuestion("pressure_record", 3, "Тай-брейки и решающие сеты обычно?", "choice", [
        ("lose", "Чаще проигрываю"), ("even", "50/50"), ("win", "Чаще выигрываю"),
    ]),
    _rating("r_adaptability", 3, "Умеешь менять тактику по ходу матча?", "tactics"),
    FunnelQuestion("height", 3, "Твой рост в см? (число)", "number"),
    FunnelQuestion("hand", 3, "Рабочая рука?", "choice", [
        ("right", "Правая"), ("left", "Левая"),
    ]),
    FunnelQuestion("train_hours", 3, "Сколько часов в неделю тренируешься?", "choice", [
        ("0_2", "0-2"), ("3_5", "3-5"), ("6_10", "6-10"), ("10plus", "10+"),
    ]),
    FunnelQuestion("goal_short", 3, "Цель на 3 месяца? (текст)", "text"),
    FunnelQuestion("goal_long", 3, "Цель на 1 год? (текст)", "text"),
    FunnelQuestion("self_desc", 3, "Опиши свою игру в паре предложений", "text"),
]

MAX_TIER = 3
TIER_NAMES = {0: "Быстрая", 1: "Стандарт", 2: "Глубокая", 3: "Полная"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def total_questions() -> int:
    return len(FUNNEL_QUESTIONS)


def get_question(index: int) -> Optional[FunnelQuestion]:
    if 0 <= index < len(FUNNEL_QUESTIONS):
        return FUNNEL_QUESTIONS[index]
    return None


def tier_start_indices() -> dict:
    """tier -> flat index of its first question."""
    starts = {}
    for i, q in enumerate(FUNNEL_QUESTIONS):
        starts.setdefault(q.tier, i)
    return starts


def tier_of_index(index: int) -> int:
    q = get_question(index)
    return q.tier if q else MAX_TIER


def is_tier_boundary(index: int) -> bool:
    """True if `index` is the first question of a new tier (and not the very start)."""
    return index > 0 and index in set(tier_start_indices().values())


def deepest_completed_tier(answered_count: int) -> int:
    """Highest tier fully answered given how many questions were answered."""
    starts = tier_start_indices()
    completed = 0
    for tier in sorted(starts):
        # tier is complete if we've answered up to the start of the next tier
        next_start = starts.get(tier + 1, total_questions())
        if answered_count >= next_start:
            completed = tier
        else:
            break
    return completed


def _dims_for_indices(upto_index: int) -> int:
    """How many distinct dimensions are covered by rating questions before upto_index."""
    dims = set()
    for q in FUNNEL_QUESTIONS[:upto_index]:
        if q.qtype == "rating" and q.dimension:
            dims.add(q.dimension)
    return len(dims)


def parse_answers(answers: dict) -> dict:
    """Convert rating answers (1..5) into skill_ratings (dimension -> 0..10, averaged)."""
    sums, counts = {}, {}
    for q in FUNNEL_QUESTIONS:
        if q.qtype == "rating" and q.dimension and q.id in answers:
            try:
                v = float(answers[q.id])
            except (TypeError, ValueError):
                continue
            score = max(0.0, min(10.0, v * 2.0))  # 1..5 -> 2..10
            sums[q.dimension] = sums.get(q.dimension, 0.0) + score
            counts[q.dimension] = counts.get(q.dimension, 0) + 1
    return {d: round(sums[d] / counts[d], 1) for d in sums}


def projected_confidence(next_tier: int) -> int:
    """Confidence the player would reach by completing `next_tier` (no matches yet)."""
    starts = tier_start_indices()
    upto = starts.get(next_tier + 1, total_questions())
    return confidence_for(next_tier, _dims_for_indices(upto), 0)


def progress_line(current_conf: int, next_tier: int) -> str:
    """Motivating one-liner shown at a branch point."""
    proj = projected_confidence(next_tier)
    starts = tier_start_indices()
    more = starts.get(next_tier + 1, total_questions()) - starts.get(next_tier, total_questions())
    name = TIER_NAMES.get(next_tier, "следующий блок")
    return (f"Ещё {more} вопросов («{name}») → точность вырастет "
            f"с {current_conf}% до ~{proj}%.")
