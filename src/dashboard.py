"""
Deterministic dashboard payload for the 3D web app — NO LLM calls, so it's instant.

The web right-panel (UTR, today's plan, weak zones, progress bars) is assembled here
straight from the PlayerModel + a static drill bank keyed by skill dimension. The heavy,
Claude-generated session plan (plan_generator.generate_session_plan) is intentionally NOT
used here — that's for the detailed per-session view, not the at-a-glance dashboard.
"""

from datetime import date
from typing import Optional

from .models import PlayerModel
from .utr import DIMENSIONS

DIM_LABELS_RU = {
    "forehand": "Форхенд", "backhand": "Бэкхенд", "serve": "Подача",
    "return": "Приём", "volley": "Волли", "movement": "Передвижение",
    "consistency": "Стабильность", "power": "Мощность", "tactics": "Тактика",
    "mental": "Психология", "fitness": "Физика",
}

# Deterministic drill bank: dimension -> first drill is used for that focus.
DRILLS = {
    "forehand": ("Форхенд кросс по корзине", 20),
    "backhand": ("Бэкхенд кросс (корзина)", 20),
    "serve": ("Подача: подброс + кик", 20),
    "return": ("Приём по направлениям", 15),
    "volley": ("Волли у сетки (реакция)", 15),
    "movement": ("Разножка + подход к мячу", 15),
    "consistency": ("20 мячей в рал без ошибки", 15),
    "power": ("Ускорение по короткому мячу", 15),
    "tactics": ("Игровые очки со схемой", 15),
    "mental": ("Очки под давлением (на счёт)", 15),
    "fitness": ("Интервалы / лесенка", 15),
}

WARMUP = ("Разминка + суставная", 10)
GAME = ("Игровые очки", 15)

# Stable subset shown as progress bars (only those the player has ratings for show up).
BAR_KEYS = ["forehand", "backhand", "serve", "movement", "consistency"]


def _weeks_left(target_date: Optional[str]) -> Optional[int]:
    if not target_date:
        return None
    try:
        return max(0, (date.fromisoformat(target_date) - date.today()).days // 7)
    except Exception:
        return None


def _focus_dims(player: PlayerModel) -> list:
    """Today's focus order: current_focus, then weaknesses, then lowest-rated dims."""
    order = []
    for d in [player.current_focus, *player.weaknesses]:
        if d in DIMENSIONS and d not in order:
            order.append(d)
    for d, _ in sorted((player.skill_ratings or {}).items(), key=lambda kv: kv[1]):
        if d in DIMENSIONS and d not in order:
            order.append(d)
    return order or ["movement", "consistency"]


def _today_plan(player: PlayerModel) -> list:
    plan = [WARMUP]
    for d in _focus_dims(player)[:3]:
        plan.append(DRILLS.get(d, ("Отработка техники", 15)))
    plan.append(GAME)
    return [{"title": t, "minutes": m} for t, m in plan]


def _skill_bars(player: PlayerModel) -> list:
    ratings = player.skill_ratings or {}
    return [
        {"key": k, "label": DIM_LABELS_RU[k], "v": round(ratings[k] / 10.0, 2)}
        for k in BAR_KEYS
        if k in ratings
    ]


def build_dashboard(player: PlayerModel) -> dict:
    """Everything the web right-panel needs, in one fast, deterministic payload."""
    return {
        "name": player.name,
        "utr": {
            "value": player.utr_value,
            "confidence": player.utr_confidence,
            "target": player.target_utr,
            "weeks_left": _weeks_left(player.target_date),
        },
        "streak": player.streak,
        "weaknesses": [
            {"key": w, "label": DIM_LABELS_RU.get(w, w)} for w in player.weaknesses
        ],
        "skills": _skill_bars(player),
        "today_plan": _today_plan(player),
    }
