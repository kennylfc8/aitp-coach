// In-browser pose estimation: video File -> sequence of 3D skeletons. NO server, NO API.
// MediaPipe Tasks Vision (WASM) gives 33 body joints in metric 3D (worldLandmarks) per frame.
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

// Pin WASM to the installed JS version (0.10.35) to avoid JS<->WASM mismatch.
const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";

// Bone list (index pairs) for drawing the skeleton — static on the class.
export const POSE_CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS;

let _landmarker = null;

export async function getPoseLandmarker() {
  if (_landmarker) return _landmarker;
  const vision = await FilesetResolver.forVisionTasks(WASM);
  const make = (delegate) =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
    });
  try {
    _landmarker = await make("GPU");
  } catch {
    _landmarker = await make("CPU"); // some office machines / drivers lack WebGL2 GPU delegate
  }
  return _landmarker;
}

function seek(video, t) {
  return new Promise((res) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      res();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = Math.min(t, (video.duration || t) - 0.001);
  });
}

/**
 * Process a video File into pose frames.
 * @returns Array<{ t:number, joints:Array<{x,y,z,score}> }>  (joints length 33)
 * @param onProgress (0..1)
 * @param fps  how many frames/sec of the clip to sample (30 is plenty for viewing)
 * @param maxFrames cap so a long clip can't lock the tab
 */
export async function processVideo(file, { onProgress, fps = 30, maxFrames = 400 } = {}) {
  const landmarker = await getPoseLandmarker();

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = URL.createObjectURL(file);

  await new Promise((res, rej) => {
    video.onloadedmetadata = () => res();
    video.onerror = () => rej(new Error("Не удалось открыть видео"));
  });

  const duration = video.duration || 0;
  const step = 1 / fps;
  const total = Math.max(1, Math.min(maxFrames, Math.floor(duration / step)));
  const frames = [];
  let ts = 0;

  try {
    for (let i = 0; i < total; i++) {
      await seek(video, i * step);
      ts += step * 1000; // detectForVideo needs strictly increasing timestamps (ms)
      const result = landmarker.detectForVideo(video, ts);
      const lm = result.worldLandmarks && result.worldLandmarks[0];
      if (lm) {
        frames.push({
          t: i * step,
          joints: lm.map((p) => ({ x: p.x, y: p.y, z: p.z, score: p.visibility ?? 1 })),
        });
      }
      if (onProgress) onProgress((i + 1) / total);
    }
  } finally {
    URL.revokeObjectURL(video.src);
  }

  return frames;
}
