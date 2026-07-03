# Export smoothed 3D serve motion (our own mocap) -> web/public/motion_serve.json
# Window around the contact (peak wrist speed) so the web avatar loops a clean serve.
import json
import math
import numpy as np
import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

MODEL = "samples/pose_landmarker_heavy.task"
VIDEO = "samples/tennis_sample.mp4"
OUT = "web/public/motion_serve.json"
STEP = 2

opts = vision.PoseLandmarkerOptions(
    base_options=python.BaseOptions(model_asset_path=MODEL),
    running_mode=vision.RunningMode.VIDEO, num_poses=1)
lm = vision.PoseLandmarker.create_from_options(opts)

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
raw = []
idx = 0
while True:
    ok, frame = cap.read()
    if not ok:
        break
    if idx % STEP == 0:
        res = lm.detect_for_video(
            mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)),
            int(idx * 1000 / fps))
        if res.pose_world_landmarks:
            w = res.pose_world_landmarks[0]
            raw.append([[p.x, p.y, p.z] for p in w])
    idx += 1
cap.release()
A = np.array(raw)
print("poses:", A.shape)

# temporal smoothing (same as renders)
def smooth(arr, win=9):
    k = np.ones(win) / win
    out = arr.copy()
    for j in range(arr.shape[1]):
        for c in range(arr.shape[2]):
            out[:, j, c] = np.convolve(arr[:, j, c], k, mode="same")
    h = win // 2
    out[:h] = arr[:h]; out[-h:] = arr[-h:]
    return out
S = smooth(A, 9)

# contact = peak right-wrist speed; export a window around it
# (skip unsmoothed edges — they spike and fake a "contact" at frame 1)
wr = S[:, 16, :]
spd = np.linalg.norm(np.diff(wr, axis=0), axis=1)
E = 12
contact = int(np.argmax(spd[E:-E])) + E + 1
a, b = max(0, contact - 70), min(len(S), contact + 50)
W = S[a:b]
print(f"contact {contact}, window {a}..{b} ({len(W)} frames)")

data = {
    "fps": round(fps / STEP, 2),
    "contact": contact - a,
    "frames": [[[round(float(v), 3) for v in joint] for joint in fr] for fr in W],
}
with open(OUT, "w") as f:
    json.dump(data, f, separators=(",", ":"))
print("saved", OUT, f"({len(json.dumps(data)) // 1024} KB)")
