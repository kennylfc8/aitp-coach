"""
Speech-to-Text module using Whisper.
Transcribes voice messages from Telegram into text.
"""

import os
import aiohttp
import asyncio
from typing import Optional


OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")  # For Whisper API


async def transcribe_voice(voice_data: bytes) -> Optional[str]:
    """
    Transcribe voice data using OpenAI Whisper API.

    Args:
        voice_data: Raw audio bytes from Telegram voice message

    Returns:
        Transcribed text or None if failed
    """

    if not OPENAI_API_KEY:
        print("[STT] No OpenAI API key configured. Skipping transcription.")
        return None

    url = "https://api.openai.com/v1/audio/transcriptions"
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}

    try:
        async with aiohttp.ClientSession() as session:
            data = aiohttp.FormData()
            data.add_field('file', voice_data, filename='voice.ogg', content_type='audio/ogg')
            data.add_field('model', 'whisper-1')
            data.add_field('language', 'ru')  # Default to Russian

            async with session.post(
                url,
                headers=headers,
                data=data,
                timeout=aiohttp.ClientTimeout(total=60)
            ) as resp:
                if resp.status == 200:
                    result = await resp.json()
                    return result.get('text')
                else:
                    print(f"[STT] Whisper error: {resp.status}")
                    return None

    except Exception as e:
        print(f"[STT] Exception: {e}")
        return None


async def transcribe_voice_local(voice_path: str) -> Optional[str]:
    """
    Transcribe voice using local Whisper (requires ffmpeg).
    Fallback if OpenAI API not available.
    """
    try:
        import subprocess
        import json

        result = subprocess.run(
            ["whisper", voice_path, "--output_format", "json", "--language", "ru", "--quiet"],
            capture_output=True,
            text=True
        )

        if result.returncode == 0:
            data = json.loads(result.stdout)
            return data.get('text')

    except Exception as e:
        print(f"[STT] Local Whisper error: {e}")

    return None
