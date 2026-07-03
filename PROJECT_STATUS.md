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

### Next steps
- ✅ **Step 3 + 4 DONE** — `server.py` (FastAPI proxy: `/chat`, `/tts`, CORS) + `web/Controls.jsx`
  wire type/voice → Claude → TTS → lip-sync. Run: `py -3.12 -m uvicorn server:app --port 8000` + `cd web && npm run dev`.
- **Voice upgrade (in progress)** — moving TTS to **Replicate + `resemble-ai/chatterbox-multilingual`**
  for a human, cloned, Russian voice that's cheap at scale (per-compute, not per-character;
  permissive license; same model self-hostable later). Need `REPLICATE_API_TOKEN` + a voice sample;
  wire `_replicate_tts` into `tts.py`. (ElevenLabs/MiniMax/Fish parked — too expensive at "30 min/day/user".)
- ✅ **Step 5 DONE** — real data in the dashboard via `GET /player` (`src/dashboard.py`,
  deterministic, **no LLM** → instant): UTR/target/weeks/streak, today's plan built from the
  player's weak dims (drill bank), weak-zone tags, progress bars from `skill_ratings`.
  `Dashboard.jsx` fetches it. Verified in-browser (Playwright): 0 console errors.
- ✅ **Terminal Pro redesign LIVE** — implemented from the user's Claude Design handoff
  (`# AI Tennis Coach Terminal/design_handoff_web_terminal/README.md`): topbar (tabs+KPIs),
  coach viewport, dense right panel (ASCII meters), command line. `useCoach.js` hook owns
  chat/voice; `CoachViewport/CommandLine/Dashboard` components. IBM Plex Mono, green+lime tokens.
- ✅ **NTRP (not UTR) on the web surface** — ratings shown as NTRP 1.5–7.0
  (self-rateable, USTA-style). Engine/bot internals still UTR-scaled (convert later).
- ✅ **Onboarding funnel** (`onboarding.js` + `Onboarding.jsx`, localStorage profile):
  QUICK (pick level) / HELP-ME-DETERMINE / DETAILED (12 skippable strokes) → NTRP computed
  **weakest-link** (USTA principle), live NTRP readout, flexible target slider. ⟳ in topbar re-runs.
- ✅ **INK SUMI-E coach avatar** (user picked style #20 of 20 mockups, `mockups/avatar_20.png`):
  rice-paper stage + brush-drawn player animated from **our own mocap serve**
  (`web/public/motion_serve.json`, exported by `_export_motion.py`), boiling strokes ~11fps,
  ink splatter on fast phases, red sun pulses while the coach speaks (`InkCoach.jsx`).
  Old CSS orb removed from viewport (Controls/CoachCanvas/Avatar components now unused — cleanup later).
- ⚠️ Known polish debt: coach chat still uses the backend demo player (not the onboarding
  profile); mixed RU/EN copy (terminal EN, technique/onboarding RU); technique tab styling.
- **Real avatar**: Avaturn GLB → `web/public/avatar.glb` → drive `viseme_<key>` morph targets. (Ready Player Me is dead.)
- **Design pass LAST**: current visuals are scaffold; 3 direction mockups exist (`mockups/`). Polish after functionality.

### Pending manual tests
See [`docs/TESTING.md`](docs/TESTING.md) — living checklist. Top item: the **web voice E2E**
(hear the cloned voice + lips move in the browser) is wired & API-verified but **not yet
confirmed in-browser by the user**.

### Backlog / future ideas
- **3D technique analysis** — Level A (in-browser 3D skeleton) + Level B 1–3 (biomechanics metrics
  + Claude breakdown) **BUILT**; see [`docs/3d-technique-analysis.md`](docs/3d-technique-analysis.md).
  - **TODO: free smooth mannequin** — retarget the existing 33 MediaPipe joints onto a rigged
    humanoid GLB in R3F (drive bone rotations). **$0, no paid mocap.** Paid services (DeepMotion/
    Rokoko/Move.ai) are cosmetic-only → try free retargeting first. Needs a free rigged GLB.
  - Later: racquet tracking; optionally voice the technique verdict with the cloned coach voice.
- **Russian voice** — current TTS is **Replicate + Chatterbox with a cloned voice (forClone.mp3)**;
  works great in **English** (product is English-first for now). Russian **word stress is wrong**
  (Chatterbox isn't RU-native; clone from an EN sample worsens it). Fix to try: auto-stress the RU
  text with **RUAccent** (combining-accent marks) before TTS — IF Chatterbox honors marks (a
  stress-marked test clip exists: `coach_clone_ru_stress.wav`). Else use a RU-native TTS (Silero/Yandex,
  but lose cloning). Voice env: `REPLICATE_API_TOKEN`, `REPLICATE_VOICE_SAMPLE` in `.env`.

---

## Suggested next action
Finish the **voice upgrade** (Replicate + Chatterbox clone), then web **step 5** (real data). Design + 3D-analysis come later.
