"""
Text-to-Speech: give the coach a real voice.

Primary provider: OpenAI TTS (uses OPENAI_API_KEY, no extra setup, ~cents/month).
Optional: a self-hosted Qwen3 endpoint (QWEN3_TTS_ENDPOINT) for voice cloning —
if set, it takes priority. With neither configured, returns None (bot stays text-only).

Output defaults to Opus/OGG, which is exactly what Telegram voice notes want.
"""

import os
import io
import re
import sys
import wave
import array
import struct
import asyncio
import base64
import mimetypes
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


def _replicate_reference() -> Optional[str]:
    """Reference audio for voice cloning: a public URL or a local file -> data URI."""
    url = os.getenv("REPLICATE_VOICE_URL")
    if url:
        return url
    path = os.getenv("REPLICATE_VOICE_SAMPLE")
    if path and os.path.exists(path):
        mime = mimetypes.guess_type(path)[0] or "audio/wav"
        with open(path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        return f"data:{mime};base64,{b64}"
    return None


async def _replicate_poll(session, get_url, headers, tries=150):
    for _ in range(tries):
        async with session.get(get_url, headers=headers) as r:
            d = await r.json()
            st = d.get("status")
            if st == "succeeded":
                return d.get("output")
            if st in ("failed", "canceled"):
                print(f"[TTS] Replicate prediction {st}: {d.get('error')}")
                return None
        await asyncio.sleep(1)
    return None


_REPLICATE_VERSION = None


async def _replicate_version(session, headers) -> Optional[str]:
    """Resolve the model's version id (env override, else fetch latest, cached)."""
    global _REPLICATE_VERSION
    if _REPLICATE_VERSION:
        return _REPLICATE_VERSION
    env = os.getenv("REPLICATE_MODEL_VERSION")
    if env:
        _REPLICATE_VERSION = env
        return env
    slug = os.getenv("REPLICATE_MODEL", "resemble-ai/chatterbox-multilingual")
    async with session.get(f"https://api.replicate.com/v1/models/{slug}", headers=headers) as r:
        if r.status == 200:
            _REPLICATE_VERSION = ((await r.json()).get("latest_version") or {}).get("id")
            return _REPLICATE_VERSION
    return None


def _chunk_text(text: str, limit: int = 300) -> list:
    """Split into <=limit-char chunks at sentence boundaries (Chatterbox caps at 300)."""
    text = (text or "").strip()
    if len(text) <= limit:
        return [text]
    chunks, cur = [], ""
    for part in re.split(r"(?<=[.!?…])\s+", text):
        if len(part) > limit:
            if cur:
                chunks.append(cur); cur = ""
            for i in range(0, len(part), limit):
                chunks.append(part[i:i + limit])
            continue
        if len(cur) + len(part) + 1 <= limit:
            cur = (cur + " " + part).strip()
        else:
            if cur:
                chunks.append(cur)
            cur = part
    if cur:
        chunks.append(cur)
    return chunks or [text[:limit]]


def _wav_float_to_int16(raw: bytes) -> bytes:
    """Chatterbox returns 32-bit float WAV (fmt=3). Browsers' Web Audio path mangles
    float WAV ('хрюканье') and Python's `wave` can't read it to concat. Convert to
    16-bit PCM (fmt=1) — fixes browser playback AND enables chunk concat."""
    try:
        if raw[:4] != b"RIFF" or raw[8:12] != b"WAVE":
            return raw
        pos, afmt, ch, sr, bits, data = 12, 1, 1, 24000, 16, None
        while pos + 8 <= len(raw):
            cid = raw[pos:pos + 4]
            csz = struct.unpack("<I", raw[pos + 4:pos + 8])[0]
            body = raw[pos + 8:pos + 8 + csz]
            if cid == b"fmt ":
                afmt, ch, sr = struct.unpack("<HHI", body[:8])
                bits = struct.unpack("<H", body[14:16])[0]
            elif cid == b"data":
                data = body
            pos += 8 + csz + (csz & 1)  # chunks are word-aligned
        if data is None or not (afmt == 3 and bits == 32):
            return raw  # already int PCM (or unexpected) → leave alone
        floats = array.array("f")
        floats.frombytes(data[:len(data) // 4 * 4])
        if sys.byteorder == "big":
            floats.byteswap()
        ints = array.array(
            "h",
            (32767 if s > 1 else -32768 if s < -1 else int(s * 32767) for s in floats),
        )
        if sys.byteorder == "big":
            ints.byteswap()
        out = io.BytesIO()
        w = wave.open(out, "wb")
        w.setnchannels(ch)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(ints.tobytes())
        w.close()
        return out.getvalue()
    except Exception as e:
        print(f"[TTS] float->int16 convert failed: {e}")
        return raw


def _concat_wav(parts: list) -> bytes:
    """Concatenate same-format WAV blobs into one WAV."""
    if len(parts) == 1:
        return parts[0]
    out = io.BytesIO()
    writer = None
    for b in parts:
        rd = wave.open(io.BytesIO(b), "rb")
        if writer is None:
            writer = wave.open(out, "wb")
            writer.setnchannels(rd.getnchannels())
            writer.setsampwidth(rd.getsampwidth())
            writer.setframerate(rd.getframerate())
        writer.writeframes(rd.readframes(rd.getnframes()))
        rd.close()
    writer.close()
    return out.getvalue()


async def _replicate_one(session, version, headers, text, language, ref) -> Optional[bytes]:
    inp = {
        "text": text[:300],
        "language": "ru" if language == "RU" else "en",
        "exaggeration": float(os.getenv("REPLICATE_EXAGGERATION", "0.6")),
        "cfg_weight": float(os.getenv("REPLICATE_CFG", "0.5")),
    }
    if ref:
        inp["reference_audio"] = ref
    async with session.post("https://api.replicate.com/v1/predictions",
                            json={"version": version, "input": inp}, headers=headers,
                            timeout=aiohttp.ClientTimeout(total=120)) as r:
        if r.status not in (200, 201, 202):
            print(f"[TTS] Replicate error {r.status}: {(await r.text())[:200]}")
            return None
        data = await r.json()
    out = data.get("output")
    if not out and data.get("urls", {}).get("get"):
        out = await _replicate_poll(session, data["urls"]["get"], headers)
    if not out:
        print(f"[TTS] Replicate: no output: {str(data)[:200]}")
        return None
    audio_url = out[0] if isinstance(out, list) else out
    async with session.get(audio_url, timeout=aiohttp.ClientTimeout(total=60)) as ar:
        if ar.status != 200:
            return None
        return _wav_float_to_int16(await ar.read())


async def _replicate_tts(text: str, language: str) -> Optional[bytes]:
    """Replicate + chatterbox-multilingual: human, cloned voice. Chunks >300-char text and concatenates."""
    token = os.getenv("REPLICATE_API_TOKEN", "")
    if not token:
        return None
    ref = _replicate_reference()
    chunks = _chunk_text(text, 300)
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Prefer": "wait"}
    try:
        async with aiohttp.ClientSession() as session:
            version = await _replicate_version(session, headers)
            if not version:
                print("[TTS] Replicate: could not resolve model version")
                return None
            # Sequential (NOT parallel): Replicate throttles to "burst 1" when the account
            # has < $5 credit, so concurrent chunk predictions get 429'd → fallback to OpenAI.
            # Brief replies are usually 1 chunk anyway, so this costs us almost nothing.
            audios = []
            for ch in chunks:
                a = await _replicate_one(session, version, headers, ch, language, ref)
                if a:
                    audios.append(a)
            if not audios:
                return None
            try:
                return _concat_wav(audios)
            except Exception as e:
                print(f"[TTS] Replicate concat failed ({e}); returning first chunk")
                return audios[0]
    except Exception as e:
        print(f"[TTS] Replicate exception: {e}")
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
        # ElevenLabs failed (e.g. quota) -> fall through
    if os.getenv("REPLICATE_API_TOKEN"):
        audio = await _replicate_tts(text, language)
        if audio:
            return audio
        # Replicate failed -> fall back to OpenAI
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
