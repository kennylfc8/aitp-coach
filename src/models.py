from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class PhysicalInfo(BaseModel):
    height_cm: Optional[int] = None
    right_handed: bool = True
    two_handed_backhand: bool = False


class TrainingSession(BaseModel):
    """Custom training session"""
    id: str
    name: str
    day_of_week: Optional[str] = None
    time: str
    duration_minutes: int
    focus_areas: List[str] = []
    session_type: str = "solo"  # solo, court_session, match
    location: str = "court"


class PlayerModel(BaseModel):
    user_id: int
    name: str
    level: str  # beginner, intermediate, advanced, professional
    experience_years: int
    language: str = "RU"  # RU or EN
    strengths: List[str] = []
    weaknesses: List[str] = []
    goals: List[str] = []
    physical_info: PhysicalInfo = PhysicalInfo()
    current_focus: str = "split-step"

    # Raw assessment answers (keyed by question id)
    assessment: dict = {}

    # Custom training schedule
    training_sessions: List[TrainingSession] = []
    weekly_training_minutes: int = 0

    # UTR + adaptive assessment
    skill_ratings: dict = {}          # dimension -> 0..10
    utr_value: Optional[float] = None
    utr_low: Optional[float] = None
    utr_high: Optional[float] = None
    utr_confidence: int = 0           # 0..100
    assessment_tier: int = 0          # deepest funnel tier completed

    # Periodization toward a target UTR
    target_utr: Optional[float] = None
    target_date: Optional[str] = None  # YYYY-MM-DD
    match_results: List[dict] = []     # serialized MatchResult
    program: dict = {}                 # serialized PeriodizedProgram

    # Legacy (for backwards compatibility)
    daily_push_time_morning: str = "07:00"  # HH:MM
    daily_push_time_evening: str = "19:00"

    streak: int = 0
    voice_enabled: bool = True   # send coach voice notes (toggle with /voice)
    last_checkin: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


class CoachMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str
    timestamp: datetime


class DailyPlan(BaseModel):
    date: str  # YYYY-MM-DD
    focus: str
    drill: str
    video_url: Optional[str] = None
    estimated_time_minutes: int = 30


class UTREstimate(BaseModel):
    """Estimated Universal Tennis Rating with a confidence band."""
    value: float          # point estimate, 1.0..16.5
    low: float            # range lower bound
    high: float           # range upper bound
    confidence: int       # 0..100
    basis: dict = {}      # what contributed (level band, dims, matches, ...)


class MatchResult(BaseModel):
    """A logged match used to refine the UTR estimate over time."""
    date: str             # YYYY-MM-DD
    opponent_utr: Optional[float] = None
    won: bool = False
    games_won: int = 0
    games_lost: int = 0
    note: str = ""


class WeekPlan(BaseModel):
    """A single microcycle (one training week) inside the program."""
    week_number: int
    phase: str                     # Foundation / Development / Specialization / Peak / Taper
    focus: List[str] = []          # dimensions emphasized this week
    focus_weights: dict = {}       # dimension -> weight 0..1
    intensity: str = "moderate"    # low / moderate / high / peak / taper
    is_retest: bool = False
    note: str = ""


class PeriodizedProgram(BaseModel):
    """Macrocycle -> mesocycles (phases) -> microcycles (weeks)."""
    current_utr: float
    target_utr: float
    total_weeks: int
    start_date: str                # YYYY-MM-DD
    weekly_minutes: int = 0        # weekly training volume from the schedule
    phases: List[str] = []         # ordered phase names
    weeks: List[WeekPlan] = []
