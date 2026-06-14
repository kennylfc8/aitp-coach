# M1: AI Tennis Coach - Text Cycle (Complete)

## What's Built

### Core Components

1. **Telegram Bot** (`src/bot.py`)
   - Onboarding flow: name → level → experience
   - Commands:
     - `/start` — initialize or welcome back
     - `/plan` — get today's practice plan
     - `/checkin` — evening check-in
     - `/profile` — view player profile
     - `/en` / `/ru` — language switcher
   - Two-language support (RU default, EN)

2. **Player Model** (`src/models.py` + `src/storage.py`)
   - Persistent JSON storage in `data/players/{user_id}.json`
   - Fields: level, experience, strengths/weaknesses, goals, current focus, streak, language preferences
   - Automatic streak tracking

3. **Coach Brain** (`src/coach_brain.py`)
   - Claude API integration (Opus for planning, Haiku for analysis)
   - Daily plan generation (focus + drill + estimated time)
   - Evening check-in analysis
   - Player model updates based on feedback

4. **Scheduler** (`scheduler.py` + `.github/workflows/scheduler.yml`)
   - Cron-based daily messages via GitHub Actions
   - Morning: daily plan (07:00 UTC)
   - Evening: check-in reminder (19:00 UTC)

## Setup

### 1. Environment Variables
```bash
cp .env.example .env
# Edit .env with:
# - TELEGRAM_BOT_TOKEN (from @BotFather on Telegram)
# - ANTHROPIC_API_KEY (from https://console.anthropic.com)
```

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Run Bot Locally
```bash
python -m src.main
```

### 4. Deploy Scheduler
Push to GitHub with the workflow file. Add secrets in repo settings:
- `TELEGRAM_BOT_TOKEN`
- `ANTHROPIC_API_KEY`

## Daily Flow (Example)

**Morning (07:00 UTC)**
```
Bot: 🎾 Plan on today
Focus: Split-step timing
Drill: 20 shadow-swings with focus on foot positioning...
Time: 45 minutes
```

**Evening (19:00 UTC)**
```
Bot: Time for your evening check-in!
How was your session? /checkin
```

User responds → Coach analyzes → Streak increments → Ready for next day

## Storage Structure
```
aitp-coach/
├── data/
│   └── players/
│       ├── 123456789.json  (player 1)
│       └── 987654321.json  (player 2)
└── ...
```

Example player file:
```json
{
  "user_id": 123456789,
  "name": "John",
  "level": "intermediate",
  "experience_years": 5,
  "language": "RU",
  "strengths": ["forehand", "volley"],
  "weaknesses": ["backhand"],
  "goals": ["improve backhand", "serve consistency"],
  "current_focus": "split-step",
  "streak": 3,
  "created_at": "2025-06-14T10:30:00",
  "updated_at": "2025-06-15T20:15:00"
}
```

## Next Steps (M2, M3, M4)

- **M2:** Qwen3-TTS integration for voice messages
- **M3:** Curated video library + YouTube video recommendations
- **M4:** Polish — better streak management, language auto-detection, improved prompts

## Notes

- Text-only cycle is fully functional
- No avatar or real calls (v2+)
- Storage is file-based JSON (can upgrade to SQLite or cloud DB later)
- All costs are API usage: Claude + optional serverless GPU for TTS (M2)
