# Detailed Assessment & Voice Support

## Overview

The bot now includes:
1. **Comprehensive assessment questionnaire** (15+ detailed questions)
2. **Voice message support** (receive & transcribe voice check-ins)
3. **Voice cloning** (coach's voice for all daily messages)

---

## Assessment Questionnaire

Instead of just asking "level" and "experience", the bot now gathers:

### Physical Profile
- Age, height, handedness
- Court surface preference

### Technical Assessment
- Playing style (aggressive, defensive, all-rounder, serve-volley)
- Grip types (forehand, backhand)
- Serve speed & consistency
- Current injuries/limitations

### Strengths & Weaknesses
- Multi-select options for detailed feedback
- Examples: "Forehand", "Backhand", "Volley", "Movement", "Mental strength"

### Match Experience
- How often you play matches
- How you handle pressure
- Court conditions you prefer

### Goals
- 3-month goal (short-term)
- 1-year goal (long-term)

### Training Preferences
- Available time per day (30 min - 2+ hours)
- Current injuries
- Self-assessment (describe your game)

---

## Assessment Result

After completing the questionnaire, you get:

```
📋 ДИАГНОСТИКА

Физика:
- Возраст: 25 лет
- Рост: 185 см

Техника:
- Стиль: Агрессивный (атакую с базовой линии)
- Forehand: Semi-western
- Backhand: Одноручный
- Подача: 180 км/ч (70% в коробку)

Сильные стороны:
Forehand, Реакция, Психология

Что нужно работать:
Backhand, Разножка, Первый удар

Матчи:
- Частота: 1-2 раза в неделю
- Под давлением: Спокоен (могу сосредоточиться)

Цели:
- 3 месяца: Improve backhand consistency
- 1 год: Play at club championship level

Ограничения:
- Травмы: Нет
- Время/день: 60 минут
- Покрытие: Хард
```

**This assessment is then used to:**
- Generate personalized daily plans (not generic)
- Recommend specific drills for weak areas
- Adjust difficulty based on your level
- Track progress toward your goals

---

## Voice Message Support

### Send Voice Check-In

Instead of typing, you can **send voice messages**:

```
Evening (19:00)
Bot: "Time for check-in! /checkin"

You: 🎙️ [Send voice message]
"Did 45 minutes today, backhand felt good"

Bot: ✓ Я понял: "Did 45 minutes today, backhand felt good"
     [Transcribes your voice]

Bot: "Great work! Your backhand is improving."
     Streak: Day 5 🔥
```

### Voice Conversion to Text

The bot uses **OpenAI Whisper** to convert:
- 🎙️ Voice message (Telegram voice note)
- → Text transcription
- → Process as check-in/response

**Supported languages:** Russian, English (auto-detected)

### How It Works

1. You send voice message (press mic button in Telegram)
2. Bot receives audio
3. Whisper API transcribes to text
4. Bot processes as normal check-in
5. You get feedback

---

## Voice Cloning Setup

### What It Means

All bot responses come in YOUR COACH's voice:

```
Without voice cloning:
Bot (TTS): "Today we're working on backhand."
Voice: Generic robotic TTS voice

With voice cloning:
Bot: "Today we're working on backhand."
Voice: YOUR COACH speaking (same tone, accent, personality)
```

### How to Set Up

1. **Record coach's voice** (3-5 seconds)
   - Record saying: "Привет, я твой теннис-коуч!"
   - Or: "Hello, I'm your tennis coach!"
   - Save as `data/voice_samples/coach_voice.wav`

2. **Set up Qwen3-TTS endpoint**
   - Use RunPod, Modal, or Docker
   - Add to `.env`:
     ```
     QWEN3_TTS_ENDPOINT=https://api.runpod.io/your-pod-id
     QWEN3_VOICE_CLONE=true
     ```

3. **Every message now sounds like your coach!**

See `VOICE_CLONING_SETUP.md` for detailed instructions.

---

## Workflow Example: Full Day

### Day 1: Onboarding

```
User: /start

Bot: "Привет! Я твой AI-коуч. Начнём с анкеты."
    "1. Как тебя зовут?"

User: "John"

Bot: "2. Какой уровень игры?"
     [Shows: Beginner / Intermediate / Advanced / Professional]

User: "Intermediate"

Bot: "3. Сколько лет ты играешь?"

User: "5 лет"

Bot: "Отлично! Теперь подробная диагностика (10 вопросов)."
     "Какой у тебя рост (см)?"

User: "185"

Bot: "Хват на forehand?"
     [Shows: Eastern / Semi-western / Western / Continental]

User: "Semi-western"

... [8 more detailed questions] ...

Bot: 📋 Вот твоя диагностика:
     - Intermediate, 5 лет опыта
     - Стиль: All-rounder
     - Сильно: Forehand, Mental
     - Слабо: Backhand, Split-step
     
     Первый фокус: Split-step + Backhand intro
```

### Day 1: Morning (7:00 AM)

```
Bot: 🎾 План на сегодня

Основано на диагностике:
- Уровень: Intermediate
- Фокус: Split-step (т.к. слабая сторона)
- Время доступно: 60 мин

Фокус: Perfect moment for split-step
Дрилл: 20 shadow-swings с контролем

📹 Видео:
1. Perfect Split Step Technique (ATP Academy, 8 мин) - для твоего уровня
2. Shadow Swing Drills (Tennis with Sabine, 12 мин)

♪ [Voice message in coach's voice]: "Привет! Сегодня работаем над..."
```

### Day 1: Evening (19:00 PM)

```
Bot: 🌅 Время чек-ина! Как прошла тренировка? 
     Ты можешь написать или отправить голос!

     /checkin [text]
     или просто отправь 🎙️ голос

User: 🎙️ [Sends voice message]
      "Did 40 minutes, split-step was tough, backhand still weak"

Bot: ✓ Я понял: "Did 40 minutes, split-step was tough..."
     
     Отлично! Вижу, что split-step сложновато.
     Завтра повторим + добавим backhand.
     
     📊 Streak: День 1 🌱
```

---

## Technology Stack

### Voice Transcription (STT)
- **OpenAI Whisper API** (cloud, best quality)
- **Local Whisper** (fallback, free, offline)
- Supports: RU, EN, auto-detection

### Voice Generation (TTS)
- **Qwen3-TTS** (open-source, voice cloning)
- **Voice cloning:** 3-5 second sample → all messages sound like coach

### Assessment Storage
- Stored in player JSON:
  ```json
  {
    "assessment": {
      "age": 25,
      "height_cm": 185,
      "playing_style": "aggressive",
      "strengths": ["forehand", "mental"],
      "weaknesses": ["backhand", "split-step"],
      ...
    }
  }
  ```

---

## Cost Breakdown (with Voice)

| Service | Cost | Usage |
|---------|------|-------|
| Anthropic Claude | $2-5/mo | Daily plans + analysis |
| OpenAI Whisper | $0.01-0.03/mo | 2 voice messages/day |
| Qwen3-TTS GPU (RunPod) | $0.30-1/mo | 2 voice outputs/day |
| **Total** | **~$3-7/mo** | Full setup with voice |

---

## Next Improvements

- [ ] Better assessment result visualization (graphs, radar charts)
- [ ] Weekly progress analytics
- [ ] Adaptive difficulty (harder if you're crushing it)
- [ ] Video integration with YouTube API
- [ ] Real-time match analysis via voice messages

---

## Troubleshooting

### "Bot can't transcribe voice"
- Check `OPENAI_API_KEY` is set
- Or install local Whisper: `pip install openai-whisper`

### "Voice quality is robotic"
- Set up voice cloning with coach's voice sample
- See `VOICE_CLONING_SETUP.md`

### "Assessment takes too long"
- Users can skip detailed questions with `/quick`
- Or answer in batches across multiple days

---

## Commands

```
/start              → Full onboarding with detailed assessment
/quick              → Quick setup (just name + level)
/reassess           → Re-do assessment
/checkin [text]     → Text check-in
[voice message]     → Voice check-in (auto-transcribed)
/profile            → View assessment + progress
/plan               → Daily plan
/videos             → Video recommendations
```
