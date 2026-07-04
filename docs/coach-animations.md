# Coach Animation Scenarios — CH28 × 40 Mixamo clips

Source clips: `3dModels/anims/*.fbx` (40, Without Skin, 30fps, CH28 rig — no retarget needed).
Playback: one AnimationMixer, crossfade ~0.3s between states; one-shot clips return to IDLE.

## 1) Core loop (always running)

| State | Clips | Logic |
|---|---|---|
| **IDLE** | `Idle` ⟷ `Breathing Idle` | default; swap every 20–40s for variety |
| micro-life | `Looking Around` | once per ~60s of idle, then back |
| long user inactivity (5+ min) | `Drinking` → `Plank`/`Situps` | "коуч попил воды и тренируется сам" 😄 then IDLE |

## 2) Session lifecycle

| Event | Sequence |
|---|---|
| **App start** | spawn off-center → `Walking` to center → `Standing Greeting` → IDLE |
| onboarding finished | `Salute` → IDLE ("принят в работу") |
| user returns after days away | `Waving` → `Happy Idle` → IDLE |
| session end / «пока» in chat | `Quick Formal Bow` → IDLE |

## 3) Speech (TTS playing) — base + keyword gestures

Base while speaking: **`Talking`** (loop). Keyword in the reply text switches a one-shot
gesture layered mid-speech, then back to `Talking`:

| Reply contains (RU/EN) | Gesture |
|---|---|
| praise: молодец, отлично, great, nice, good job | `Clapping` |
| hype: погнали, вперёд, let's go, come on | `Fist Pump` / `Yelling` |
| instruct: смотри, фокус, watch, look, focus | `Pointing Gesture` |
| correction: нет, не так, стоп, don't, wrong | `Shaking Head No` |
| agreement: да, именно, exactly, right | `Head Nod Yes` |
| uncertainty: возможно, depends, зависит | `Shrugging` |
| joke / 😄 in reply | `Laughing` |

User pressed REC (starts talking): coach holds IDLE, on user's phrase end → quick `Head Nod Yes` ("услышал").

## 4) Data events (from the engine)

| Event | Sequence |
|---|---|
| check-in done / streak +1 | `Victory` → `Fist Pump` → IDLE |
| big milestone (NTRP target hit) | `Hip Hop Dancing` → `Victory` → IDLE (rare wow) |
| exceptional result | `Backflip` (once, спецсобытие) |
| skipped workout / bad check-in | `Defeated` → `Sad Idle` (30s) → IDLE |
| ambitious new goal set (+1.0 NTRP) | `Excited` → IDLE |
| backend error | `Shrugging` → `Sad Idle` briefly |

## 5) Plan demonstrations (click a TODAY.SESSION row → coach demos it)

| Plan item | Clip |
|---|---|
| WARMUP | `Warming Up` |
| stretch-type items | `Arm Stretching` / `Neck Stretching` |
| JUMPING JACKS | `Jumping Jacks` |
| AIR SQUAT | `Air Squat` |
| BURPEE | `Burpee` |
| PUSH UP / SITUPS / PLANK | `Push Up` / `Situps` / `Plank` |
| LIVE POINTS | `Boxing` (боевой настрой) |
| footwork items | `Running` (in place) / `Jump` |
| serve-ish placeholder | `Baseball Pitching` (замах-бросок) |
| swing placeholder | `Golf Drive` |
| throw drill | `Throw Object` |

⚠️ Real tennis strokes (forehand/backhand/serve) are NOT in Mixamo — they arrive later from
pro slow-mo video via our own extractor (docs/3d-technique-analysis.md). Golf/Pitching are
temporary stand-ins clearly labeled in UI.

## 6) Implementation notes
- Convert: FBX → GLB per clip (fbx2gltf), strip to animation tracks; merge into `web/public/coach_anims.glb`
  bundles (or lazy per-clip fetch). Rig names identical to CH28 → clips apply directly.
- State machine in `CoachChar3D`: `state` prop driven by `useCoach` (speaking / events) +
  keyword scanner on the reply text; crossFadeTo(0.3), one-shots via `LoopOnce` + `clampWhenFinished`
  → chain back to IDLE on `finished` event.
- Grip: finger curls + racquet stay parented to the hand; clips animate arms/body — the racquet follows.
  (Exercise demos look fine with racquet; can auto-hide racquet during floor exercises.)
