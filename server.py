"""
Thin backend proxy (BFF) for the 3D web app.

Hides API keys (Claude / TTS) from the browser and reuses the Python coach engine
(chat_with_coach + tts.generate_speech). React calls THIS; this calls Claude/OpenAI.

Run:  py -3.12 -m uvicorn server:app --port 8000 --reload
Docs: http://localhost:8000/docs  (auto Swagger)
"""

import os
from pathlib import Path
from datetime import datetime

# Load .env BEFORE importing the coach modules (they build clients at import time)
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from src.models import PlayerModel
from src.coach_brain import chat_with_coach
from src.tts import generate_speech

app = FastAPI(title="AI Tennis Coach API")

# CORS: let the Vite dev server (5173) call us (8000). Like @CrossOrigin in Spring.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def demo_player() -> PlayerModel:
    """Placeholder profile for the web MVP. Step 5 swaps in the real player."""
    now = datetime.now()
    return PlayerModel(
        user_id=0, name="Игрок", level="intermediate", experience_years=4,
        language="RU", strengths=["forehand"], weaknesses=["backhand", "consistency"],
        current_focus="backhand", utr_value=6.7, utr_confidence=80,
        target_utr=7.5, streak=14, created_at=now, updated_at=now,
    )


class ChatIn(BaseModel):
    text: str
    history: list = []


class TTSIn(BaseModel):
    text: str


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/chat")
def chat(body: ChatIn):
    """Text -> coach reply (Claude, with the fiery persona + player context)."""
    reply = chat_with_coach(demo_player(), body.text, body.history)
    return {"reply": reply}


@app.post("/tts")
async def tts(body: TTSIn):
    """Text -> speech audio bytes (OpenAI by default; MiniMax/ElevenLabs if keyed)."""
    audio = await generate_speech(body.text, "RU")
    if not audio:
        return Response(status_code=503, content=b"")
    media = "audio/ogg" if audio[:4] == b"OggS" else "audio/mpeg"
    return Response(content=audio, media_type=media)
