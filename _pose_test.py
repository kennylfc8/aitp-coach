"""Local CPU capture. Exports all candidates; downstream analysis uses the web JS.

Legacy: python _pose_test.py samples/pose_landmarker_heavy.task
Controlled baseline: add --legacy (old 30 Hz / first 400 sampling).
"""
import argparse
import bisect
import json
import math
import time
from pathlib import Path

import cv2
import av
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("legacy_model", nargs="?")
    parser.add_argument("--model")
    parser.add_argument("--video", default="samples/tennis_sample.mp4")
    parser.add_argument("--fps", type=float, default=30)
    parser.add_argument("--max-frames", type=int, default=1200)
    parser.add_argument("--num-poses", type=int, default=1)
    parser.add_argument("--output", default="samples/pose-stability/capture.json")
    parser.add_argument("--legacy", action="store_true")
    args = parser.parse_args()
    if not math.isfinite(args.fps) or args.fps <= 0 or args.max_frames < 1:
        parser.error("fps and max-frames must be positive")
    model = args.model or args.legacy_model or "samples/pose_landmarker_heavy.task"
    started = time.perf_counter()
    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        raise ValueError("Cannot open video")
    fps = cap.get(cv2.CAP_PROP_FPS)
    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if fps <= 0 or count <= 0:
        raise ValueError("Invalid video timing")
    # OpenCV frame indices are useful identities, but count/fps loses MP4 edit-list
    # offsets. Read the real PTS using PyAV; keep OpenCV's automatic rotation.
    with av.open(args.video) as container:
        timestamps = [float(frame.time) for frame in container.decode(video=0)]
    if len(timestamps) != count or any(b <= a for a, b in zip(timestamps, timestamps[1:])):
        raise ValueError("Decoded PTS/frame-index correspondence is not one-to-one")
    duration = count / fps if args.legacy else timestamps[-1] + 1 / fps
    total = min(args.max_frames, max(1, math.ceil(duration * args.fps)))
    grid = [i / args.fps if args.legacy else i * duration / total for i in range(total)]
    width, height = (int(cap.get(p)) for p in (cv2.CAP_PROP_FRAME_WIDTH, cv2.CAP_PROP_FRAME_HEIGHT))
    options = vision.PoseLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=model),
        running_mode=vision.RunningMode.VIDEO, num_poses=args.num_poses)
    init_start = time.perf_counter()
    samples, seen = [], set()
    decode_ms = inference_ms = 0
    def points(landmarks):
        return [{k: getattr(p, k) for k in ("x", "y", "z", "visibility", "presence")
                 if getattr(p, k, None) is not None} for p in landmarks]
    try:
        with vision.PoseLandmarker.create_from_options(options) as landmarker:
            init_ms = (time.perf_counter() - init_start) * 1000
            for requested in grid:
                target = min(duration - 0.000001, requested + min(0.001, duration / total / 4))
                frame_id = min(count - 1, int(requested * fps + 1e-6)) if args.legacy else max(0, bisect.bisect_right(timestamps, target) - 1)
                if frame_id in seen:
                    continue
                tick = time.perf_counter()
                cap.set(cv2.CAP_PROP_POS_FRAMES, frame_id)
                ok, frame = cap.read()
                if not ok:
                    raise ValueError(f"Decode failed at {frame_id}")
                actual_id = int(cap.get(cv2.CAP_PROP_POS_FRAMES)) - 1
                if actual_id != frame_id:
                    raise ValueError(f"Decoder returned {actual_id}, expected {frame_id}")
                seen.add(frame_id)
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                decode_ms += (time.perf_counter() - tick) * 1000
                tick = time.perf_counter()
                media_t = frame_id / fps if args.legacy else timestamps[frame_id]
                result = landmarker.detect_for_video(image, round(media_t * 1000))
                inference_ms += (time.perf_counter() - tick) * 1000
                samples.append({"sampleIndex": len(samples), "requestedT": target, "t": media_t,
                    "decodedId": frame_id, "timestampSource": "legacy-index" if args.legacy else "pyav-pts-opencv-index",
                    "poses": [{"joints": points(w), "imageJoints": points(n)} for w, n in
                              zip(result.pose_world_landmarks, result.pose_landmarks)]})
    finally:
        cap.release()
    data = {"schemaVersion": 1, "samples": samples, "meta": {
        "video": Path(args.video).name, "duration": duration, "width": width, "height": height,
        "sourceFps": fps, "requestedFps": args.fps, "effectiveFps": len(samples) / duration,
        "firstDecodedT": samples[0]["t"] if samples else None, "lastDecodedT": samples[-1]["t"] if samples else None,
        "seeks": len(samples), "uniqueDecoded": len(samples), "inferenceCount": len(samples),
        "dedupCount": total - len(samples), "numPoses": args.num_poses,
        "model": Path(model).name, "version": mp.__version__, "delegate": "CPU", "runtime": "Python/OpenCV",
        "legacy": args.legacy, "modelInitMs": init_ms, "decodeMs": decode_ms, "inferenceMs": inference_ms,
        "processingMs": decode_ms + inference_ms, "totalMs": (time.perf_counter() - started) * 1000}}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, allow_nan=False), encoding="utf-8")
    print(json.dumps({"output": str(output), "samples": len(samples), "duration": duration,
                      "processingMs": round(decode_ms + inference_ms)}))


if __name__ == "__main__":
    main()
