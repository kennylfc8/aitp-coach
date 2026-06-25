# TESTING — pending manual checks

> Living checklist of things to verify by hand (mostly the 3D web app voice pipeline).
> Claude keeps this updated as features land. Date format: absolute.

## How to run the web app
```
py -3.12 -m uvicorn server:app --port 8000      # backend proxy
cd web && npm run dev                            # frontend (http://localhost:5173)
```
Debug log of browser events: `web_debug.log` (written by the `/log` endpoint).
Provider of each TTS reply is logged there too: `tts-provider: replicate-CLONE` (good)
vs `openai-FALLBACK` (clone failed → fell back).

---

## 🔴 PENDING — must test

### 1. Web voice E2E (the big one) — NOT YET CONFIRMED BY USER
Wired + verified at API level (a clean `/tts` call returns `replicate-CLONE`, WAV), but the
user hasn't done the in-browser end-to-end test yet.
- [ ] Hard reload `localhost:5173` (Ctrl+Shift+R).
- [ ] Send ONE message (`How do I fix my backhand?`) by text → Отправить.
- [ ] Reply text appears (short, 1–2 sentences).
- [ ] `🔊…` indicator shows while synthesizing.
- [ ] **Cloned voice plays** (the user's own voice, NOT OpenAI "ash").
- [ ] **Lips move** on the avatar during playback.
- [ ] `web_debug.log` shows `tts-provider: replicate-CLONE` and `audio-played {ctx: running}`.
- ⚠️ Caveat (low Replicate credit < $5): limit is 6 req/min, **burst 1** → send ONE at a
  time, don't spam. First call after idle = cold start (~40s); warm ≈ 4s.

### 2. Mic / voice input
Mic was flaky (the Windows audio device disappeared mid-session, then came back).
- [ ] Click 🎤 → allow → speak English → transcript recognized → coach answers by voice.
- [ ] If no mic: clear error shows ("Нет доступа к микрофону: ...").

### 3. Long-reply chunking + concat
- [ ] Elicit a long reply; confirm the **whole** thing plays (chunks concatenated, not cut at
  ~300 chars). int16 concat path in `tts._concat_wav`.

### 4. Latency / warmup / cost
- [ ] Warm call ≈ 4–5s; confirm the 3-min warmup keeps it warm during a session.
- [ ] Keep an eye on Replicate credit drain from warmups (each ping = a real run).

### 5. Telegram bot regression (don't break the working product)
`chat_with_coach` gained a `brief` param (default False). The web proxy passes `brief=True`;
the bot must be unaffected.
- [ ] `PYTHONIOENCODING=utf-8 py -3.12 test_flow.py` → `ALL GOOD`.
- [ ] Live bot: text in → text out, voice in → voice out, commands respond.

### 6. 3D technique analyzer (NEW — built, not yet tested with a real clip)
"Техника 3D" tab → upload a **240fps** side-on stroke clip. All in-browser (MediaPipe), nothing uploads.
- [ ] Upload a real 240fps forehand/serve → progress bar → 3D skeleton appears.
- [ ] Skeleton **rotates** with mouse (OrbitControls), timeline scrubs, slow-mo (0.15–1×) plays.
- [ ] Judge quality: is hip/shoulder rotation + contact timing readable? Jitter level? (This decides
  whether Level B paid mocap is needed — see `docs/3d-technique-analysis.md`.)
- [ ] Try a bad clip (30fps / front-on) to confirm the error hint shows.
- [ ] **Level B**: pick hand+stroke → "🧠 Разобрать технику" → metrics panel fills (shoulder/hip
  turn, X-factor, elbow, knee, contact) + Claude verdict appears (~10–15s, Opus) + 3D parks on the
  detected contact frame. Sanity-check the numbers against what the skeleton visibly does.
- ⚠️ First open downloads the model (~10 MB) + WASM from CDN → needs internet, first run slower.
- ⚠️ Analysis metrics are approximate (monocular). Decide later if Level B (4–5) paid mocap is worth it.

---

## 🟡 LATER / backlog
- [ ] **Russian voice** — stress is wrong with Chatterbox. Try RUAccent auto-stress, else a
  RU-native TTS. See PROJECT_STATUS.md backlog. Test clip: `coach_clone_ru_stress.wav`.
- [ ] **Real avatar** (Avaturn GLB) lip-sync via `viseme_*` morph targets.
- [ ] **3D technique analysis** feasibility (DeepMotion/Rokoko, 240fps). See
  `docs/3d-technique-analysis.md`.

---

## ✅ Verified (this session)
- **Dashboard (Step 5)** — `/player` returns real deterministic data; the web right-panel
  renders it correctly (UTR 6.7→7.5 · 12 нед · 🔥14, plan from weak zones, weak tags, bars).
  Confirmed in-browser via Playwright, 0 console errors.
- **Video → 3D skeleton (Level A pose pipeline)** — validated HEADLESS (no browser window) via
  Python MediaPipe Tasks, SAME `pose_landmarker_full` 0.10.35 model as the web, on a real iPhone
  slow-mo serve (`samples/tennis_sample.mp4`, 1080p/30fps/20s): **100% frame coverage, 0.94 avg
  visibility**; skeleton overlays the body accurately at windup + contact. So the web "Техника 3D"
  tab will produce equally good skeletons. (Browser UI render still unverified due to no-window
  constraint, but the hard part — pose extraction — is proven. Repro: `_pose_test.py`.)

## 🔧 TODO surfaced by testing
- **Metrics windowing/unwrap** — on a 20s multi-action clip, `metrics.js` reported shoulder/hip
  "turn" = 360° (angle wraps via atan2 + whole-serve motion + monocular z-noise). Real uploads are
  ONE short stroke so it's usually fine, but make metrics robust: window around the contact frame
  and unwrap angles before taking the range.

## ✅ Verified at API level (this session)
- `/chat` returns a short coach reply (brief mode) — ~2.5s.
- `/tts` returns int16 PCM WAV from the **clone** (`replicate-CLONE`) — warm ≈ 4s, cold ≈ 40s.
- float32 → int16 conversion (fixes browser "хрюканье" + enables concat).
- Viseme key fix (`viseme_*`) — animation wiring corrected (visual confirm still pending, item 1).
