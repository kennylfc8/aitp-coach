from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class PhysicalInfo(BaseModel):
    height_cm: Optional[int] = None
    right_handed: bool = True
    two_handed_backhand: bool = False


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
    daily_push_time_morning: str = "07:00"  # HH:MM
    daily_push_time_evening: str = "19:00"
    streak: int = 0
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
