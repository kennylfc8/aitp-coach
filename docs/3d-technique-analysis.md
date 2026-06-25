# Feature (BACKLOG): 3D technique analysis — "как бью я" vs "идеальная техника"

Status: **MVP "Level A" BUILT (in-browser pose skeleton).** Spec below stays as the north star
(compare-vs-ATP + Claude biomechanics). What's done vs pending:

- ✅ **Level A — free, in-browser, no API**: `web/src/pose.js` (MediaPipe Tasks Vision, WASM,
  33 metric-3D `worldLandmarks`/frame) + `components/PoseViewer.jsx` (rotatable skeleton,
  OrbitControls, grid) + `components/Technique.jsx` (upload → progress → 3D skeleton + timeline +
  slow-mo). Toggled via the **"Техника 3D"** tab in the topbar. Video never leaves the browser.
  Lazy-loaded (MediaPipe out of the coach bundle). Builds clean; **needs real-clip quality test**.
- ⏳ **Level B (later)**: clean mocap mesh (DeepMotion/Rokoko), reference ATP mannequin compare,
  Claude biomechanics feedback, racquet tracking. The risks/feasibility notes below still apply.

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
