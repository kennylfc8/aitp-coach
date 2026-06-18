"""
Deterministic UTR (Universal Tennis Rating) estimation engine.

UTR runs 1.00–16.50 and is *officially* computed only from match results
(opponent rating + game score). We can't measure it from a questionnaire, but
we can produce a credible ESTIMATE with a confidence band that:
  - anchors on a self-rated level band (NTRP-equivalent),
  - refines within the band using per-shot skill ratings + competitive answers,
  - tightens (range shrinks, confidence rises) as the player answers deeper
    funnel tiers, and
  - blends toward a match-result-based estimate once matches are logged
    (the only way to reach the top "verified" confidence tier).

Everything here is pure Python so it stays stable, explainable and unit-testable.
All constants are intentionally explicit and easy to tune.
"""

from typing import Optional, List
from .models import UTREstimate

# The skill dimensions everything keys off (rated 0..10).
DIMENSIONS = [
    "forehand", "backhand", "serve", "return", "volley",
    "movement", "consistency", "power", "tactics", "mental", "fitness",
]

# Self-rated level -> UTR band (low, high). Approximate NTRP-equivalent anchors.
# Tunable: these are the single biggest lever on the estimate.
LEVEL_BANDS = {
    "new":          (1.0, 2.0),    # just starting, can't rally yet
    "beginner":     (1.5, 3.0),    # learning, short rallies
    "recreational": (2.5, 4.5),    # rallies fine, no real competition (NTRP ~2.5-3.0)
    "club":         (4.0, 6.0),    # solid club player (NTRP ~3.5)
    "strong_club":  (6.0, 8.0),    # strong club / local leagues (NTRP ~4.0)
    "tournament":   (8.0, 10.0),   # tournament player (NTRP ~4.5)
    "open":         (10.0, 12.0),  # open / college level (NTRP ~5.0)
    "national":     (12.0, 16.5),  # national / pro (NTRP 5.5+)
}
DEFAULT_BAND = (2.5, 8.0)  # used when self-rated level is unknown

# Competitive result self-report -> small nudge (UTR points).
RESULT_NUDGE = {
    "mostly_lose": -0.6,
    "even": 0.0,
    "mostly_win": 0.6,
    "dominate": 1.0,
}

# Confidence baseline by deepest funnel tier completed.
TIER_CONFIDENCE = {0: 25, 1: 50, 2: 72, 3: 82}

UTR_MIN, UTR_MAX = 1.0, 16.5


def _clamp(v: float, lo: float = UTR_MIN, hi: float = UTR_MAX) -> float:
    return max(lo, min(hi, v))


# --- Credibility caps: keep self-rating honest -----------------------------
# A questionnaire can be gamed (a beginner rating everything 5 -> UTR ~16).
# We cap the *questionnaire* estimate by objective-ish answers (years played,
# tournament history). Logged matches are objective evidence and override caps.
def _to_int(v) -> Optional[int]:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _experience_cap(years: Optional[int]) -> float:
    """Max plausible UTR from years played alone (deliberately generous)."""
    if years is None:
        return UTR_MAX
    if years < 1:
        return 3.5
    if years < 2:
        return 5.0
    if years < 4:
        return 7.0
    if years < 7:
        return 9.5
    if years < 11:
        return 12.0
    return UTR_MAX


# High UTR needs real competition; without it, cap the self-estimate.
TOURNAMENT_CAP = {
    "none": 7.5, "local": 9.5, "regional": 11.5,
    "national": UTR_MAX, "international": UTR_MAX,
}


def _credibility_cap(answers: dict) -> float:
    caps = [_experience_cap(_to_int(answers.get("years")))]
    tl = answers.get("tournament_level")
    if tl in TOURNAMENT_CAP:
        caps.append(TOURNAMENT_CAP[tl])
    return min(caps)


def confidence_for(tier: int, dims_answered: int, n_matches: int) -> int:
    """Confidence % from funnel depth + breadth + logged matches.

    Questionnaire alone caps around the low-80s; logged matches unlock the
    'verified' tier up to ~96%.
    """
    c = TIER_CONFIDENCE.get(tier, 25)
    # breadth bonus: a few points for covering more dimensions within a tier
    c += min(dims_answered, len(DIMENSIONS)) * 0.4
    # matches unlock the verified tier
    if n_matches >= 1:
        c = max(c, 80)
    if n_matches >= 3:
        c = max(c, 88)
    if n_matches >= 5:
        c = max(c, 93)
    c += min(n_matches, 5)
    return int(min(round(c), 96))


def _half_width(confidence: int) -> float:
    """Range half-width from confidence: 25% -> ~2.0, 96% -> ~0.3."""
    span = (confidence - 25) / (96 - 25)
    span = max(0.0, min(1.0, span))
    hw = 2.0 - span * (2.0 - 0.3)
    return round(max(0.3, hw), 2)


def _avg_ratings(skill_ratings: dict) -> Optional[float]:
    vals = [float(v) for k, v in (skill_ratings or {}).items()
            if k in DIMENSIONS and v is not None]
    return sum(vals) / len(vals) if vals else None


def _match_based(match_results: List[dict]) -> Optional[float]:
    """Estimate UTR purely from logged matches.

    Idea (UTR-like): winning ~50% of games vs an opponent ~= same level;
    >50% means above, <50% below. Each match contributes opp_utr + delta.
    """
    vals = []
    for m in match_results or []:
        opp = m.get("opponent_utr")
        if opp is None:
            continue
        gw, gl = int(m.get("games_won", 0)), int(m.get("games_lost", 0))
        total = gw + gl
        if total:
            ratio = gw / total
        else:
            ratio = 1.0 if m.get("won") else 0.0
        delta = (ratio - 0.5) * 4.0  # +/-2.0 UTR swing at the extremes
        vals.append(float(opp) + delta)
    return sum(vals) / len(vals) if vals else None


def estimate_utr(
    answers: dict,
    skill_ratings: dict,
    match_results: Optional[List[dict]] = None,
    tier: int = 0,
) -> UTREstimate:
    """Compute an estimated UTR with a confidence band.

    answers: raw funnel answers (expects optional keys 'level', 'match_result').
    skill_ratings: dimension -> 0..10.
    match_results: list of serialized MatchResult dicts.
    tier: deepest funnel tier completed (0..3).
    """
    answers = answers or {}
    skill_ratings = skill_ratings or {}
    match_results = match_results or []

    lo, hi = LEVEL_BANDS.get(answers.get("level"), DEFAULT_BAND)
    basis = {"band": [lo, hi]}

    # 1) Questionnaire estimate: position within the band by avg shot rating.
    avg = _avg_ratings(skill_ratings)
    if avg is not None:
        q_value = lo + (avg / 10.0) * (hi - lo)
        basis["avg_rating"] = round(avg, 2)
    else:
        q_value = (lo + hi) / 2.0

    # competitive self-report nudge
    nudge = RESULT_NUDGE.get(answers.get("match_result"), 0.0)
    q_value = _clamp(q_value + nudge)
    if nudge:
        basis["result_nudge"] = nudge

    # 1b) Credibility cap: self-rating can't exceed what experience/competition
    # supports (a beginner can't self-rate to UTR 16). Matches override below.
    cap = _credibility_cap(answers)
    if q_value > cap:
        basis["pre_cap_value"] = round(q_value, 2)
        basis["credibility_cap"] = cap
        q_value = cap

    # 2) Blend toward match-based estimate as matches accumulate.
    n_matches = len([m for m in match_results if m.get("opponent_utr") is not None])
    mb = _match_based(match_results)
    if mb is not None:
        w_match = min(0.30 + 0.15 * n_matches, 0.85)
        value = w_match * mb + (1 - w_match) * q_value
        basis["match_based"] = round(mb, 2)
        basis["match_weight"] = round(w_match, 2)
    else:
        value = q_value

    value = _clamp(value)

    # 3) Confidence + range.
    dims_answered = len([k for k in skill_ratings if k in DIMENSIONS])
    confidence = confidence_for(tier, dims_answered, n_matches)
    hw = _half_width(confidence)
    basis["dims_answered"] = dims_answered
    basis["n_matches"] = n_matches

    return UTREstimate(
        value=round(value, 2),
        low=round(_clamp(value - hw), 2),
        high=round(_clamp(value + hw), 2),
        confidence=confidence,
        basis=basis,
    )


def estimate_for_player(player) -> UTREstimate:
    """Convenience: estimate from a PlayerModel's stored state."""
    return estimate_utr(
        answers=player.assessment or {},
        skill_ratings=player.skill_ratings or {},
        match_results=player.match_results or [],
        tier=player.assessment_tier or 0,
    )


def refine_with_match(player, match: dict) -> UTREstimate:
    """Append a match result to the player and recompute the estimate."""
    player.match_results = (player.match_results or []) + [match]
    est = estimate_for_player(player)
    player.utr_value = est.value
    player.utr_low = est.low
    player.utr_high = est.high
    player.utr_confidence = est.confidence
    return est
