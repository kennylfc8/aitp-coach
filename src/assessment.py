"""
Comprehensive player assessment questionnaire.
Gathers detailed information about technique, strengths, weaknesses, goals.
"""

from pydantic import BaseModel
from typing import Optional, List
from enum import Enum


class AssessmentQuestion(BaseModel):
    id: str
    question_ru: str
    question_en: str
    question_type: str  # "choice", "text", "scale", "multiselect"
    options_ru: Optional[List[str]] = None
    options_en: Optional[List[str]] = None


# Comprehensive assessment questionnaire
ASSESSMENT_QUESTIONS = [
    # Basic info
    AssessmentQuestion(
        id="age",
        question_ru="Сколько тебе лет?",
        question_en="How old are you?",
        question_type="text"
    ),
    AssessmentQuestion(
        id="height",
        question_ru="Твой рост (см)?",
        question_en="Your height (cm)?",
        question_type="text"
    ),

    # Playing style
    AssessmentQuestion(
        id="playing_style",
        question_ru="Какой у тебя стиль игры?",
        question_en="What's your playing style?",
        question_type="choice",
        options_ru=["Агрессивный (атакую с базовой линии)", "Защитный (жду ошибку)", "Всёрoundер", "Серве-воллей", "Не знаю"],
        options_en=["Aggressive (baseliners)", "Defensive (wait for errors)", "All-rounder", "Serve-volley", "Not sure"]
    ),

    # Grip
    AssessmentQuestion(
        id="forehand_grip",
        question_ru="Хват на forehand?",
        question_en="Forehand grip?",
        question_type="choice",
        options_ru=["Eastern", "Semi-western", "Western", "Continental"],
        options_en=["Eastern", "Semi-western", "Western", "Continental"]
    ),
    AssessmentQuestion(
        id="backhand_type",
        question_ru="Какой backhand?",
        question_en="Backhand type?",
        question_type="choice",
        options_ru=["Одноручный", "Двуручный", "Оба", "Не развит"],
        options_en=["One-handed", "Two-handed", "Both", "Underdeveloped"]
    ),

    # Strengths (multi-select)
    AssessmentQuestion(
        id="strengths",
        question_ru="Твои сильные стороны? (выбери несколько)",
        question_en="Your strengths? (select multiple)",
        question_type="multiselect",
        options_ru=["Forehand", "Backhand", "Подача", "Волли", "Движение", "Реакция", "Психология", "Выносливость"],
        options_en=["Forehand", "Backhand", "Serve", "Volley", "Movement", "Reaction", "Mental", "Endurance"]
    ),

    # Weaknesses (multi-select)
    AssessmentQuestion(
        id="weaknesses",
        question_ru="Что нужно улучшать? (выбери несколько)",
        question_en="What needs improvement? (select multiple)",
        question_type="multiselect",
        options_ru=["Forehand", "Backhand", "Подача", "Волли", "Разножка", "Отвод ноги", "Первый удар", "Консистенция"],
        options_en=["Forehand", "Backhand", "Serve", "Volley", "Split-step", "Footwork", "First strike", "Consistency"]
    ),

    # Serve quality
    AssessmentQuestion(
        id="serve_speed",
        question_ru="Скорость первой подачи (км/ч)? Если не знаешь - угадай",
        question_en="First serve speed (km/h)? Guess if unsure",
        question_type="text"
    ),
    AssessmentQuestion(
        id="serve_consistency",
        question_ru="% первых подач в коробку (примерно)?",
        question_en="% first serves in? (approximately)",
        question_type="choice",
        options_ru=["50% или меньше", "50-60%", "60-70%", "70-80%", "80%+"],
        options_en=["50% or less", "50-60%", "60-70%", "70-80%", "80%+"]
    ),

    # Match experience
    AssessmentQuestion(
        id="match_frequency",
        question_ru="Как часто ты играешь матчи?",
        question_en="How often do you play matches?",
        question_type="choice",
        options_ru=["Редко (реже 1 раза в месяц)", "Иногда (1-2 раза в месяц)", "Регулярно (1-2 раза в неделю)", "Часто (3+ раза в неделю)"],
        options_en=["Rarely (<1x/month)", "Sometimes (1-2x/month)", "Regular (1-2x/week)", "Frequent (3+x/week)"]
    ),
    AssessmentQuestion(
        id="pressure_handling",
        question_ru="Как ты держишь давление в важных моментах?",
        question_en="How do you handle pressure points?",
        question_type="choice",
        options_ru=["Срываюсь (теряю техику)", "Волнуюсь (но держу)", "Спокоен (могу сосредоточиться)", "Люблю давление"],
        options_en=["Choke (lose technique)", "Anxious (but hold)", "Calm (can focus)", "Thrive on pressure"]
    ),

    # Goals
    AssessmentQuestion(
        id="goals_short",
        question_ru="Цель на 3 месяца?",
        question_en="Goal for 3 months?",
        question_type="text"
    ),
    AssessmentQuestion(
        id="goals_long",
        question_ru="Цель на 1 год?",
        question_en="Goal for 1 year?",
        question_type="text"
    ),

    # Injuries
    AssessmentQuestion(
        id="injuries",
        question_ru="Есть ли травмы или проблемы с суставами?",
        question_en="Any injuries or joint issues?",
        question_type="text"
    ),

    # Training preferences
    AssessmentQuestion(
        id="training_time",
        question_ru="Сколько времени ты можешь уделять тренировкам в день?",
        question_en="How much time can you dedicate daily?",
        question_type="choice",
        options_ru=["30 минут", "45 минут", "60 минут", "90 минут", "2+ часа"],
        options_en=["30 min", "45 min", "60 min", "90 min", "2+ hours"]
    ),

    # Court type
    AssessmentQuestion(
        id="court_surface",
        question_ru="На каком покрытии ты обычно играешь?",
        question_en="What court surface do you usually play?",
        question_type="choice",
        options_ru=["Хард", "Клей", "Грунт", "Трава", "Микс"],
        options_en=["Hard", "Clay", "Dirt", "Grass", "Mixed"]
    ),

    # Self-assessment
    AssessmentQuestion(
        id="self_assessment",
        question_ru="Опиши свою игру в 3-4 предложениях",
        question_en="Describe your game in 3-4 sentences",
        question_type="text"
    ),
]


class DetailedPlayerAssessment(BaseModel):
    """Detailed assessment results"""
    age: Optional[int] = None
    height_cm: Optional[int] = None
    playing_style: str = ""
    forehand_grip: str = ""
    backhand_type: str = ""
    strengths: List[str] = []
    weaknesses: List[str] = []
    serve_speed_kmh: Optional[int] = None
    serve_consistency: str = ""
    match_frequency: str = ""
    pressure_handling: str = ""
    goal_3months: str = ""
    goal_1year: str = ""
    injuries: str = ""
    training_time: str = ""
    court_surface: str = ""
    self_assessment: str = ""


def format_assessment_summary(assessment: DetailedPlayerAssessment, language: str) -> str:
    """Format assessment into readable summary"""

    if language == "RU":
        summary = f"""
📋 **ДИАГНОСТИКА**

**Физика:**
- Возраст: {assessment.age or '—'} лет
- Рост: {assessment.height_cm or '—'} см

**Техника:**
- Стиль: {assessment.playing_style}
- Forehand: {assessment.forehand_grip}
- Backhand: {assessment.backhand_type}
- Подача: {assessment.serve_speed_kmh or '?'} км/ч ({assessment.serve_consistency})

**Сильные стороны:**
{', '.join(assessment.strengths) if assessment.strengths else '—'}

**Что нужно работать:**
{', '.join(assessment.weaknesses) if assessment.weaknesses else '—'}

**Матчи:**
- Частота: {assessment.match_frequency}
- Под давлением: {assessment.pressure_handling}

**Цели:**
- 3 месяца: {assessment.goal_3months}
- 1 год: {assessment.goal_1year}

**Ограничения:**
- Травмы: {assessment.injuries if assessment.injuries else 'Нет'}
- Время/день: {assessment.training_time}
- Покрытие: {assessment.court_surface}

**Самооценка:**
{assessment.self_assessment}
"""
    else:
        summary = f"""
📋 **ASSESSMENT**

**Physical:**
- Age: {assessment.age or '—'} years
- Height: {assessment.height_cm or '—'} cm

**Technique:**
- Style: {assessment.playing_style}
- Forehand: {assessment.forehand_grip}
- Backhand: {assessment.backhand_type}
- Serve: {assessment.serve_speed_kmh or '?'} km/h ({assessment.serve_consistency})

**Strengths:**
{', '.join(assessment.strengths) if assessment.strengths else '—'}

**Areas to improve:**
{', '.join(assessment.weaknesses) if assessment.weaknesses else '—'}

**Matches:**
- Frequency: {assessment.match_frequency}
- Under pressure: {assessment.pressure_handling}

**Goals:**
- 3 months: {assessment.goal_3months}
- 1 year: {assessment.goal_1year}

**Constraints:**
- Injuries: {assessment.injuries if assessment.injuries else 'None'}
- Time/day: {assessment.training_time}
- Court: {assessment.court_surface}

**Self-assessment:**
{assessment.self_assessment}
"""

    return summary
