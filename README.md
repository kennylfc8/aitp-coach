# AI Tennis Coach 🎾

Personal AI coach in Telegram for daily tennis practice accountability. Keeps a model of your game and runs a **30–60 min/day cycle** with daily plans, drills, video recommendations, and voice feedback — all in Russian and English.

## Features

✅ **Telegram Bot** — Daily coaching via messaging  
✅ **Detailed Assessment** — 15+ question diagnostic to identify strengths/weaknesses  
✅ **Player Model** — Persistent profile with level, strengths/weaknesses, goals, assessment results  
✅ **AI Coach Brain** — Claude API generates personalized daily plans, analyzes check-ins  
✅ **Voice Messages** — Qwen3-TTS for daily coaching audio (RU + EN)  
✅ **Voice Cloning** — Coach's voice (3-5 sec sample) cloned into all messages  
✅ **Voice Check-In** — Send voice messages → auto-transcribed via Whisper  
✅ **Video Library** — Curated drills organized by skill and level  
✅ **Streak Tracking** — Build accountability with daily check-in streaks  
✅ **Smart Scheduling** — GitHub Actions cron for automatic daily messages  
✅ **Language Auto-Detection** — Switches RU/EN based on your messages  

## Tech Stack

- **Bot:** Python + aiogram
- **LLM:** Claude API (Opus 4.8 for planning, Haiku 4.5 for analysis)
- **TTS:** Qwen3-TTS (self-hosted or fallback placeholder)
- **Scheduler:** GitHub Actions cron
- **Storage:** JSON files (easy to migrate to DB later)

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
