"""
Text-to-Speech: give the coach a real voice.

Primary provider: OpenAI TTS (uses OPENAI_API_KEY, no extra setup, ~cents/month).
Optional: a self-hosted Qwen3 endpoint (QWEN3_TTS_ENDPOINT) for voice cloning —
if set, it takes priority. With neither configured, returns None (bot stays text-only).

Output defaults to Opus/OGG, which is exactly what Telegram voice notes want.
"""

import os
import aiohttp
from typing import Optional

# Optional self-hosted endpoint (voice cloning). If set, takes priority.
QWEN3_ENDPOINT = os.getenv("QWEN3_TTS_ENDPOINT", "")

# OpenAI TTS config (tunable via env)
OPENAI_TTS_MODEL = os.getenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts")
OPENAI_TTS_VOICE = os.getenv("OPENAI_TTS_VOICE", "onyx")  # deep, confident — coach-like


def _coach_instructions(language: str, emotion: str = "encouraging") -> str:
    """Tone steering for gpt-4o-mini-tts — make it sound like a real coach."""
    if language == "RU":
        return ("Говори как энергичный, тёплый и уверенный теннис-тренер. "
                "Поддерживай и мотивируй, живые интонации, естественный темп, "
                "немного драйва — будто подбадриваешь ученика перед тренировкой.")
    return ("Speak like an energetic, warm, confident tennis coach. "
            "Be supportive and motivating, lively intonation, natural pace, "
            "a bit of drive — like you're hyping up your student before practice.")


async def _openai_tts(
    text: str,
    language: str = "RU",
    instructions: Optional[str] = None,
    fmt: str = "opus",
) -> Optional[bytes]:
    """Synthesize speech via OpenAI. Returns audio bytes (default Opus/OGG) or None."""
    key = os.getenv("OPENAI_API_KEY", "")
    if not key:
        print("[TTS] No OPENAI_API_KEY — skipping voice.")
        return None

    payload = {
        "model": OPENAI_TTS_MODEL,
        "voice": OPENAI_TTS_VOICE,
        "input": text,
        "response_format": fmt,
    }
    # Tone steering is supported by the gpt-4o-* TTS models.
    if instructions and OPENAI_TTS_MODEL.startswith("gpt-4o"):
        payload["instructions"] = instructions

    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://api.openai.com/v1/audio/speech",
                json=payload, headers=headers,
                timeout=aiohttp.ClientTimeout(total=60),
            ) as resp:
                if resp.status == 200:
                    return await resp.read()
                body = await resp.text()
                print(f"[TTS] OpenAI error {resp.status}: {body[:200]}")
                return None
    except Exception as e:
        print(f"[TTS] OpenAI exception: {e}")
        return None


async def _qwen_tts(
    text: str, language: str, voice_clone: Optional[bytes], emotion: str, speed: float
) -> Optional[bytes]:
    """Self-hosted Qwen3-TTS (optional, supports voice cloning)."""
    try:
        async with aiohttp.ClientSession() as session:
            if voice_clone:
                data = aiohttp.FormData()
                data.add_field("text", text)
                data.add_field("language", language.lower())
                data.add_field("emotion", emotion)
                data.add_field("speed", str(speed))
                data.add_field("voice_sample", voice_clone,
                               filename="voice.wav", content_type="audio/wav")
                async with session.post(f"{QWEN3_ENDPOINT}/tts", data=data,
                                        timeout=aiohttp.ClientTimeout(total=60)) as resp:
                    return await resp.read() if resp.status == 200 else None
            payload = {"text": text, "language": language.lower(),
                       "emotion": emotion, "speed": speed}
            async with session.post(f"{QWEN3_ENDPOINT}/tts", json=payload,
                                    timeout=aiohttp.ClientTimeout(total=60)) as resp:
                return await resp.read() if resp.status == 200 else None
    except Exception as e:
        print(f"[TTS] Qwen exception: {e}")
        return None


async def generate_speech(
    text: str,
    language: str = "RU",
    voice_clone: Optional[bytes] = None,
    emotion: str = "encouraging",
    speed: float = 1.0,
) -> Optional[bytes]:
    """Generate coach speech. Qwen endpoint (if set) wins for cloning; else OpenAI."""
    if QWEN3_ENDPOINT:
        return await _qwen_tts(text, language, voice_clone, emotion, speed)
    return await _openai_tts(text, language, instructions=_coach_instructions(language, emotion))


async def generate_daily_voice_message(focus: str, drill: str, language: str) -> Optional[bytes]:
    """Voice for the daily plan — short, punchy, coach-style."""
    if language == "RU":
        text = (f"Привет! Сегодня работаем над: {focus}. "
                f"Твой дрилл: {drill} "
                f"Соберись и вложись по полной — ты справишься!")
    else:
        text = (f"Hey! Today we're working on: {focus}. "
                f"Your drill: {drill} "
                f"Lock in and give it everything — you've got this!")
    return await generate_speech(text, language, emotion="energetic")


async def generate_checkin_feedback_voice(feedback: str, language: str) -> Optional[bytes]:
    """Voice for the evening check-in feedback."""
    return await generate_speech(feedback, language, emotion="encouraging")
