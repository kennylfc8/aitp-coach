# Feature (BACKLOG): 3D technique analysis — "как бью я" vs "идеальная техника"

> September 2026 stabilization implementation, measurements and limitations are
> recorded in the final section. Earlier roadmap statements are historical.

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

## Stabilization — September 2026

Technique now captures the whole clip, associates candidate players and repairs
short gaps before smoothing. The raw/smoothed switch preserves media time and the
viewer canvas. Main metrics always use smoothed data, even in raw view. Player and
hand changes recompute locally. Cancellation, upload replacement, unmount and
selection changes invalidate pending processing/coaching responses. Video,
images and trajectories are not submitted to the summary endpoint.

Sampling defaults to 30 requests/s, with an optional 60 mode and 1,200-sample cap.
The cap changes spacing over the entire clip, never truncates the tail. A pilot
of 12 unique observations may reduce the remaining rate toward a soft 60-second
processing budget. Each independent pass creates/closes a heavy MediaPipe VIDEO
task (0.10.35), retaining GPU→CPU fallback. Decoded frame callback timestamps
identify duplicate frames; similar images are not deleted. Without callbacks,
timing is approximate and requests are capped at 30/s. The UI reports actual rate,
adaptation and timing limitations; requested rate is not source fps.

The supplied indoor MOV is upright 1080×1920, 165 frames, 5.5 s. The outdoor MP4
contains 600 frames at 30 fps, but **23 seconds of media time with its first frame
at 3 s**. Treating it as a zero-based 20-second timeline loses that offset. Both
clips contain 30-fps decoded streams: 60 requests/s yields the same observations.
A generated stationary 240-fps video retained all 240 distinct timestamps, but
this is a decoder test, not validation of real high-fps tennis motion.

### Method and defaults

Default filter: **Savitzky–Golay, unweighted degree-2 regression in actual time,
radius ±0.10 s** (7 points at uniform 30 fps). Asymmetric edge windows are fitted;
missing data and segment boundaries reset smoothing. One-Euro remains available
in the harness: tested settings are minCutoff/beta 1.5/0.3 and 2/1, dCutoff=1 Hz.
Both methods use the same repaired input.

Validity requires finite coordinates and visibility ≥0.5, plus presence when
provided. Hampel/MAD (±2/30 s, k=3, floor 0.05 m) rejects isolated returning
excursions. Speed thresholds (30 m/media-s for wrists/elbows, 12 otherwise) flag
suspect observations, but do not erase coherent fast travel. Only internal gaps
bounded within 0.10 s in the same segment are interpolated. Restored joints are
amber in the viewer, retain provenance and cannot establish reliable contact or
metric anchors. Missing geometry displays `—`; raw coordinates remain immutable.

Two candidates (updated after the fix-round comparison below) are associated using image-space boxes, center, scale, IoU and
torso points. Lost intervals use seconds: continuity buffer 0.5 s, conservative
reacquisition up to 3 s into a new segment. Ambiguity produces missing data or a
new track. All confirmed short tracks remain selectable. This is not full reID;
multiple fragments can represent one person.

Speeds use dt-weighted derivatives and media time, not an inferred physical
slow-motion scale. Shoulder/hip angles unwrap within reliable continuous runs;
an unobserved stretch of ≤0.10 s (outlier, interpolation, low visibility) is
bridged by the shortest angular increment, only a longer gap or a segment change
starts a new run. Before this, a single missing sample truncated the turn (outdoor
serve: shoulders 36° instead of 127°). If the contact run starts less than 1.0 s
before contact, `quality.incompleteAngles` is set and the UI marks the rotation
rows «неполный участок». X-factor uses the shortest angle difference. Contact remains an estimate from
observed wrist motion (minimum peak 0.6 m/media-s), not ball/racket detection.

### Initial implementation measurements and filter choice

Seeded stationary noise is evaluated by mean speed. A clean 8 m/s Gaussian
velocity pulse (sigma 40 ms) plus noise checks timing, peak and amplitude;
a curved overhead swing is tested separately. Default SG results:

| Rate | Stationary jitter reduction | Contact shift | Retained peak | Retained amplitude |
|---|---:|---:|---:|---:|
| 30 Hz | 3.31× | 0 samples | 84.4% | 102.2% |
| 60 Hz | 7.00× | 0 samples | 82.0% | 102.0% |

One-Euro 2/1 also passes, with one sample of delay and 79.7%/83.9% peak retention.
One-Euro 1.5/0.3 loses too much peak speed; SG ±2/30 s fails the 3× stationary
target at 30 Hz. SG ±0.10 s passes both rates without synthetic contact delay.

Real jitter is **RMS acceleration, m/media-s²**, including real motion. These CPU
comparisons use the same observed-triple mask across raw(1), raw(3), repaired and
both filters; full denominators and quiet-window measurements are archived.

| Clip / requested rate | Raw(1) | Raw(3) | Euro 1.5/0.3 | Euro 2/1 | SG ±2/30 | SG ±0.10 |
|---|---:|---:|---:|---:|---:|---:|
| Indoor / 30 | 42.52 | 72.53 | 16.52 | 24.33 | 32.92 | 21.84 |
| Indoor / 60 | 42.52 | 72.53 | 16.52 | 24.33 | 32.92 | 21.84 |
| Outdoor / 30 | 16.73 | 144.43 | 42.68 | 67.17 | 75.87 | 49.04 |
| Outdoor / 60 | 16.73 | 144.43 | 42.68 | 67.17 | 75.87 | 49.04 |

Indoor CPU raw(3)/smoothed(3) have insufficient reliable wrist data for contact.
Outdoor CPU contact changes from 8.53 s raw to 11.13 s after repair/SG; shoulder/hip
ranges change from 171°/355° to 118°/188°. These wrist estimates are not verified
racket–ball contact. The old first-400-frame outdoor capture ended at an artificial
frame time of 13.3 s and chose frame 49; it is not a ground-truth event.

Multiple candidates worsened the Python outdoor stream: the selected track has
310/600 observations with three poses versus 600/600 with one. Two poses retain
only 261/600 and do not recover indoor contact, so three remain the approved
default. **Multi-person output has not been shown to beat the old single-person
output.** Filtering cannot restore unreliable detections or anatomical accuracy.

Browser and Python detections differ. Controlled browser GPU captures gave indoor
raw→SG jitter 56.37→17.31, contact 3.97→3.93 s; outdoor 61.05→15.72, contact
12.03→9.33 s. That large outdoor displacement is a contact-estimation limitation,
not proof of improvement. Renderer: AMD Radeon 890M via ANGLE/D3D11, not SwiftShader.
Forced browser CPU processing also completed. Runtime, masks and model initialization
must be kept separate when comparing these measurements.

- [Indoor CPU trajectories and angles](img/pose-stability/indoor-3-30.svg)
- [Outdoor CPU trajectories and angles](img/pose-stability/outdoor-3-30.svg)
- [Indoor browser, 60 requests/s](img/pose-stability/indoor-browser-60.svg)
- [Outdoor browser, 30 requests/s](img/pose-stability/outdoor-browser-30.svg)

### Reproduction and remaining limits

Run `node --test web/tests/pose-pipeline.test.mjs` (or `npm run test:pose` inside
`web`). Python capture requires Python 3.12, MediaPipe 0.10.35, OpenCV and PyAV.
The exporter retains positional model-path support, reads real PTS using PyAV and
checks correspondence to OpenCV's rotated decoded frame indices. No application
dependencies were added.

```powershell
python _pose_test.py --model samples/pose_landmarker_heavy.task --video .collab/attachments/serve_indoor_IMG_2636_1080p30_5s.mov --fps 30 --num-poses 3 --output samples/pose-stability/indoor-3-30.json
node tools/pose_jitter.mjs --input samples/pose-stability/indoor-3-30.json --hand right --compare one-euro,savgol --output samples/pose-stability/indoor-3-30
# Optional --reference: numPoses=1 capture on the exact same decoded grid.
# Old truncated capture: --legacy --num-poses 1 --max-frames 400.
```

Browser capture uses an existing Playwright installation and Chromium, outside
application dependencies. Start the Vite server, then:

```powershell
node tools/pose_capture.mjs --url http://127.0.0.1:5173 --video .collab/attachments/serve_indoor_IMG_2636_1080p30_5s.mov --fps 60 --num-poses 3 --local-assets --playwright C:/path/to/playwright-core/index.mjs --output samples/pose-stability/indoor-browser-60.json
```

`--local-assets` serves the existing local heavy model and installed WASM files
through browser routing, without uploading the input file. Omit `--adaptive` for
fixed-grid comparisons; add it to exercise the UI budget. `--delegate CPU` forces
the CPU path. The QA hook is development-only and excluded from production.
Python MediaPipe logged a failed Clearcut telemetry attempt; this dependency log
is separate from browser network evidence.

Detailed measurements, baseline snapshots, runtime metadata and contact images
are in `.collab/attachments-derived/`, with verification/deviations in
`.collab/impl.notes.md`. Large captures stay ignored in `samples/pose-stability/`.
Real native high-fps serves, difficult crossings/occlusions, authenticated coaching
responses and a physical slow-motion time scale remain unverified. Monocular
depth, bone lengths and exact contact localization remain model limitations.
WHAM/TRAM remains a separate next-stage evaluation.

### Review fix round — September 27, 2026

The tables above describe the initial three-pose implementation. The current
default is **two poses + SG ±0.10 s**, following the approved conditional
comparison. Multi-person selection remains available. Three poses can still be
requested explicitly in the capture harness; a silent single-person fallback was
not introduced.

Association compares the same visible anchors in both detections, so losing the
legs does not halve only one matching box. Height gates scale; area is a soft
cost because turning changes projected width. Near-identical detections are
suppressed using overlap and torso agreement. Ambiguous candidates do not create
new player IDs, and already assigned pairs do not contribute to ambiguity.
Synthetic duplicate, crossing and >0.5-second leg-visibility-loss cases are covered.
Some real CPU fragments remain: this is not a claim of solved re-identification.

Short returning whole-torso excursions (including left/right reversal) now mark
the entire pose as outlier. The mean torso displacement must exceed 0.12 m and
return within the configured 0.10-second excursion; interpolation still requires
support points at most 0.10 seconds apart. Isolated wrist swings and sustained
motion are not rejected on speed alone.

Contact selection ranks supported local speed maxima. It does not select a
neighboring shoulder of an invalid maximum. The observed wrist neighborhood and
outlier checks remain conservative. For serves, the wrist must be above the
shoulder by at least half the measured arm length, with elbow angle ≥140°.
Available image landmarks must independently corroborate overhead extension;
image angles account for frame aspect ratio. These are conservative eligibility
checks, not technique targets or validated ball-contact detection. They can make
a real serve unavailable rather than send a preparation/glitch event to the coach.

Fresh browser captures used the same heavy model, AMD Radeon 890M / ANGLE GPU,
fixed requested 30 Hz and decoded grid for 1, 2 and 3 poses. Python rows below
reprocess the existing CPU captures with the final JS; Python inference was not
repeated. Each row uses one common observed-triple mask across its reference,
raw, repaired and all four filter variants. Values across rows have different
masks and must not be treated as the same experiment.

| Clip / runtime | Raw(1) jitter | Raw(2) jitter | SG(2) jitter | Shared triples | Selected frames | Contact estimate |
|---|---:|---:|---:|---:|---:|---|
| Indoor / Python CPU | 42.52 | 72.53 | 21.84 | 5,034 | 165/165 | 4.267 s |
| Outdoor / Python CPU | 18.69 | 64.08 | 16.29 | 16,485 | 579/600 | unavailable |
| Indoor / browser GPU | 41.13 | 56.32 | 17.28 | 5,022 | 165/165 | 4.267 s |
| Outdoor / browser GPU | 21.23 | 58.08 | 15.67 | 17,471 | 595/600 | 14.733 s |

Jitter units are m/media-s². The outdoor timeline still reaches 22.967 s. The
three-pose CPU alternative gave SG 19.65 versus reference 18.82 on its common mask,
so it was not retained as default. Two-pose browser processing took 9.45 s indoor
and 58.69 s outdoor; model initialization was approximately 0.46 s each. These
are local warm-asset measurements, not a performance guarantee.

Frame inspection places the new candidates in the overhead swing. Earlier
outdoor 7.5/9.33-second events are preparation and 13.7 seconds is a racket drop;
these are rejected. Exact racket–ball contact has not been annotated, so neither
4.267 nor 14.733 seconds should be reported as ground truth. CPU outdoor remains
unavailable and its analysis button is disabled. Raw single-pose browser is now
a measured comparison, but it is not a historical old-build browser capture.

Seek timeouts count visible-tab time only. Cancellation works while hidden and
cleans up visibility listeners. The timeout lifecycle is tested with controlled
visibility events; an actual >10-second user tab-switch run remains unverified.

Verification: 18 targeted Node tests, scoped ESLint and production web build;
current UI with recorded CPU/GPU captures verifies contact availability, A/B
time/metrics/canvas preservation, and no summary requests during switching.
The local `fix-*.report.json` reports also retain missing/interpolated counts,
all filter variants and runtime metadata. Reproduce the new comparison with the
same capture commands above using `--num-poses 2` and `--reference` pointing to a
matching one-pose capture. No exact-contact accuracy or complex real crossing
guarantee is implied by the jitter improvement.
