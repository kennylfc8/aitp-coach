# Voice Cloning Setup Guide

## How It Works

Qwen3-TTS supports **voice cloning** — you provide a 3-5 second audio sample of the coach's voice, and it generates all messages in that voice.

This means:
- Daily plans sound like YOUR coach (same voice, tone, personality)
- Not a robotic TTS voice
- Multilingual (same person speaking RU and EN)

## Setup Steps

### 1. Record Your Coach's Voice (3-5 seconds)

Have your coach record a short clip:
- **Duration:** 3-5 seconds
- **Content:** Any neutral sentence like "Привет, я твой теннис-коуч" or "Hello, I'm your tennis coach"
- **Audio quality:** Clean, no background noise
- **Format:** WAV, MP3, OGG (any standard audio format)

**Example script:**
```
"Привет! Я твой личный теннис-коуч. 
Давай улучшать твою технику каждый день. Вперёд!"
```

### 2. Upload Voice Sample

Place the audio file in:
```
data/voice_samples/coach_voice.wav
```

### 3. Configure .env

```bash
# .env
QWEN3_TTS_ENDPOINT=https://api.runpod.io/your_qwen3_model_id
QWEN3_VOICE_CLONE=true
QWEN3_VOICE_PATH=data/voice_samples/coach_voice.wav
```

### 4. Update Bot Code

In `src/bot.py`, load the voice sample:

```python
from src.tts import load_coach_voice

@router.message(Command("start"))
async def cmd_start(message: Message, state: FSMContext):
    # Load coach voice once
    coach_voice = load_coach_voice()
    # Use it in TTS calls
    voice_data = await generate_speech(text, language, voice_clone=coach_voice)
```

### 5. Test

```bash
python -m src.main
# Send /plan → voice should sound like your coach
```

## Quality Tips

✅ **Good voice samples:**
- Clear, calm tone
- No background noise
- 3-5 seconds is enough
- Natural speech (not overly excited)

❌ **Avoid:**
- Whispering (too quiet)
- Shouting (distorts)
- Music or ambient noise
- Filler words ("uh", "um")

## Qwen3-TTS Setup (Self-Hosted)

If you don't have an endpoint yet, here's how to set one up:

### Option A: RunPod (Easiest)

1. Go to [runpod.io](https://runpod.io)
2. Create account
3. Deploy **Qwen3-TTS** template (search marketplace)
4. Wait for pod to start
5. Copy endpoint URL
6. Add to `.env`:
   ```
   QWEN3_TTS_ENDPOINT=https://api.runpod.io/v1/your-pod-id/run
   ```

### Option B: Modal

1. Go to [modal.com](https://modal.com)
2. Deploy Qwen3-TTS function
3. Copy API endpoint
4. Add to `.env`

### Option C: Local (Docker)

```bash
docker run -p 5000:5000 \
  qwen/qwen3-tts:latest

# In .env:
QWEN3_TTS_ENDPOINT=http://localhost:5000
```

## Voice Cloning API Call

Once configured, the bot will automatically:

1. Load coach's voice sample (3-5 sec)
2. When generating daily plan:
   ```python
   voice_data = await generate_speech(
       text="Сегодня работаем над разножкой...",
       language="RU",
       voice_clone=coach_voice_bytes,  # Your coach's voice
       emotion="encouraging"
   )
   ```
3. Qwen3 clones the voice and generates text in that voice
4. Sends audio to player

## Expected Result

**Without cloning:**
```
Bot: "🎾 Today's plan. Focus: split-step."
Voice: Generic TTS (robotic, monotone)
```

**With cloning:**
```
Bot: "🎾 Today's plan. Focus: split-step."
Voice: YOUR COACH speaking (same tone, personality, accent)
```

## Supported Languages with Voice Clone

- Russian (RU) ✅
- English (EN) ✅
- Cross-lingual (same voice in both languages) ✅

## Cost

- **Qwen3-TTS model:** Free (open-source weights)
- **RunPod GPU:** ~$0.10-0.30/hour
- **Daily usage:** 2 voice messages = ~2-3 minutes GPU time = ~$0.01/day = ~$0.30/month
- **Total:** ~$5/month for serverless GPU + Claude API

## Troubleshooting

### "Voice sample too short"
- Record at least 3 seconds
- Make sure audio isn't compressed

### "Voice quality degraded"
- Use cleaner audio (no background noise)
- Try different voice sample (different content)
- Check audio bitrate (16kHz, 16-bit recommended)

### "API connection failed"
- Verify endpoint URL in `.env`
- Check RunPod/Modal pod is running
- Test with curl:
  ```bash
  curl -X POST https://api.runpod.io/v1/your-pod-id/run \
    -H "Content-Type: application/json" \
    -d '{"text": "Test", "language": "ru"}'
  ```

## Advanced: Fine-Tuning

Qwen3-TTS supports additional parameters:

```python
voice_data = await generate_speech(
    text="...",
    language="RU",
    voice_clone=coach_voice,
    emotion="energetic",  # neutral, encouraging, energetic, calm
    speed=0.9,  # 0.5-2.0 (slower-faster)
    pitch=1.0,  # 0.5-1.5 (lower-higher)
    energy=1.0  # 0.5-1.5 (quieter-louder)
)
```

Experiment to match your coach's natural style!
