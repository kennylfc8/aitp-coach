"""
Text-to-Speech module using Qwen3-TTS.

Supports both self-hosted (RunPod/Modal) and fallback solutions.
Generates voice messages in RU and EN with natural prosody.
Supports voice cloning with 3-second audio sample.
"""

import os
import io
import aiohttp
from typing import Optional

# Qwen3-TTS API endpoint (self-hosted on RunPod/Modal or local)
QWEN3_ENDPOINT = os.getenv("QWEN3_TTS_ENDPOINT", "")

# Voice cloning (coach's voice reference)
# Store 3-5 seconds of coach's voice as bytes
COACH_VOICE_SAMPLE = None  # Will be loaded from file or URL


async def generate_speech(
    text: str,
    language: str = "RU",
    voice_clone: Optional[bytes] = None,
    emotion: str = "encouraging",
    speed: float = 1.0
) -> Optional[bytes]:
    """
    Generate speech audio using Qwen3-TTS with optional voice cloning.

    Args:
        text: Text to convert to speech
        language: "RU" or "EN"
        voice_clone: Optional voice sample bytes (3-5 seconds) for cloning coach's voice
        emotion: "encouraging", "neutral", "energetic", etc.
        speed: Speech speed (0.5 - 2.0)

    Returns:
        Audio bytes (WAV format) or None if failed
    """

    if not QWEN3_ENDPOINT:
        # Fallback: simple placeholder
        print(f"[TTS] No endpoint configured. Returning silent placeholder.")
        return _create_silent_audio()

    payload = {
        "text": text,
        "language": language.lower(),
        "emotion": emotion,
        "speed": speed,
    }

    # Add voice cloning if sample provided
    if voice_clone:
        payload["voice_clone_enabled"] = True
        # Payload would need to handle binary data separately

    try:
        async with aiohttp.ClientSession() as session:
            if voice_clone:
                # For voice cloning, use multipart form data
                data = aiohttp.FormData()
                data.add_field('text', text)
                data.add_field('language', language.lower())
                data.add_field('emotion', emotion)
                data.add_field('speed', str(speed))
                data.add_field('voice_sample', voice_clone, filename='voice.wav', content_type='audio/wav')

                async with session.post(
                    f"{QWEN3_ENDPOINT}/tts",
                    data=data,
                    timeout=aiohttp.ClientTimeout(total=60)
                ) as resp:
                    if resp.status == 200:
                        return await resp.read()
            else:
                # Regular TTS without cloning
                async with session.post(
                    f"{QWEN3_ENDPOINT}/tts",
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=60)
                ) as resp:
                    if resp.status == 200:
                        return await resp.read()
                    else:
                        print(f"[TTS] Error: {resp.status}")
                        return None
    except Exception as e:
        print(f"[TTS] Exception: {e}")
        return None


async def generate_daily_voice_message(focus: str, drill: str, language: str) -> Optional[bytes]:
    """Generate voice for daily coaching plan."""

    if language == "RU":
        text = f"""Привет! Я твой теннис-коуч.

Сегодня мы работаем над: {focus}.

Дрилл: {drill}.

Дай себе 45 минут и сосредоточься. Ты можешь это!"""
    else:
        text = f"""Hey there! I'm your tennis coach.

Today we're working on: {focus}.

Drill: {drill}.

Give yourself 45 minutes and focus. You got this!"""

    return await generate_speech(text, language)


async def generate_checkin_feedback_voice(feedback: str, language: str) -> Optional[bytes]:
    """Generate voice response for evening check-in."""
    return await generate_speech(feedback, language)


def _create_silent_audio() -> bytes:
    """Create a minimal silent WAV file for testing."""
    # Minimal WAV header (44100 Hz, mono, 16-bit)
    import wave
    import struct

    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(44100)
        wav.writeframes(b'\x00' * 88200)  # 1 second of silence

    return buffer.getvalue()
