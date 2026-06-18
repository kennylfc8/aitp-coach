import json
import os
from pathlib import Path
from typing import Optional
from datetime import datetime
from .models import PlayerModel, PhysicalInfo


DATA_DIR = Path(__file__).parent.parent / "data"
PLAYERS_DIR = DATA_DIR / "players"


def ensure_dirs():
    PLAYERS_DIR.mkdir(parents=True, exist_ok=True)


def get_player_file(user_id: int) -> Path:
    return PLAYERS_DIR / f"{user_id}.json"


def load_player(user_id: int) -> Optional[PlayerModel]:
    """Load player model from JSON file."""
    ensure_dirs()
    file_path = get_player_file(user_id)
    if file_path.exists():
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return PlayerModel(**data)
    return None


def save_player(player: PlayerModel) -> None:
    """Save player model to JSON file."""
    ensure_dirs()
    file_path = get_player_file(player.user_id)
    player.updated_at = datetime.now()
    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(player.model_dump(), f, default=str, indent=2, ensure_ascii=False)


def create_player(
    user_id: int,
    name: str,
    level: str,
    experience_years: int,
    assessment_data: Optional[dict] = None,
) -> PlayerModel:
    """Create new player model.

    assessment_data (optional) may contain mapped fields:
    strengths, weaknesses, goals, height_cm, two_handed_backhand, raw.
    """
    assessment_data = assessment_data or {}

    physical = PhysicalInfo(
        height_cm=assessment_data.get("height_cm"),
        two_handed_backhand=assessment_data.get("two_handed_backhand", False),
    )
    weaknesses = assessment_data.get("weaknesses", [])

    player = PlayerModel(
        user_id=user_id,
        name=name,
        level=level,
        experience_years=experience_years,
        strengths=assessment_data.get("strengths", []),
        weaknesses=weaknesses,
        goals=assessment_data.get("goals", []),
        physical_info=physical,
        current_focus=weaknesses[0] if weaknesses else "split-step",
        assessment=assessment_data.get("raw", {}),
        created_at=datetime.now(),
        updated_at=datetime.now(),
    )
    save_player(player)
    return player
