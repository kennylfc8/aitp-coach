"""
Live YouTube video recommendations via the YouTube Data API v3.

How it judges "good" (no public dislikes anymore, so we use):
  - trusted-channel whitelist (the strongest anti-trash signal),
  - engagement: views (log) + like/view ratio,
  - duration sanity (4–30 min => real lessons, not clickbait shorts or 2h lectures).

Needs a FREE Google API key (YouTube Data API v3, 10k units/day, no billing):
  set YOUTUBE_API_KEY in .env. Without it, recommend() returns None and the bot
  falls back to trusted-channel search links (always valid, never a dead link).
"""

import os
import re
import math
import urllib.parse
import aiohttp
from typing import Optional, List

# Reputable tennis-instruction channels (lowercased substrings of channelTitle).
TRUSTED = {
    # EN
    "intuitive tennis", "top tennis training", "essential tennis", "tennis oxygen",
    "playyourcourt", "online tennis instruction", "feel tennis", "tennis unleashed",
    "the tennis mentor", "perfect tennis", "my tennis hq", "tennis evolution",
    "fuzzy yellow balls", "ramey tennis", "patrick mouratoglou", "morgan tennis academy",
    # RU
    "секреты тенниса", "лаборатория тенниса", "tennis life", "школа большого тенниса",
    "академия тенниса",
}
TRUSTED_DISPLAY = [
    "Top Tennis Training", "Intuitive Tennis", "Essential Tennis", "Tennis Oxygen",
]

# focus dimension -> (RU query, EN query)
_Q = {
    "forehand": ("теннис форхенд техника", "tennis forehand technique"),
    "backhand": ("теннис бэкхенд техника", "tennis backhand technique"),
    "serve": ("теннис подача техника", "tennis serve technique"),
    "return": ("теннис приём подачи", "tennis return of serve"),
    "volley": ("теннис игра с лёта", "tennis volley technique"),
    "movement": ("теннис работа ног передвижение", "tennis footwork movement"),
    "footwork": ("теннис работа ног", "tennis footwork drills"),
    "split-step": ("теннис разножка", "tennis split step"),
    "consistency": ("теннис стабильность контроль мяча", "tennis consistency drills"),
    "power": ("теннис мощь ударов", "tennis power generation"),
    "tactics": ("теннис тактика стратегия", "tennis tactics strategy"),
    "mental": ("теннис психология настрой", "tennis mental game"),
    "fitness": ("теннис физподготовка", "tennis fitness training"),
    "shadow-swings": ("теннис имитация ударов", "tennis shadow swing drills"),
    "match-play": ("теннис игровые ситуации", "tennis match play drills"),
}


def _query_for(focus: str, language: str) -> str:
    ru, en = _Q.get(focus, (f"теннис {focus}", f"tennis {focus}"))
    if language == "RU":
        return f"большой {ru}"  # "большой теннис" = lawn tennis; junk filtered in Python below
    return f'{en} -"table tennis" -padel'


# Other racket sports leak into "теннис" searches — filter by substring (catches
# Russian inflections like настольн-ый/-ом/-ого that query "-" exclusions miss).
_OFFTOPIC = (
    "настольн", "пинг-понг", "пинг понг", "пингпонг", "ping pong", "pingpong",
    "table tennis", "tabletennis", "tt_", "падел", "padel", "сквош", "squash",
    "бадминтон", "badminton",
)


def _offtopic(v: dict) -> bool:
    s = (v.get("title", "") + " " + v.get("channel", "")).lower()
    return any(m in s for m in _OFFTOPIC)


# Title keywords per focus -> boost videos that are actually about that shot.
_REL = {
    "backhand": ("слева", "бэкхенд", "backhand"),
    "forehand": ("справа", "форхенд", "forehand"),
    "serve": ("подач", "serve"),
    "return": ("приём", "прием", "return"),
    "volley": ("лёт", "лета", "воллей", "volley"),
    "movement": ("ног", "передвиж", "footwork", "movement"),
    "footwork": ("ног", "передвиж", "footwork"),
    "split-step": ("разножк", "split"),
    "consistency": ("стабильн", "контрол", "consistency"),
    "power": ("мощн", "сила удар", "power"),
    "serve_consistency": ("подач", "serve"),
}


def _relevance(v: dict, focus: str) -> float:
    kws = _REL.get(focus)
    if not kws:
        return 0.0
    return 2.0 if any(k in v.get("title", "").lower() for k in kws) else 0.0


def _is_trusted(channel_title: str) -> bool:
    t = (channel_title or "").lower()
    return any(name in t for name in TRUSTED)


def _iso_min(iso: str) -> int:
    """PT1H2M30S -> minutes (rounded)."""
    m = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso or "")
    if not m:
        return 0
    h, mi, s = (int(x) if x else 0 for x in m.groups())
    return round(h * 60 + mi + s / 60)


def _score(v: dict) -> float:
    s = math.log10(max(v["views"], 10))
    if v["views"]:
        s += (v["likes"] / v["views"]) * 8
    if v["trusted"]:
        s += 3
    s += 1 if 4 <= v["duration_min"] <= 30 else -2
    return s


async def _api_get(session, url, params):
    async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=20)) as r:
        if r.status != 200:
            print(f"[YT] {url} -> {r.status}: {(await r.text())[:160]}")
            return None
        return await r.json()


async def search(query: str, language: str = "EN", limit: int = 15) -> Optional[List[dict]]:
    """Search + fetch stats. Returns list of video dicts, or None if no key / API error."""
    key = os.getenv("YOUTUBE_API_KEY")
    if not key:
        return None
    async with aiohttp.ClientSession() as s:
        sr = await _api_get(s, "https://www.googleapis.com/youtube/v3/search", {
            "part": "snippet", "q": query, "type": "video", "maxResults": str(min(limit, 25)),
            "order": "relevance", "relevanceLanguage": "ru" if language == "RU" else "en",
            "videoEmbeddable": "true", "key": key,
        })
        if sr is None:
            return None
        ids = [it["id"]["videoId"] for it in sr.get("items", []) if it.get("id", {}).get("videoId")]
        if not ids:
            return []
        vr = await _api_get(s, "https://www.googleapis.com/youtube/v3/videos", {
            "part": "statistics,contentDetails,snippet", "id": ",".join(ids), "key": key,
        })
        if vr is None:
            return None
        out = []
        for it in vr.get("items", []):
            st, cd, sn = it.get("statistics", {}), it.get("contentDetails", {}), it.get("snippet", {})
            ch = sn.get("channelTitle", "")
            out.append({
                "title": sn.get("title", ""),
                "channel": ch,
                "url": f"https://www.youtube.com/watch?v={it['id']}",
                "views": int(st.get("viewCount", 0) or 0),
                "likes": int(st.get("likeCount", 0) or 0),
                "duration_min": _iso_min(cd.get("duration", "PT0S")),
                "trusted": _is_trusted(ch),
            })
        return out


async def recommend(focus_areas, language: str = "EN", level: str = "intermediate",
                    limit: int = 5) -> Optional[List[dict]]:
    """Top videos for the player's primary focus. None => no key/error (use fallback_links)."""
    primary = (list(focus_areas) or ["tennis"])[0]
    vids = await search(_query_for(primary, language), language, 20)
    if vids is None:
        return None
    # drop other racket sports, shorts (<3 min), and obscure clips
    vids = [v for v in vids
            if not _offtopic(v)
            and v["duration_min"] >= 3
            and (v["trusted"] or v["views"] >= 5000)]
    vids.sort(key=lambda v: _score(v) + _relevance(v, primary), reverse=True)
    return vids[:limit]


def fallback_links(focus_areas, language: str = "EN", limit: int = 4) -> List[dict]:
    """Always-valid YouTube search links on trusted channels (used when no API key)."""
    primary = (list(focus_areas) or ["tennis"])[0]
    q = _query_for(primary, language)
    base = "https://www.youtube.com/results?search_query="
    out = []
    for ch in TRUSTED_DISPLAY[:limit]:
        out.append({
            "title": (f"{primary}: поиск на {ch}" if language == "RU" else f"{primary}: search on {ch}"),
            "channel": ch,
            "url": base + urllib.parse.quote(f"{q} {ch}"),
            "views": 0, "likes": 0, "duration_min": 0, "trusted": True,
        })
    return out


def _human(n: int) -> str:
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n/1_000:.0f}K"
    return str(n)


def format_videos(videos, language: str) -> str:
    if not videos:
        return "Видео не найдено." if language == "RU" else "No videos found."
    head = "📹 Видео по твоей теме:" if language == "RU" else "📹 Videos for your focus:"
    lines = [head, ""]
    for i, v in enumerate(videos, 1):
        meta = []
        if v.get("views"):
            meta.append(f"{_human(v['views'])} " + ("просмотров" if language == "RU" else "views"))
        if v.get("duration_min"):
            meta.append(f"{v['duration_min']} " + ("мин" if language == "RU" else "min"))
        if v.get("trusted"):
            meta.append("✅")
        meta_txt = (" · " + " · ".join(meta)) if meta else ""
        lines.append(f"{i}. {v['title']}\n   {v['channel']}{meta_txt}\n   {v['url']}")
    return "\n".join(lines)
