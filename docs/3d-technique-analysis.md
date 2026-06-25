# Feature (BACKLOG): 3D technique analysis — "как бью я" vs "идеальная техника"

Status: **MVP "Level A" BUILT (in-browser pose skeleton).** Spec below stays as the north star
(compare-vs-ATP + Claude biomechanics). What's done vs pending:

- ✅ **Level A — free, in-browser, no API**: `web/src/pose.js` (MediaPipe Tasks Vision, WASM,
  33 metric-3D `worldLandmarks`/frame) + `components/PoseViewer.jsx` (rotatable skeleton,
  OrbitControls, grid) + `components/Technique.jsx` (upload → progress → 3D skeleton + timeline +
  slow-mo). Toggled via the **"Техника 3D"** tab in the topbar. Video never leaves the browser.
  Lazy-loaded (MediaPipe out of the coach bundle). Builds clean; **needs real-clip quality test**.
- ✅ **Level B (1–3) BUILT**: biomechanics metrics from the skeleton (`web/src/metrics.js`:
  shoulder/hip turn, X-factor, elbow, knee bend, contact height + contact-frame detection via
  peak wrist speed) → `POST /analyze-technique` → **Claude (Opus) coach breakdown** (what's good /
  what lags vs ideal / 2–3 concrete fixes). UI: hand+stroke selectors, metrics panel, verdict.
  The "compare vs ideal ATP" is done *qualitatively by Claude* (sidesteps proprietary pro-mocap).
  Verified end-to-end (real Claude output reads the numbers correctly).
- ⏳ **Level B (4) — smooth mannequin, do it FREE (TODO)**: retarget our existing 33 MediaPipe
  world-landmarks onto a **rigged humanoid GLB** in R3F (drive bone rotations from the joints) →
  a smooth 3D figure instead of the stick skeleton, **$0, no account**. Needs: a free rigged GLB
  (Mixamo / ReadyPlayerMe-style) + a joint→bone retarget pass + bone-space rotation math.
  Paid mocap (Rokoko $20/mo, DeepMotion ~$9/mo, Move.ai ~$2.50/min) is **cosmetic only** — it buys
  denoising, NOT new coaching info — so try free retargeting first; pay only if joints are too noisy.
- ⏳ **Level B (5, later)**: racquet tracking (separate object detection → contact point / head path).

### Pose-accuracy quality ladder (user prioritizes quality >> convenience)
Single-cam MediaPipe (both **full** and **heavy** tested headless via `_pose_test.py` on a real
iPhone slow-mo serve) tracks the body at 100% coverage. The **full** model DROPS the fast, extended
**racquet arm at contact** (frame 312 — collapsed to torso); **heavy RECOVERS it** (reaches the
racquet) and is steadier (shoulder turn 160° vs full's wrapped 360°). → **web now defaults to heavy**
(`web/src/pose.js`; ~30MB model, slower load/inference, worth it). Still single-cam (depth guessed),
so bigger leaps remain. Upgrade paths, UX-preserving first:
- **NEXT (agreed, DEFERRED — "потом"): SOTA single-cam** — TRAM (2024) / WHAM: full 3D SMPL mesh
  from ONE video, handles fast motion + occlusion far better than MediaPipe. Runs on GPU (Replicate
  per-compute, or self-host). **Keeps the 1-phone UX.** Plan: run on `samples/tennis_sample.mp4`,
  compare the racquet arm vs MediaPipe. Check Replicate for a hosted WHAM/TRAM/4D-Humans model first.
- **DIY 2-cam** — 2×MediaPipe (per video) + OpenCV calibration + time-sync + `cv2.triangulatePoints`.
  Free, OpenCV already installed; cost = writing calibration/sync + 2-phone UX. Crude variant: fuse
  the two per-camera `worldLandmarks` by confidence (no full triangulation).
- **Move.ai 2-cam** — turnkey multi-iPhone markerless, ~$15–20/mo.

Test harness: `_pose_test.py <model.task>` — headless (no browser/window) pose smoke test →
coverage %, visibility, contact frame, annotated `samples/_pose_<model>_<frame>.png`.

## Concept
User uploads a video of a forehand / backhand / serve → system converts the motion to a 3D
animation (video-to-mocap: DeepMotion, Rokoko Vision, or similar) → shows TWO gray mannequins
side by side in the browser (Three.js / R3F): a reference ATP stroke vs the user's stroke.
User can orbit the camera, slow down, step frame-by-frame, compare. AI (Claude) reads the
biomechanics (footwork, hip/torso rotation, elbow position, contact point, kinetic-chain
sequencing) and gives personalized fixes. MVP = ready-made tennis mocap + plain gray mannequin,
no fancy graphics. Goal: the player literally SEES their technique vs the ideal, then gets advice.

## ⚠️ Critical recording requirement (de-risks the #1 problem)
**Tell the user to film at 240 fps minimum (slow-mo).** Tennis strokes are explosive → at 30/60 fps
there's heavy motion blur and too few frames, which wrecks pose/mocap. The target market
(mid-class+) has phones with good slow-mo (e.g. iPhone 15 Pro). Guidance to show users:
- 240 fps slow-mo (or higher), good lighting,
- side-on angle (court-side), full body in frame, ideally a second angle later,
- one clean stroke per clip.

## Risks / hard parts (validate before building)
1. **Video → accurate 3D mocap of fast strokes** — the linchpin. 240 fps helps a lot, but still test.
2. **Racquet isn't tracked** by body-mocap → contact point / racquet-head path may be missing.
   May need separate object tracking for the racquet.
3. **Single-camera 3D depth noise** → hip/shoulder rotation estimates can be unreliable (the exact
   thing we want to analyze).
4. **Reference "ideal ATP" data** is a content problem — real pro mocap is proprietary; generic
   tennis animations are NOT biomechanically validated ideals.
5. **Alignment/normalization** user vs reference (body size, timing, handedness, camera) for a fair
   frame-by-frame compare is non-trivial.

## ✅ What's easy (we're well-positioned)
- Dual-mannequin compare in Three.js / R3F (orbit, slow-mo, frame scrub, timeline) — we already have R3F.
- Biomechanics metrics from joint data (angles, timing, sequencing) — geometry, if mocap is clean.
- Claude turns metrics → coaching feedback — coach persona already exists.

## Recommended MVP order (de-risked)
1. **Compare shell** on our R3F: two mannequins playing canned clips (reference + a pre-processed
   sample "user" clip) + orbit/slow-mo/frame-step + a MOCK analysis panel. Validates UX value cheaply.
2. **Pilot video→mocap**: run a REAL 240 fps forehand through DeepMotion AND Rokoko trials, judge
   output quality (jitter? is rotation visible? usable for metrics?). Decide 3D vs fallback.
3. **Fallback if 3D is too noisy**: 2D pose (MediaPipe / MoveNet) overlay "your pose vs reference" —
   far more robust, cheaper, often enough for coaching.
4. Real biomechanics metrics + Claude analysis.

## 🧪 TODO — feasibility test (do this first, ~1 hour)
- [ ] Record one forehand at **240 fps**, side-on.
- [ ] Run it through **DeepMotion** (trial) → export GLB/FBX → inspect 3D animation quality.
- [ ] Run the SAME clip through **Rokoko Vision** (trial) → compare.
- [ ] Judge: is the 3D clean enough to read hip/shoulder rotation + contact timing? Jitter level?
- [ ] Decision: full 3D mocap vs 2D-pose overlay fallback.
- [ ] Cost check: per-clip price + any monthly minimum on the chosen mocap service.

## Cost/infra notes
DeepMotion / Rokoko = paid (subscription / per-clip credits) + video storage/processing. Estimate
on volume before committing.
