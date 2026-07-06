"""
Thin backend proxy (BFF) for the 3D web app.

Hides API keys (Claude / TTS) from the browser and reuses the Python coach engine
(chat_with_coach + tts.generate_speech). React calls THIS; this calls Claude/OpenAI.

Run:  py -3.12 -m uvicorn server:app --port 8000 --reload
Docs: http://localhost:8000/docs  (auto Swagger)
"""

import os
import json
import time
import base64
import asyncio
import subprocess
import tempfile
from pathlib import Path
from datetime import datetime, timedelta

LOG_FILE = Path(__file__).parent / "web_debug.log"
RHUBARB = Path(__file__).parent / "tools" / "Rhubarb-Lip-Sync-1.14.0-Windows" / "rhubarb.exe"

# Load .env BEFORE importing the coach modules (they build clients at import time)
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from src.models import PlayerModel
from src.coach_brain import chat_with_coach, analyze_technique
from src.tts import generate_speech
from src.dashboard import build_dashboard

app = FastAPI(title="AI Tennis Coach API")

# CORS: let the Vite dev server (5173) call us (8000). Like @CrossOrigin in Spring.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def demo_player() -> PlayerModel:
    """Placeholder profile for the web MVP. Its real fields feed the dashboard (/player).
    Swap for a stored/looked-up player once web auth exists."""
    now = datetime.now()
    return PlayerModel(
        user_id=0, name="Player", level="intermediate", experience_years=4,
        language="EN", strengths=["forehand"], weaknesses=["backhand", "consistency"],
        current_focus="backhand", utr_value=4.0, utr_confidence=80,
        target_utr=4.5, target_date=(now + timedelta(weeks=12)).strftime("%Y-%m-%d"),
        streak=14,
        skill_ratings={
            "forehand": 8.0, "backhand": 4.5, "serve": 5.5, "return": 6.0,
            "volley": 5.0, "movement": 7.0, "consistency": 4.0, "power": 6.5,
            "tactics": 5.5, "mental": 5.0, "fitness": 6.5,
        },
        created_at=now, updated_at=now,
    )


class ChatIn(BaseModel):
    text: str
    history: list = []


class TTSIn(BaseModel):
    text: str


class LogIn(BaseModel):
    event: str
    data: dict = {}


class TechniqueIn(BaseModel):
    stroke: str = "forehand"
    hand: str = "right"
    metrics: dict = {}


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/warmup")
@app.get("/warmup")
async def warmup():
    """Boot/keep the Replicate TTS model warm (it scales to zero after ~minutes idle,
    and a cold start costs ~40s). The web app pings this on load + periodically so the
    user's real replies hit a warm model (~4s)."""
    t0 = time.time()
    ok = False
    try:
        ok = bool(await generate_speech("Go.", "EN"))
    except Exception as e:
        print("[warmup]", e)
    return {"ok": ok, "ms": int((time.time() - t0) * 1000)}


@app.post("/log")
def web_log(body: LogIn):
    """Browser-side debug events land here so the dev can read what happened (mic, clicks, errors)."""
    line = json.dumps(
        {"ts": datetime.now().strftime("%H:%M:%S"), "event": body.event, "data": body.data},
        ensure_ascii=False,
    )
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")
    print("[web]", line)
    return {"ok": True}


@app.get("/player")
def player():
    """Real dashboard data (UTR, today's plan, weak zones, progress bars). Deterministic, no LLM."""
    return build_dashboard(demo_player())


@app.post("/analyze-technique")
def analyze_technique_ep(body: TechniqueIn):
    """Biomechanics metrics (from the in-browser skeleton) -> coach's technique breakdown (Claude)."""
    text = analyze_technique(body.metrics, body.stroke, body.hand, demo_player().language)
    return {"analysis": text}


@app.post("/chat")
def chat(body: ChatIn):
    """Text -> coach reply (Claude, with the fiery persona + player context)."""
    reply = chat_with_coach(demo_player(), body.text, body.history, brief=True)
    return {"reply": reply}


def rhubarb_cues(audio: bytes, dialog_text: str) -> list:
    """WAV/OGG bytes -> Rhubarb mouth-shape timeline [[start, shape], ...].
    'phonetic' recognizer: language-agnostic (our replies are often RU).
    Returns [] on any failure — the web falls back to realtime FFT lipsync."""
    if not RHUBARB.exists() or audio[:4] not in (b"RIFF", b"OggS"):
        return []
    ext = ".wav" if audio[:4] == b"RIFF" else ".ogg"
    tmp = out_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
            f.write(audio)
            tmp = f.name
        out_path = tmp + ".json"
        # NB: rhubarb's stdout comes up empty when piped on Windows — use -o file
        cmd = [str(RHUBARB), "-r", "phonetic", "-f", "json", "-q",
               "--extendedShapes", "GHX", "-o", out_path, tmp]
        out = subprocess.run(cmd, capture_output=True, timeout=60)
        if out.returncode != 0:
            print("[rhubarb]", out.stderr.decode(errors="replace")[:300])
            return []
        with open(out_path, encoding="utf-8") as f:
            data = json.load(f)
        return [[round(c["start"], 3), c["value"]] for c in data.get("mouthCues", [])]
    except Exception as e:
        print("[rhubarb]", e)
        return []
    finally:
        for p in (tmp, out_path):
            if p:
                try: os.unlink(p)
                except OSError: pass


@app.post("/tts")
async def tts(body: TTSIn):
    """Text -> JSON {audio: base64, media, cues}. Cues = Rhubarb phoneme-timed mouth
    shapes for accurate lipsync; empty cues -> browser uses realtime FFT fallback."""
    audio = await generate_speech(body.text, "EN")
    if not audio:
        return Response(status_code=503, content=b"")
    head = audio[:4]
    media = "audio/ogg" if head == b"OggS" else "audio/wav" if head == b"RIFF" else "audio/mpeg"
    provider = "replicate-CLONE" if head == b"RIFF" else "openai-FALLBACK"
    t0 = time.time()
    cues = await asyncio.to_thread(rhubarb_cues, audio, body.text)
    rb_ms = int((time.time() - t0) * 1000)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(
                {"ts": datetime.now().strftime("%H:%M:%S"), "event": "tts-provider",
                 "data": {"provider": provider, "media": media, "bytes": len(audio),
                          "cues": len(cues), "rhubarb_ms": rb_ms}},
                ensure_ascii=False) + "\n")
    except Exception:
        pass
    print(f"[TTS] served by {provider} ({media}, {len(audio)}b, {len(cues)} cues in {rb_ms}ms)")
    return {"audio": base64.b64encode(audio).decode(), "media": media, "cues": cues}
