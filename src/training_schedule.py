"""
Custom training schedule management.
Each player defines their own training structure, frequency, and preferences.
"""

from pydantic import BaseModel
from typing import Optional, List
from enum import Enum
from datetime import time


class TrainingSession(BaseModel):
    """Single training session in player's schedule"""
    id: str  # "morning_shadow", "evening_drills", "session_1", etc.
    name: str  # "Morning Shadow Swings", "Evening Drills", "Court Session 1"
    day_of_week: Optional[str] = None  # "Mon", "Tue", None for daily
    time: str  # "07:00" HH:MM
    duration_minutes: int  # 20, 45, 60, 120
    focus_areas: List[str]  # ["shadow-swings", "footwork"] or ["serve", "backhand"]
    session_type: str  # "solo", "court", "court_session", "match"
    location: str  # "home", "court", "wall"
    description: str  # User's description of what they do


class TrainingPreference(BaseModel):
    """Training preferences and structure"""
    sessions: List[TrainingSession] = []

    # Weekly summary
    weekly_training_minutes: int = 0
    court_sessions_per_week: int = 0
    solo_sessions_per_week: int = 0

    # Equipment
    has_court_access: bool = True
    has_wall: bool = True
    can_practice_solo: bool = True

    # Preferences
    prefer_morning: bool = True
    prefer_evening: bool = True

    # Equipment constraints
    equipment_available: List[str] = []  # ["balls", "net", "targets"]

    def calculate_weekly_minutes(self) -> int:
        """Calculate total weekly training minutes"""
        total = 0
        for session in self.sessions:
            if session.day_of_week:
                # Specific day
                total += session.duration_minutes
            else:
                # Daily
                total += session.duration_minutes * 7
        return total


class TrainingTemplate(BaseModel):
    """Pre-defined training templates for quick setup"""
    id: str
    name: str
    description: str
    sessions: List[TrainingSession]


# Template examples
TRAINING_TEMPLATES = {
    "casual": TrainingTemplate(
        id="casual",
        name="Casual Player (30 min/day)",
        description="Light daily practice + weekend matches",
        sessions=[
            TrainingSession(
                id="morning_warmup",
                name="Morning Warmup",
                day_of_week=None,  # Daily
                time="07:00",
                duration_minutes=30,
                focus_areas=["shadow-swings", "footwork"],
                session_type="solo",
                location="home",
                description="Daily 30 min shadow swings and footwork"
            ),
        ]
    ),

    "intermediate": TrainingTemplate(
        id="intermediate",
        name="Intermediate Player (2 hours/day + sessions)",
        description="Morning routine + evening court sessions",
        sessions=[
            TrainingSession(
                id="morning_routine",
                name="Morning Routine",
                day_of_week=None,  # Daily
                time="07:00",
                duration_minutes=20,
                focus_areas=["shadow-swings"],
                session_type="solo",
                location="home",
                description="20 min shadow swings"
            ),
            TrainingSession(
                id="evening_drills",
                name="Evening Drills",
                day_of_week=None,  # Daily
                time="19:00",
                duration_minutes=20,
                focus_areas=["footwork", "movement"],
                session_type="solo",
                location="home",
                description="20 min footwork drills"
            ),
            TrainingSession(
                id="court_monday",
                name="Court Session - Technique",
                day_of_week="Mon",
                time="18:00",
                duration_minutes=120,
                focus_areas=["forehand", "backhand", "serve"],
                session_type="court_session",
                location="court",
                description="2h court session - technique focus"
            ),
            TrainingSession(
                id="court_wednesday",
                name="Court Session - Drills & Match",
                day_of_week="Wed",
                time="18:00",
                duration_minutes=120,
                focus_areas=["drills", "match-simulation"],
                session_type="court_session",
                location="court",
                description="2h court session - drills and match situations"
            ),
            TrainingSession(
                id="weekend_match",
                name="Weekend Match/Game",
                day_of_week="Sat",
                time="10:00",
                duration_minutes=120,
                focus_areas=["match-play", "points"],
                session_type="match",
                location="court",
                description="2h match or friendly game"
            ),
        ]
    ),

    "serious": TrainingTemplate(
        id="serious",
        name="Serious Player (3-4 hours/day)",
        description="Complete daily routine + multiple court sessions",
        sessions=[
            TrainingSession(
                id="morning_warmup",
                name="Morning Warmup",
                day_of_week=None,
                time="06:30",
                duration_minutes=20,
                focus_areas=["shadow-swings", "stretching"],
                session_type="solo",
                location="home",
                description="20 min shadow swings"
            ),
            TrainingSession(
                id="morning_strength",
                name="Morning Strength",
                day_of_week=None,
                time="07:00",
                duration_minutes=30,
                focus_areas=["fitness", "strength"],
                session_type="solo",
                location="gym",
                description="30 min strength/conditioning"
            ),
            TrainingSession(
                id="afternoon_court",
                name="Afternoon Court Session",
                day_of_week="Mon",
                time="14:00",
                duration_minutes=150,
                focus_areas=["technique", "drills"],
                session_type="court_session",
                location="court",
                description="2.5h structured drills"
            ),
            TrainingSession(
                id="evening_court",
                name="Evening Match Practice",
                day_of_week="Wed",
                time="17:00",
                duration_minutes=150,
                focus_areas=["match-simulation", "tactics"],
                session_type="court_session",
                location="court",
                description="2.5h match play"
            ),
            TrainingSession(
                id="friday_session",
                name="Friday Specialization",
                day_of_week="Fri",
                time="15:00",
                duration_minutes=180,
                focus_areas=["weak-points", "high-intensity"],
                session_type="court_session",
                location="court",
                description="3h focused on weak points"
            ),
        ]
    ),
}


def get_template(template_id: str) -> Optional[TrainingTemplate]:
    """Get training template by ID"""
    return TRAINING_TEMPLATES.get(template_id)


def create_custom_schedule(sessions: List[dict]) -> TrainingPreference:
    """Create custom training schedule from user input"""
    parsed_sessions = []
    for session_data in sessions:
        session = TrainingSession(**session_data)
        parsed_sessions.append(session)

    pref = TrainingPreference(sessions=parsed_sessions)
    pref.weekly_training_minutes = pref.calculate_weekly_minutes()
    return pref


def format_schedule_summary(pref: TrainingPreference, language: str) -> str:
    """Format training schedule as readable text"""

    if language == "RU":
        summary = "📅 **ТВОЙ ГРАФИК ТРЕНИРОВОК**\n\n"

        for session in pref.sessions:
            if session.day_of_week:
                day_text = f"{session.day_of_week}"
            else:
                day_text = "Каждый день"

            summary += f"**{session.name}**\n"
            summary += f"  {day_text} в {session.time}\n"
            summary += f"  Время: {session.duration_minutes} минут\n"
            summary += f"  Место: {session.location}\n"
            summary += f"  Фокус: {', '.join(session.focus_areas)}\n"
            summary += f"  Описание: {session.description}\n\n"

        summary += f"**Итого в неделю:** {pref.weekly_training_minutes} минут\n"
        if pref.court_sessions_per_week:
            summary += f"**Сессии на корте:** {pref.court_sessions_per_week}/неделю\n"

    else:
        summary = "📅 **YOUR TRAINING SCHEDULE**\n\n"

        for session in pref.sessions:
            if session.day_of_week:
                day_text = f"{session.day_of_week}"
            else:
                day_text = "Every day"

            summary += f"**{session.name}**\n"
            summary += f"  {day_text} at {session.time}\n"
            summary += f"  Duration: {session.duration_minutes} min\n"
            summary += f"  Location: {session.location}\n"
            summary += f"  Focus: {', '.join(session.focus_areas)}\n"
            summary += f"  Description: {session.description}\n\n"

        summary += f"**Total per week:** {pref.weekly_training_minutes} minutes\n"
        if pref.court_sessions_per_week:
            summary += f"**Court sessions:** {pref.court_sessions_per_week}/week\n"

    return summary
