"""
Deterministic dashboard payload for the 3D web app — NO LLM calls, so it's instant.
English labels to match the Terminal Pro design (the app is English-first).
"""

from datetime import date
from typing import Optional

from .models import PlayerModel
from .utr import DIMENSIONS

DIM_LABELS = {
    "forehand": "FOREHAND", "backhand": "BACKHAND", "serve": "SERVE",
    "return": "RETURN", "volley": "VOLLEY", "movement": "MOVEMENT",
    "consistency": "CONSISTENCY", "power": "POWER", "tactics": "TACTICS",
    "mental": "MENTAL", "fitness": "FITNESS",
}

# Deterministic drill bank: dimension -> (terminal-style name, minutes).
DRILLS = {
    "forehand": ("FOREHAND CROSS", 20),
    "backhand": ("BACKHAND CROSS", 20),
    "serve": ("SERVE: TOSS + KICK", 20),
    "return": ("RETURN DIRECTIONS", 15),
    "volley": ("VOLLEY REACT", 15),
    "movement": ("SPLIT-STEP FOOTWORK", 15),
    "consistency": ("20-BALL RALLY", 15),
    "power": ("EXPLOSIVE SHORT BALL", 15),
    "tactics": ("PATTERN POINTS", 15),
    "mental": ("PRESSURE POINTS", 15),
    "fitness": ("INTERVALS / LADDER", 15),
}

WARMUP = ("WARMUP", 10)
GAME = ("LIVE POINTS", 15)
BAR_KEYS = ["forehand", "backhand", "serve", "movement", "consistency"]


def _weeks_left(target_date: Optional[str]) -> Optional[int]:
    if not target_date:
        return None
    try:
        return max(0, (date.fromisoformat(target_date) - date.today()).days // 7)
    except Exception:
        return None


def _focus_dims(player: PlayerModel) -> list:
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
        plan.append(DRILLS.get(d, ("TECHNIQUE WORK", 15)))
    plan.append(GAME)
    return [{"title": t, "minutes": m} for t, m in plan]


def _skill_bars(player: PlayerModel) -> list:
    ratings = player.skill_ratings or {}
    return [
        {"key": k, "label": DIM_LABELS[k], "v": round(ratings[k] / 10.0, 2), "raw": round(ratings[k], 1)}
        for k in BAR_KEYS
        if k in ratings
    ]


def build_dashboard(player: PlayerModel) -> dict:
    return {
        "name": player.name,
        "utr": {
            "value": player.utr_value,
            "confidence": player.utr_confidence,
            "target": player.target_utr,
            "weeks_left": _weeks_left(player.target_date),
            "focus": DIM_LABELS.get(player.current_focus, (player.current_focus or "").upper()),
        },
        "streak": player.streak,
        "weaknesses": [
            {"key": w, "label": DIM_LABELS.get(w, w.upper())} for w in player.weaknesses
        ],
        "skills": _skill_bars(player),
        "today_plan": _today_plan(player),
    }
