# Headless smoke test: video -> skeleton, using the SAME MediaPipe Tasks PoseLandmarker
# (+ same float16 model) the web app uses. No browser, no window — terminal + saved PNGs.
import math
import sys
import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

MODEL = sys.argv[1] if len(sys.argv) > 1 else "samples/pose_landmarker.task"
TAG = "heavy" if "heavy" in MODEL else "lite" if "lite" in MODEL else "full"
VIDEO = "samples/tennis_sample.mp4"

BODY = [(11, 12), (11, 13), (13, 15), (12, 14), (14, 16), (11, 23), (12, 24),
        (23, 24), (23, 25), (25, 27), (27, 31), (24, 26), (26, 28), (28, 32),
        (15, 17), (16, 18)]

opts = vision.PoseLandmarkerOptions(
    base_options=python.BaseOptions(model_asset_path=MODEL),
    running_mode=vision.RunningMode.VIDEO,
    num_poses=1,
)
landmarker = vision.PoseLandmarker.create_from_options(opts)

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

frames = detected = 0
vis_sum = 0.0
norm = {}          # idx -> [(x,y)]*33  (image-normalized, for drawing)
wrist = []         # (idx, x, y) right wrist
sh_ang, hip_ang = [], []
g = lambda a, b: math.degrees(math.atan2(b[2] - a[2], b[0] - a[0]))  # ground angle from world lms

idx = 0
while True:
    ok, frame = cap.read()
    if not ok:
        break
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    res = landmarker.detect_for_video(img, int(idx * 1000 / fps))
    if res.pose_landmarks:
        detected += 1
        lms = res.pose_landmarks[0]
        vis_sum += sum(l.visibility for l in lms) / len(lms)
        norm[idx] = [(l.x, l.y) for l in lms]
        wrist.append((idx, lms[16].x, lms[16].y))
        if res.pose_world_landmarks:
            w = res.pose_world_landmarks[0]
            P = lambda i: (w[i].x, w[i].y, w[i].z)
            sh_ang.append(g(P(11), P(12)))
            hip_ang.append(g(P(23), P(24)))
    idx += 1
frames = idx
cap.release()

cov = detected / frames * 100 if frames else 0
avg_vis = vis_sum / detected if detected else 0
contact, mx = None, -1
for i in range(1, len(wrist)):
    s = math.hypot(wrist[i][1] - wrist[i - 1][1], wrist[i][2] - wrist[i - 1][2])
    if s > mx:
        mx, contact = s, wrist[i][0]
rng = lambda a: (max(a) - min(a)) if a else 0

print(f"video        : {W}x{H} @ {fps:.0f}fps, {frames} frames ({frames/fps:.1f}s)")
print(f"skeleton     : {detected}/{frames} = {cov:.0f}% coverage")
print(f"avg visibility: {avg_vis:.2f}  (1.0 = very confident)")
print(f"contact frame: {contact}  (peak wrist speed)")
print(f"shoulder turn: {rng(sh_ang):.0f}deg   hip turn: {rng(hip_ang):.0f}deg  (world lms)")

# Save annotated frames (no window) so we can eyeball skeleton quality.
targets = sorted({t for t in [int(frames * 0.25), contact, int(frames * 0.7)] if t in norm})
cap = cv2.VideoCapture(VIDEO)
idx, saved = 0, []
while True:
    ok, frame = cap.read()
    if not ok:
        break
    if idx in targets:
        pts = [(int(x * W), int(y * H)) for (x, y) in norm[idx]]
        for a, b in BODY:
            cv2.line(frame, pts[a], pts[b], (0, 255, 200), 3)
        for p in pts:
            cv2.circle(frame, p, 5, (0, 255, 0), -1)
        out = f"samples/_pose_{TAG}_{idx}.png"
        cv2.imwrite(out, frame)
        saved.append(out)
    idx += 1
cap.release()
print("annotated:", ", ".join(saved))
