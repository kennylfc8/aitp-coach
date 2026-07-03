# 3D skeleton, SMOOTHED (no jitter). Two clips: (1) turntable of one pose -> see depth,
# (2) the stroke from a fixed angle -> see the motion. Headless, no window.
import matplotlib
matplotlib.use("Agg")
import numpy as np
import cv2
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation, FFMpegWriter
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

MODEL = "samples/pose_landmarker_heavy.task"
VIDEO = "samples/tennis_sample.mp4"
STEP = 2

# body bones (no loose face/hand dots)
CONN = [(11,12),(11,23),(12,24),(23,24),(11,13),(13,15),(12,14),(14,16),
        (23,25),(25,27),(24,26),(26,28),(27,31),(28,32),(15,17),(16,18),(0,11),(0,12)]
USED = sorted({i for c in CONN for i in c})

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
            raw.append([[p.x, p.z, -p.y] for p in w])  # plot coords: X=x, Y=depth, Z=up
    idx += 1
cap.release()
A = np.array(raw)  # (T,33,3)
print(f"collected {len(A)} poses")

# temporal smoothing (moving average) — kills the jitter
def smooth(arr, win=9):
    if len(arr) < win:
        return arr
    k = np.ones(win) / win
    out = arr.copy()
    for j in range(arr.shape[1]):
        for c in range(arr.shape[2]):
            out[:, j, c] = np.convolve(arr[:, j, c], k, mode="same")
    # fix edges (convolve 'same' dampens ends) by clamping to nearest good sample
    h = win // 2
    out[:h] = arr[:h]; out[-h:] = arr[-h:]
    return out
S = smooth(A, 9)

# contact ≈ peak right-wrist speed on smoothed data
wr = S[:, 16, :]
spd = np.linalg.norm(np.diff(wr, axis=0), axis=1)
contact = int(np.argmax(spd)) + 1

zmin = S[:, :, 2].min()
def style(ax):
    ax.set_xlim(-0.6, 0.6); ax.set_ylim(-0.6, 0.6); ax.set_zlim(zmin, zmin + 1.7)
    ax.set_box_aspect((1, 1, 1.5)); ax.set_axis_off(); ax.set_facecolor("#0b0d10")
    # faint floor grid for spatial reference
    g = np.linspace(-0.5, 0.5, 6)
    for t in g:
        ax.plot([t, t], [-0.5, 0.5], [zmin, zmin], color="#16361f", lw=.8)
        ax.plot([-0.5, 0.5], [t, t], [zmin, zmin], color="#16361f", lw=.8)

def draw_pose(ax, P):
    for a, b in CONN:
        ax.plot([P[a,0],P[b,0]], [P[a,1],P[b,1]], [P[a,2],P[b,2]], color="#c8ff00", lw=3)
    ax.scatter(P[USED,0], P[USED,1], P[USED,2], c="#39ff14", s=26, depthshade=False)

# clip 1: turntable of the contact pose (no jitter — single frozen smoothed pose)
fig = plt.figure(figsize=(6, 7)); ax = fig.add_subplot(111, projection="3d")
P0 = S[contact]
def t_draw(i):
    ax.cla(); style(ax); draw_pose(ax, P0); ax.view_init(elev=8, azim=i * 3)
FuncAnimation(fig, t_draw, frames=120, interval=33).save(
    "samples/skeleton_3d_turntable.mp4", writer=FFMpegWriter(fps=30, codec="libx264"),
    dpi=110, savefig_kwargs={"facecolor": "#0b0d10"})
print("saved turntable")

# clip 2: the stroke, smoothed, fixed camera (gentle ±12° sway only)
fig2 = plt.figure(figsize=(6, 7)); ax2 = fig2.add_subplot(111, projection="3d")
def m_draw(i):
    ax2.cla(); style(ax2); draw_pose(ax2, S[i])
    ax2.view_init(elev=8, azim=-62 + 12 * np.sin(i / len(S) * 2 * np.pi))
FuncAnimation(fig2, m_draw, frames=len(S), interval=33).save(
    "samples/skeleton_3d_motion.mp4", writer=FFMpegWriter(fps=30, codec="libx264"),
    dpi=110, savefig_kwargs={"facecolor": "#0b0d10"})
print("saved motion")
