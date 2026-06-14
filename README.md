# AI Tennis Coach 🎾

Personal AI coach in Telegram with **custom training schedules**, detailed assessment, and personalized plans for every session. Daily accountability with voice feedback from your coach.

## Core Features

### 📋 Assessment & Profile
✅ **Detailed 15-question Assessment** — Comprehensive diagnostic of your game  
✅ **Smart Player Model** — Level, experience, strengths, weaknesses, goals, physical info  
✅ **Per-User Customization** — Everything tailored to YOU

### 📅 Custom Training Schedule
✅ **Your Schedule, Your Way** — Define your exact training structure:
  - Morning sessions (20 min shadow-swings)
  - Evening sessions (20 min drills)
  - Court sessions (2h technique/match-play)
  - Match play
✅ **Pre-built Templates** — Casual/Intermediate/Serious players  
✅ **Track Weekly Minutes** — 230-730+ min/week depending on level

### 🎾 Smart Plan Generation
✅ **Per-Session Plans** — DIFFERENT plan for each session:
  - 20-min morning ≠ 120-min court session
  - Shadow-swings focus ≠ match-simulation focus
✅ **Adaptive Difficulty** — Based on level, weaknesses, session type  
✅ **Personalized Focus** — Targets YOUR weak areas each day

### 🎙️ Voice Support (Full)
✅ **Receive Plans as Voice** — Qwen3-TTS with voice cloning  
✅ **Coach's Voice** — Clone any voice (3-5 sec sample) for all messages  
✅ **Send Voice Check-Ins** — Speak instead of type  
✅ **Auto-Transcription** — Whisper API converts voice → text  
✅ **Bilingual** — RU + EN support

### 📹 Video Library
✅ **Curated Videos** — Organized by skill, level, difficulty  
✅ **Smart Recommendations** — Per-session video suggestions  
✅ **Multiple Languages** — Russian & English content

### 🔥 Motivation & Tracking
✅ **Streak Tracking** — Daily accountability (🌱 → 🔥🔥🔥)  
✅ **Daily Feedback** — Coach analyzes your check-ins  
✅ **Language Auto-Detection** — Switches RU/EN automatically  
✅ **Progress Monitoring** — Weekly insights

### ⚙️ Automation
✅ **GitHub Actions Scheduler** — Auto-sends plans daily  
✅ **Morning Plans** — 7:00 AM (customizable per user)  
✅ **Evening Reminders** — 7:00 PM (customizable per user)  
✅ **Per-User Settings** — Each player has own times  

## Tech Stack

- **Bot:** Python 3.11+ + aiogram 3.3
- **LLM:** Claude API (Opus 4.8 for planning, Haiku 4.5 for quick tasks)
- **STT:** OpenAI Whisper API (voice → text transcription)
- **TTS:** Qwen3-TTS (self-hosted, with voice cloning support)
- **Scheduler:** GitHub Actions cron (free, automatic)
- **Storage:** JSON files (per-user profiles, easy to migrate to SQLite/PostgreSQL)
- **Languages:** Russian (RU) & English (EN)

## Quick Start

### 1. Clone & Setup

```bash
git clone https://gitlab.com/kennylfc8/aitp-coach.git
cd aitp-coach
bash setup.sh
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with:
TELEGRAM_BOT_TOKEN=<your_bot_token>
ANTHROPIC_API_KEY=<your_api_key>
QWEN3_TTS_ENDPOINT=<optional, for voice>
```

Get tokens:
- **Telegram:** [@BotFather](https://t.me/botfather)
- **Anthropic:** [console.anthropic.com](https://console.anthropic.com)
- **Qwen3-TTS:** Self-host on RunPod/Modal or use fallback

### 3. Run Locally

```bash
python -m src.main
```

Start a chat on Telegram with your bot:
```
/start          → Onboarding (name, level, experience)
/plan           → Get today's plan + drill + videos
/checkin        → Evening check-in
/profile        → View your profile & streak
/videos         → Get 5 video recommendations
/en / /ru       → Switch language
```

### 4. Deploy Scheduler (Optional)

Push to GitHub and configure Actions secrets:
- `TELEGRAM_BOT_TOKEN`
- `ANTHROPIC_API_KEY`

Scheduler will auto-send:
- **07:00 UTC:** Daily plan with voice
- **19:00 UTC:** Evening check-in reminder

## Daily Flow

```
Morning (07:00)
├─ 🎾 Focus: Split-step timing
├─ Drill: 20 shadow-swings + footwork (10 min)
├─ Video: "Split Step Fundamentals" (8 min)
└─ ♪ Voice message from coach

Evening (19:00)
└─ 🌅 Check-in reminder → /checkin
   ├─ You: "Did 45 min, backhand felt good"
   ├─ Coach: "Great work on footwork!"
   └─ Streak: +1 day 🔥
```

## Milestones

| Status | Feature | Details |
|--------|---------|---------|
| ✅ **M1** | Text Cycle | Bot, player model, Claude brain, scheduler |
| ✅ **M2** | Voice Messages | Qwen3-TTS integration, daily voice |
| ✅ **M3** | Video Library | Curated drills + recommendations |
| ✅ **M4** | Polish | Streak tracking, language detection, reminders |
| 📋 **M5** | (Future) | Avatar, real voice calls (Retell/Vapi) |

## Cost

- **M1-M4 (text+voice):** $5–15/month (Claude API + optional serverless GPU)
- **TTS Self-host:** Cheap (open-weights model, GPU only for daily use)
- **Telegram:** Free
- **GitHub Actions:** Free

## Project Structure

```
src/
├── main.py              # Bot entry point
├── bot.py              # Telegram handlers
├── models.py           # Data schemas
├── storage.py          # Player persistence
├── coach_brain.py      # Claude API + prompts
├── tts.py              # Voice generation
├── videos.py           # Video library
└── polish.py           # Streaks, reminders, UX

scheduler.py            # Daily cron job script
.github/workflows/      # GitHub Actions scheduler
```

## Configuration

See [tennis-coach-v1-plan_2.md](tennis-coach-v1-plan_2.md) for full spec.

### Player Model Fields

```json
{
  "name": "John",
  "level": "intermediate",
  "experience_years": 5,
  "language": "RU",
  "current_focus": "split-step",
  "strengths": ["forehand"],
  "weaknesses": ["backhand"],
  "goals": ["serve consistency"],
  "streak": 14
}
```

## Next Steps

- [ ] Real Qwen3-TTS on RunPod/Modal
- [ ] YouTube API integration for live video search
- [ ] Better streak visualization + milestones
- [ ] Player progress analytics
- [ ] Video call integration (v2)

## License

MIT
