# Quick Start Guide 🚀

## 1. Clone & Setup (5 minutes)

```bash
# Clone repository
git clone https://gitlab.com/kennylfc8/aitp-coach.git
cd aitp-coach

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

## 2. Configure Environment (3 minutes)

```bash
# Copy template
cp .env.example .env

# Edit .env with your tokens:
# TELEGRAM_BOT_TOKEN=<from @BotFather>
# ANTHROPIC_API_KEY=<from console.anthropic.com>
# OPENAI_API_KEY=<from platform.openai.com> (optional, for Whisper)
```

**Get tokens:**
- **Telegram:** [@BotFather](https://t.me/botfather) → create bot → get token
- **Anthropic:** [console.anthropic.com](https://console.anthropic.com) → API keys
- **OpenAI:** [platform.openai.com](https://platform.openai.com) → API keys (for STT)

## 3. Run Bot Locally (1 minute)

```bash
python -m src.main
```

Bot starts polling Telegram. Now open Telegram and test:

```
/start              → Begin onboarding
[Answer 15 questions] → Assessment
/schedule_intermediate → Choose schedule
/plan               → Get today's plan
/checkin            → Evening check-in
```

## 4. (Optional) Voice Cloning (5 minutes)

If you want coach's voice in messages:

1. **Record coach's voice** (3-5 seconds):
   - Say: "Привет, я твой теннис-коуч!"
   - Or: "Hello, I'm your tennis coach!"
   - Save as `.wav` file

2. **Save to project:**
   ```bash
   mkdir -p data/voice_samples
   cp coach_voice.wav data/voice_samples/
   ```

3. **Setup Qwen3-TTS endpoint:**
   - Use RunPod/Modal (see `VOICE_CLONING_SETUP.md`)
   - Or run locally with Docker

4. **Update `.env`:**
   ```
   QWEN3_TTS_ENDPOINT=https://api.runpod.io/your-endpoint
   ```

5. **Test:**
   ```
   /plan → Should now hear coach's voice!
   ```

## 5. Deploy Scheduler (Optional - 5 minutes)

If you want daily automatic messages:

1. **Push to GitHub:**
   ```bash
   git push origin main
   ```

2. **Add GitHub Secrets:**
   - Go to repo → Settings → Secrets
   - Add:
     - `TELEGRAM_BOT_TOKEN`
     - `ANTHROPIC_API_KEY`
     - (Optional) `OPENAI_API_KEY`

3. **Check workflow:**
   - `.github/workflows/scheduler.yml` is ready
   - Runs at 7:00 UTC (morning) and 19:00 UTC (evening)

4. **Done!** Plans auto-send daily to all users

---

## Commands Reference

```
Setup:
/start                    → Create account + assessment
/reassess                → Re-do assessment
/quick                   → Skip detailed assessment

Schedule:
/schedule               → View your current schedule
/schedule_casual        → 30 min/day template
/schedule_intermediate  → 20+20 min daily + 3x court
/schedule_serious       → 3-4 hours/day template
/schedule_custom        → Build your own

Training:
/plan                  → Get today's plan
/plan_today            → Detailed breakdown
/plan_week             → Week overview
/checkin               → Evening check-in (text)
[voice message]        → Voice check-in (auto-transcribed)

Profile:
/profile               → View assessment results
/videos                → Get video recommendations
/en / /ru              → Change language
```

---

## File Structure

```
aitp-coach/
├── src/
│   ├── main.py                 # Bot entry point
│   ├── bot.py                  # Telegram handlers
│   ├── models.py               # Data schemas
│   ├── storage.py              # Player persistence
│   ├── assessment.py           # 15-question diagnostic
│   ├── coach_brain.py          # Claude API integration
│   ├── training_schedule.py    # Schedule templates
│   ├── plan_generator.py       # Per-session planning
│   ├── tts.py                  # Voice generation + cloning
│   ├── stt.py                  # Voice transcription
│   ├── videos.py               # Video library
│   └── polish.py               # Streaks, language detection
│
├── data/
│   ├── players/                # User profiles (JSON)
│   └── voice_samples/          # Coach voice for cloning
│
├── .github/workflows/
│   └── scheduler.yml           # GitHub Actions cron
│
├── .env.example                # Environment template
├── requirements.txt            # Python dependencies
├── scheduler.py                # Cron job script
├── README.md                   # This file
├── QUICKSTART.md              # Quick start (you are here)
├── COMPLETE_SYSTEM.md         # Full system explanation
├── CUSTOM_TRAINING_SCHEDULE.md # Schedule customization
├── DETAILED_ASSESSMENT.md      # Assessment details
├── VOICE_CLONING_SETUP.md     # Voice setup guide
└── WHAT_YOU_GET.md            # Player experience guide
```

---

## Documentation

After setup, read these to understand the system:

1. **`COMPLETE_SYSTEM.md`** ← Start here! Full overview
2. **`CUSTOM_TRAINING_SCHEDULE.md`** ← How schedules work
3. **`DETAILED_ASSESSMENT.md`** ← Assessment + voice features
4. **`VOICE_CLONING_SETUP.md`** ← Clone coach's voice
5. **`WHAT_YOU_GET.md`** ← What you get as a player

---

## Troubleshooting

### "ImportError: No module named 'aiogram'"
```bash
pip install -r requirements.txt
```

### "TELEGRAM_BOT_TOKEN not set"
```bash
# Check .env file exists and has:
TELEGRAM_BOT_TOKEN=your_token_here
```

### "Claude API error"
```bash
# Check:
ANTHROPIC_API_KEY=your_key_here
# Key is correct (console.anthropic.com)
```

### "Voice transcription not working"
```bash
# Check:
OPENAI_API_KEY=your_key_here
# Or install local Whisper: pip install openai-whisper
```

### "Scheduler not sending messages"
```bash
# Check GitHub Actions:
# Repo → Actions → Check logs
# Make sure secrets are set in Settings → Secrets
```

---

## Next Steps

1. ✅ Run bot locally
2. ✅ Complete assessment (/start)
3. ✅ Choose schedule (/schedule_intermediate)
4. ✅ Get daily plans (/plan)
5. ✅ Setup voice cloning (optional)
6. ✅ Deploy scheduler (optional)

---

## Cost

```
Claude API:        $2-5/month   (plans + analysis)
Whisper STT:       $0.01/month  (2 checks/day)
Qwen3-TTS GPU:     $0.30/month  (2 voices/day)
---
TOTAL:             $3-7/month

🎾 That's less than 1 tennis lesson!
```

---

## Support

- Questions? Check the `.md` files
- Bug? Create issue on GitLab
- Suggestions? Update this guide!

---

**Ready? Let's go!** 🚀

```bash
python -m src.main
```

Then in Telegram: `/start`
