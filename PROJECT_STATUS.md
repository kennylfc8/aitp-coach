# PROJECT STATUS — AI Tennis Coach

> **Read this first.** The other root `.md` files (README, QUICKSTART, COMPLETE_SYSTEM,
> DETAILED_ASSESSMENT, …) describe an OLD 15-question assessment and are **stale**.
> This file + `git log` reflect reality. Repo: github.com/kennylfc8/aitp-coach (remote `origin`;
> `gitlab` = backup). Run on Windows; Python 3.12 via `py -3.12`. Secrets in `.env` (gitignored).

## Two apps in one repo
1. **Telegram bot** (Python / aiogram) — root `src/`. The working product.
2. **3D web app** (React + R3F) — `web/`. New, steps 1–2 done (skeleton). This is where active work is heading.

---

## 1) Telegram bot (`src/`) — WORKING, committed & pushed
Flow: `/start` → name → **adaptive UTR funnel** (tiers 0–3, opt-in depth) → **weekly schedule** (court/solo/gym/match) → `/goal` → periodized program. Plus free-form coach chat + two-way voice + live YouTube videos.

Key files:
- `main.py` — entry; **loads `.env` BEFORE importing bot** (coach_brain builds the Anthropic client at import); logs to `logs/bot.log`; update-logging middleware.
- `bot.py` — all handlers. Commands: `/start /plan /checkin /matchlog /retest /goal /program /profile /schedule /schedule_setup /videos /voice /en /ru`. Non-command text/voice → free chat (`_coach_chat`). **Mirror modality:** voice in → voice out, text in → text out.
- `funnel.py` — question bank + `question_label` ("Блок 2/4 …", not scary "N/36").
- `utr.py` — deterministic UTR estimate + confidence + **credibility caps** (years/tournament; matches override) + `refine_with_match`.
- `periodization.py` — `build_program` (macro/meso/micro) + `assess_goal` (feasibility warning).
- `training_schedule.py` — `build_sessions_from_counts` etc.
- `coach_brain.py` — Claude calls: `generate_daily_plan`, `analyze_checkin`, `update_player_model`, `chat_with_coach`, `get_coach_persona` (fiery/tough-love, occasional mild swear).
- `tts.py` — provider layer (priority + graceful fallback): **OpenAI** (default, voice `ash`, steered fiery delivery) → MiniMax → ElevenLabs → OpenAI. `_minimax_tts`, `_elevenlabs_tts`.
- `stt.py` — Whisper (OpenAI). `youtube.py` — live YouTube Data API search + ranking + trusted-channel fallback. `videos.py` — legacy curated list, now unused.
- `test_flow.py` — offline harness (~50 checks, stubs Claude/TTS). `simulate_cases.py` — 10 personas → `test_cases/`.

Run: `py -3.12 -m src.main` (one instance only — multiple → TelegramConflictError).
Tests: `PYTHONIOENCODING=utf-8 py -3.12 test_flow.py` → expect `ALL GOOD`.

Env (`.env`): `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `YOUTUBE_API_KEY`.
Optional/parked: `MINIMAX_*` (commented — needs $25 min top-up), `ELEVENLABS_API_KEY` (self-serve free tier).

### Gotchas (cost real time before)
- The `@router.message(F.text)` catch-all MUST exclude commands: `F.text & ~F.text.startswith("/")`, else it shadows later command handlers (silent no-response). Handler registration order matters.
- `.env` not loading → bot can't auth. Load it first in `main.py`.

## Voice / TTS situation
- **OpenAI TTS works** (account funded). Whisper STT works.
- **MiniMax** Speech 2.6 HD: great + has clone (`clone_voice.py`), BUT API needs **$25 min recharge** (no trial; confirmed across 3 endpoints) → parked, keys commented in `.env`.
- **Fish Audio**: pay-as-you-go but API access = "Contact Sales" → not self-serve.
- **ElevenLabs**: the real self-serve path — free tier (~10 min) for API, $5 Starter for cloning. Wired in `tts.py`, not keyed yet.
- Voice cloning needs **consent** of the voice owner.

---

## 2) 3D web app (`web/`) — skeleton (steps 1–2), NOT yet polished
Stack: React + Vite + React Three Fiber (Three.js) + @react-three/drei + `wawa-lipsync`. SPA, plain JS, plain CSS. Dark + lime (#c8ff00) tennis theme.

Done:
- **Step 1** — shell: R3F scene, centered coach avatar (procedural **placeholder** = "clown" scaffold), mock dashboard (right), controls bar (bottom).
- **Step 2** — lip-sync: "Тест речи" plays `web/public/coach_test.mp3`, avatar mouth moves via wawa-lipsync (15 visemes, language-agnostic, works on RU).

Files: `src/App.jsx` (layout) → `components/CoachCanvas → Experience → Avatar` (+ `Dashboard`, `Controls`), `src/lipsync.js`, `src/visemes.js`.

Run: `cd web && npm install && npm run dev` → http://localhost:5173

### Target layout (agreed mockup)
3 zones: **left = План на сегодня** (done/todo checklist + weak zones) · **center = 3D coach** (lip-sync) · **right = Прогресс/статы** (UTR, bars, video) · **bottom = mic (push-to-talk) + chat input**. Mobile: stacked, panels become tabs (План/Прогресс/Видео). Current code = center + right only; left "План" panel still to add.

### Next steps (NOT done)
- **Step 3** — chat: input → Claude → TTS → audio → lip-sync. Build a **thin backend proxy** (e.g. FastAPI) that hides the Claude key and **reuses `coach_brain.chat_with_coach`** from the Python side.
- **Step 4** — voice: browser Web Speech API (STT) → full speech-to-speech.
- **Step 5** — real data in dashboard (pull UTR/program from the Python engine).
- **Real avatar**: export GLB from **Avaturn** (ARKit blendshapes) → `web/public/avatar.glb` → drive `viseme_<key>` morph targets in `Avatar.jsx`. (Ready Player Me is dead — closed 2026-01-31.)
- **Design pass LAST**: current visuals are scaffold ("clown"); polish UI + avatar only after functionality works, using the mockup as the blueprint.

---

## Suggested next action
Build web **step 3** (functional chat→voice→lip-sync) via a thin FastAPI proxy reusing `chat_with_coach`. Polish/design comes after.
