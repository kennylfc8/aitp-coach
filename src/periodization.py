"""
Periodization engine: turn (current UTR, target UTR, weeks, weak dimensions)
into a macrocycle -> mesocycles (phases) -> microcycles (weekly plans).

Pure Python and deterministic so it stays unit-testable. The daily plan
generator (coach_brain / plan_generator) sits *below* this: it asks the program
"what should this week emphasize?" and builds session content accordingly.
"""

from datetime import date, timedelta
from typing import List, Optional, Union

from .models import PeriodizedProgram, WeekPlan

# Mesocycle phases in order, with their training intensity.
PHASES = ["Foundation", "Development", "Specialization", "Peak", "Taper"]
PHASE_INTENSITY = {
    "Foundation": "low",
    "Development": "moderate",
    "Specialization": "high",
    "Peak": "peak",
    "Taper": "taper",
}
PHASE_RU = {
    "Foundation": "База",
    "Development": "Развитие",
    "Specialization": "Специализация",
    "Peak": "Пик",
    "Taper": "Подводка",
}
PHASE_NOTE_RU = {
    "Foundation": "Техника и объём, низкая интенсивность, закладываем фундамент.",
    "Development": "Растим качество ударов и стабильность, средняя интенсивность.",
    "Specialization": "Высокая интенсивность, добиваем слабые зоны, игровые ситуации.",
    "Peak": "Соревновательная фаза: тактика, матчи, психология.",
    "Taper": "Снижаем объём, держим тонус, восстановление перед целью.",
}

DEFAULT_WEAK_DIMS = ["consistency", "serve", "movement"]


def _normalize(weights: dict) -> dict:
    total = sum(weights.values()) or 1.0
    return {k: round(v / total, 2) for k, v in weights.items()}


def _split_phases(weeks: int) -> dict:
    """Distribute `weeks` across phases (largest-remainder, always sums to weeks)."""
    props = [("Foundation", 0.25), ("Development", 0.35),
             ("Specialization", 0.25), ("Peak", 0.10), ("Taper", 0.05)]
    raw = {p: weeks * pr for p, pr in props}
    counts = {p: int(v) for p, v in raw.items()}
    rem = weeks - sum(counts.values())
    fracs = sorted(((raw[p] - counts[p], p) for p, _ in props), reverse=True)
    k = 0
    while rem > 0:
        counts[fracs[k % len(fracs)][1]] += 1
        rem -= 1
        k += 1
    return counts


def _focus_for_phase(phase: str, weak_dims: List[str]):
    """Return (focus list, focus_weights) for a phase given the weakest dimensions."""
    top = (weak_dims or DEFAULT_WEAK_DIMS)[:3]
    if phase in ("Peak", "Taper"):
        anchor = top[0] if top else "consistency"
        focus = ["tactics", "mental", anchor]
        return focus, _normalize({"tactics": 0.4, "mental": 0.3, anchor: 0.3})

    base_w = [0.5, 0.3, 0.2] if phase in ("Foundation", "Development") else [0.45, 0.3, 0.25]
    weights = {d: w for d, w in zip(top, base_w)}
    return list(top), _normalize(weights)


def build_program(
    current_utr: float,
    target_utr: float,
    weeks: int,
    weak_dims: Optional[List[str]] = None,
    retest_every: int = 3,
    start_date: Optional[str] = None,
    weekly_minutes: int = 0,
) -> PeriodizedProgram:
    weeks = max(1, int(weeks))
    start = start_date or date.today().isoformat()
    weak_dims = weak_dims or DEFAULT_WEAK_DIMS

    phase_counts = _split_phases(weeks)
    week_phases: List[str] = []
    for ph in PHASES:
        week_phases += [ph] * phase_counts.get(ph, 0)
    # safety: pad to length (shouldn't trigger, largest-remainder sums exactly)
    week_phases = (week_phases + [PHASES[1]] * weeks)[:weeks]

    weeks_list = []
    for i in range(weeks):
        ph = week_phases[i]
        focus, weights = _focus_for_phase(ph, weak_dims)
        weeks_list.append(WeekPlan(
            week_number=i + 1,
            phase=ph,
            focus=focus,
            focus_weights=weights,
            intensity=PHASE_INTENSITY[ph],
            is_retest=((i + 1) % retest_every == 0 and ph != "Taper"),
            note=PHASE_NOTE_RU.get(ph, ""),
        ))

    return PeriodizedProgram(
        current_utr=current_utr,
        target_utr=target_utr,
        total_weeks=weeks,
        start_date=start,
        weekly_minutes=weekly_minutes,
        phases=PHASES,
        weeks=weeks_list,
    )


def _as_program(program: Union[PeriodizedProgram, dict]) -> PeriodizedProgram:
    if isinstance(program, PeriodizedProgram):
        return program
    return PeriodizedProgram(**program)


def current_week_focus(program: Union[PeriodizedProgram, dict],
                       today: Optional[date] = None) -> Optional[WeekPlan]:
    """Which WeekPlan applies right now, based on start_date."""
    prog = _as_program(program)
    if not prog.weeks:
        return None
    today = today or date.today()
    try:
        start = date.fromisoformat(prog.start_date)
    except (ValueError, TypeError):
        start = today
    wk_index = max(0, (today - start).days // 7)
    wk_index = min(wk_index, len(prog.weeks) - 1)
    return prog.weeks[wk_index]


def apply_retest(program: Union[PeriodizedProgram, dict],
                 new_utr: float,
                 new_weak_dims: Optional[List[str]] = None,
                 today: Optional[date] = None) -> PeriodizedProgram:
    """Update current UTR and (optionally) re-target the remaining weeks' focus."""
    prog = _as_program(program)
    prog.current_utr = new_utr
    if new_weak_dims:
        cur = current_week_focus(prog, today)
        cur_n = cur.week_number if cur else 1
        for wk in prog.weeks:
            if wk.week_number >= cur_n:
                wk.focus, wk.focus_weights = _focus_for_phase(wk.phase, new_weak_dims)
    return prog


def describe_week(wk: WeekPlan) -> str:
    """One-line RU context for a week (used to steer the daily plan generator)."""
    phase_ru = PHASE_RU.get(wk.phase, wk.phase)
    focus = ", ".join(wk.focus) if wk.focus else "общая работа"
    return (f"Неделя {wk.week_number} — фаза «{phase_ru}» (интенсивность: {wk.intensity}). "
            f"Приоритет: {focus}. {wk.note}")


def format_program(program: Union[PeriodizedProgram, dict], language: str = "RU") -> str:
    """Readable summary of the whole macrocycle for /program."""
    prog = _as_program(program)
    cur = current_week_focus(prog)

    lines = [
        f"🎯 ПРОГРАММА: UTR {prog.current_utr} → {prog.target_utr} за {prog.total_weeks} нед.",
    ]
    if prog.weekly_minutes:
        hrs = round(prog.weekly_minutes / 60, 1)
        lines.append(f"📦 Объём: ~{prog.weekly_minutes} мин/нед (~{hrs} ч)")
    lines.append("")
    if cur:
        lines.append(f"📍 Сейчас: {describe_week(cur)}")
        lines.append("")

    # group weeks by phase for a compact macro view
    seen = []
    for wk in prog.weeks:
        if wk.phase not in [p for p, _ in seen]:
            seen.append((wk.phase, wk.week_number))
    lines.append("Фазы:")
    for ph, start_wk in seen:
        ph_weeks = [w for w in prog.weeks if w.phase == ph]
        last = ph_weeks[-1].week_number
        rng = f"{start_wk}" if start_wk == last else f"{start_wk}-{last}"
        lines.append(f"  • {PHASE_RU.get(ph, ph)} (нед. {rng}) — {PHASE_NOTE_RU.get(ph, '')}")

    retests = [w.week_number for w in prog.weeks if w.is_retest]
    if retests:
        lines.append("")
        lines.append(f"🔁 Ре-тесты на неделях: {', '.join(map(str, retests))} "
                     "(обновим UTR и перебалансируем план).")
    return "\n".join(lines)
