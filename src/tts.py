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
OPENAI_TTS_VOICE = os.getenv("OPENAI_TTS_VOICE", "ash")  # dynamic, expressive — coach-like


def _coach_instructions(language: str, emotion: str = "encouraging") -> str:
    """Tone steering for gpt-4o-mini-tts — a fired-up, human coach (not a robot)."""
    if language == "RU":
        return ("Озвучивай как ЗАРЯЖЕННЫЙ тренер у корта: живо, быстро, с напором и эмоциями. "
                "Темп выше обычного, рублено, энергично. Меняй интонацию — где-то громче и резче, "
                "где-то с азартом и подъёмом. Чётко выговаривай слова, по-человечески, с характером. "
                "Никакой монотонности, никакого робота — это огонь, драйв и эмоция.")
    return ("Deliver like a FIRED-UP coach courtside: lively, fast, punchy, emotional. "
            "Faster than normal pace, energetic, staccato. Vary intonation — louder and sharper "
            "in places, hyped and rising in others. Crisp enunciation, human, with attitude. "
            "No monotone, no robot — this is fire, drive and emotion.")


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


async def _minimax_tts(text: str, language: str, emotion: str = "happy") -> Optional[bytes]:
    """MiniMax Speech 2.6 HD — ultra-human, multilingual (incl. Russian). Returns mp3 bytes."""
    key = os.getenv("MINIMAX_API_KEY", "")
    group = os.getenv("MINIMAX_GROUP_ID", "")
    if not (key and group):
        return None

    model = os.getenv("MINIMAX_MODEL", "speech-2.6-hd")
    voice = os.getenv("MINIMAX_VOICE_ID", "Determined_Man")
    speed = float(os.getenv("MINIMAX_SPEED", "1.1"))
    emo = os.getenv("MINIMAX_EMOTION", emotion)

    url = f"https://api.minimax.io/v1/t2a_v2?GroupId={group}"
    payload = {
        "model": model,
        "text": text,
        "stream": False,
        "language_boost": "Russian" if language == "RU" else "English",
        "voice_setting": {"voice_id": voice, "speed": speed, "vol": 1.0, "pitch": 0, "emotion": emo},
        "audio_setting": {"sample_rate": 32000, "bitrate": 128000, "format": "mp3", "channel": 1},
    }
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=headers,
                                    timeout=aiohttp.ClientTimeout(total=60)) as resp:
                data = await resp.json()
                base = data.get("base_resp", {})
                if base.get("status_code") not in (0, None):
                    print(f"[TTS] MiniMax error: {base.get('status_code')} {base.get('status_msg')}")
                    return None
                audio_hex = (data.get("data") or {}).get("audio")
                if not audio_hex:
                    print(f"[TTS] MiniMax: no audio in response: {str(data)[:160]}")
                    return None
                return bytes.fromhex(audio_hex)
    except Exception as e:
        print(f"[TTS] MiniMax exception: {e}")
        return None


async def _elevenlabs_tts(text: str, language: str) -> Optional[bytes]:
    """ElevenLabs — very human, multilingual (incl. Russian), supports cloning. Returns mp3."""
    key = os.getenv("ELEVENLABS_API_KEY", "")
    if not key:
        return None
    voice = os.getenv("ELEVENLABS_VOICE_ID", "pNInz6obpgDQGcFmaJgB")  # "Adam" — deep male preset
    model = os.getenv("ELEVENLABS_MODEL", "eleven_multilingual_v2")
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice}"
    payload = {
        "text": text,
        "model_id": model,
        # lower stability + style => livelier, more emotional coach delivery
        "voice_settings": {"stability": 0.35, "similarity_boost": 0.8,
                           "style": 0.6, "use_speaker_boost": True},
    }
    headers = {"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=headers,
                                    timeout=aiohttp.ClientTimeout(total=60)) as resp:
                if resp.status == 200:
                    return await resp.read()
                print(f"[TTS] ElevenLabs error {resp.status}: {(await resp.text())[:200]}")
                return None
    except Exception as e:
        print(f"[TTS] ElevenLabs exception: {e}")
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
    """Generate coach speech. Priority: Qwen endpoint -> MiniMax -> OpenAI (with fallback)."""
    if QWEN3_ENDPOINT:
        return await _qwen_tts(text, language, voice_clone, emotion, speed)
    if os.getenv("MINIMAX_API_KEY") and os.getenv("MINIMAX_GROUP_ID"):
        audio = await _minimax_tts(text, language, emotion)
        if audio:
            return audio
        # MiniMax failed (e.g. no balance) -> fall through
    if os.getenv("ELEVENLABS_API_KEY"):
        audio = await _elevenlabs_tts(text, language)
        if audio:
            return audio
        # ElevenLabs failed (e.g. quota) -> fall through to OpenAI
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
