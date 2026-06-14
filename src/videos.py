"""
Tennis video library and recommendation engine.

Curated collection of high-quality instructional videos
organized by skill, focus area, and difficulty level.
"""

from typing import List, Optional
from pydantic import BaseModel


class Video(BaseModel):
    id: str
    title: str
    url: str
    channel: str
    duration_minutes: int
    focus_areas: List[str]  # e.g. ["split-step", "footwork"]
    level: str  # "beginner", "intermediate", "advanced"
    language: str  # "RU", "EN", "BOTH"
    description: str


# Curated video library
VIDEO_LIBRARY: List[Video] = [
    # Footwork & Movement
    Video(
        id="split_step_1",
        title="Perfect Split Step Technique",
        url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        channel="ATP Academy",
        duration_minutes=8,
        focus_areas=["split-step", "footwork"],
        level="beginner",
        language="EN",
        description="Learn the fundamental split step used by pro players."
    ),
    Video(
        id="shadow_swing_1",
        title="Shadow Swing Drills for Timing",
        url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        channel="Tennis with Sabine",
        duration_minutes=12,
        focus_areas=["shadow-swings", "footwork", "timing"],
        level="beginner",
        language="EN",
        description="Master shadow swings to improve stroke consistency."
    ),
    Video(
        id="footwork_1",
        title="Court Movement Essentials",
        url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        channel="CoachMark Tennis",
        duration_minutes=15,
        focus_areas=["footwork", "movement", "positioning"],
        level="intermediate",
        language="EN",
        description="Improve your court coverage with proper footwork patterns."
    ),

    # Backhand
    Video(
        id="backhand_1",
        title="One-Handed Backhand Fundamentals",
        url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        channel="Tennis Warehouse",
        duration_minutes=10,
        focus_areas=["backhand", "technique"],
        level="beginner",
        language="EN",
        description="Essential grip, stance, and swing path for one-handed backhand."
    ),
    Video(
        id="backhand_2",
        title="Two-Handed Backhand Drills",
        url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        channel="Tennis with Rick Macci",
        duration_minutes=14,
        focus_areas=["backhand", "technique", "drills"],
        level="intermediate",
        language="EN",
        description="Advanced drills for developing a powerful two-handed backhand."
    ),

    # Serve
    Video(
        id="serve_1",
        title="Serve Fundamentals: Grip and Stance",
        url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        channel="ATP Academy",
        duration_minutes=12,
        focus_areas=["serve", "grip", "stance"],
        level="beginner",
        language="EN",
        description="Master the basics of a reliable tennis serve."
    ),
    Video(
        id="serve_2",
        title="Serve Consistency Drills",
        url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        channel="Pro Tennis Tips",
        duration_minutes=18,
        focus_areas=["serve", "consistency", "drills"],
        level="intermediate",
        language="EN",
        description="Target-based drills to improve serve accuracy and consistency."
    ),

    # Russian content (example placeholders)
    Video(
        id="ru_footwork_1",
        title="Основы движения на теннисном корте",
        url="https://www.youtube.com/watch?v=placeholder",
        channel="Теннис с Иваном",
        duration_minutes=10,
        focus_areas=["footwork", "movement"],
        level="beginner",
        language="RU",
        description="Обучение базовым техникам передвижения."
    ),
    Video(
        id="ru_serve_1",
        title="Подача: Техника и Дрилы",
        url="https://www.youtube.com/watch?v=placeholder",
        channel="Теннис Про",
        duration_minutes=16,
        focus_areas=["serve", "technique"],
        level="beginner",
        language="RU",
        description="Разбор техники подачи с примерами дрилов."
    ),
]


def get_videos_for_focus(focus_area: str, language: str = "EN", level: str = None) -> List[Video]:
    """Get videos matching a specific focus area and language."""
    videos = [
        v for v in VIDEO_LIBRARY
        if focus_area.lower() in [f.lower() for f in v.focus_areas]
        and (language in [v.language, "BOTH"])
    ]

    # Filter by level if specified
    if level:
        videos = [v for v in videos if v.level == level]

    return videos


def get_video_by_id(video_id: str) -> Optional[Video]:
    """Get a specific video by ID."""
    for video in VIDEO_LIBRARY:
        if video.id == video_id:
            return video
    return None


def recommend_videos(
    focus_areas: List[str],
    language: str = "EN",
    level: str = "beginner",
    limit: int = 3
) -> List[Video]:
    """
    Recommend videos based on focus areas and player level.
    Returns up to 'limit' videos.
    """
    recommended = []
    seen_ids = set()

    # Prioritize exact level matches, then relax
    for current_level in [level, "intermediate", "advanced", "beginner"]:
        for focus in focus_areas:
            for video in get_videos_for_focus(focus, language, current_level):
                if video.id not in seen_ids:
                    recommended.append(video)
                    seen_ids.add(video.id)
                    if len(recommended) >= limit:
                        return recommended

    return recommended


def format_video_recommendations(videos: List[Video], language: str) -> str:
    """Format video recommendations as a readable message."""
    if not videos:
        return "No videos found for this focus area."

    if language == "RU":
        text = "📹 **Рекомендуемые видео:**\n\n"
        for i, video in enumerate(videos, 1):
            text += f"{i}. **{video.title}**\n"
            text += f"   Канал: {video.channel}\n"
            text += f"   ⏱️ {video.duration_minutes} мин\n"
            text += f"   🔗 {video.url}\n\n"
    else:
        text = "📹 **Recommended Videos:**\n\n"
        for i, video in enumerate(videos, 1):
            text += f"{i}. **{video.title}**\n"
            text += f"   Channel: {video.channel}\n"
            text += f"   ⏱️ {video.duration_minutes} min\n"
            text += f"   🔗 {video.url}\n\n"

    return text
