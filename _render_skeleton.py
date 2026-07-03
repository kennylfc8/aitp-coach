# Render the FULL moving skeleton over the clip -> one mp4 you can open in any player.
# Headless (no browser/window). Uses the heavy MediaPipe model.
import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

MODEL = "samples/pose_landmarker_heavy.task"
VIDEO = "samples/tennis_sample.mp4"
OUT = "samples/skeleton_overlay.mp4"

CONN = [  # body skeleton
    (11, 12), (11, 23), (12, 24), (23, 24),                     # torso
    (11, 13), (13, 15), (12, 14), (14, 16),                     # arms
    (15, 17), (15, 19), (15, 21), (16, 18), (16, 20), (16, 22), # hands
    (23, 25), (25, 27), (24, 26), (26, 28),                     # legs
    (27, 29), (29, 31), (27, 31), (28, 30), (30, 32), (28, 32), # feet
]

opts = vision.PoseLandmarkerOptions(
    base_options=python.BaseOptions(model_asset_path=MODEL),
    running_mode=vision.RunningMode.VIDEO, num_poses=1)
lm = vision.PoseLandmarker.create_from_options(opts)

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
writer = cv2.VideoWriter(OUT, cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H))

idx = 0
while True:
    ok, frame = cap.read()
    if not ok:
        break
    res = lm.detect_for_video(
        mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)),
        int(idx * 1000 / fps))
    if res.pose_landmarks:
        v = res.pose_landmarks[0]
        pts = [(int(l.x * W), int(l.y * H)) for l in v]
        for a, b in CONN:
            cv2.line(frame, pts[a], pts[b], (0, 255, 200), 3)
        for p in pts:
            cv2.circle(frame, p, 5, (0, 255, 0), -1)
    writer.write(frame)
    idx += 1

cap.release()
writer.release()
print(f"rendered {idx} frames -> {OUT}")
