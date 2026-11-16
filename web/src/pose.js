// Local-only video decoding and MediaPipe inference. Each call owns its VIDEO state.
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { sampleGrid, adaptGrid, normalizeSamples } from './poseSampling.js';
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task';
export const POSE_CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS;
const aborted = signal => { if (signal?.aborted) throw new DOMException('Отменено', 'AbortError'); };

export async function getPoseLandmarker({ numPoses = 1, delegate, wasm = WASM, model = MODEL } = {}) {
  const vision = await FilesetResolver.forVisionTasks(wasm);
  const make = delegate => PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: model, delegate }, runningMode: 'VIDEO', numPoses,
  });
  if (delegate) return { landmarker: await make(delegate), delegate };
  try { return { landmarker: await make('GPU'), delegate: 'GPU' }; }
  catch { return { landmarker: await make('CPU'), delegate: 'CPU' }; }
}

function metadata(video, signal, start, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const visibility = video.ownerDocument ?? document;
    let timer = null, activeSince = null, remainingMs = timeoutMs;
    const finish = error => {
      clearTimeout(timer); video.removeEventListener('loadedmetadata', loaded);
      video.removeEventListener('error', failed); signal?.removeEventListener('abort', cancel);
      visibility.removeEventListener('visibilitychange', onVisibility);
      if (error) reject(error); else resolve();
    };
    const loaded = () => finish();
    const failed = () => finish(new Error('Не удалось открыть видео'));
    const cancel = () => finish(new DOMException('Отменено', 'AbortError'));
    // A hidden tab may defer media loading; count only visible time.
    const onVisibility = () => {
      clearTimeout(timer);
      if (activeSince != null) remainingMs -= performance.now() - activeSince;
      activeSince = null;
      if (!visibility.hidden) {
        activeSince = performance.now();
        timer = setTimeout(() => finish(new Error('Истекло время загрузки видео')), Math.max(0, remainingMs));
      }
    };
    visibility.addEventListener('visibilitychange', onVisibility);
    onVisibility();
    video.addEventListener('loadedmetadata', loaded); video.addEventListener('error', failed);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel(); else start();
  });
}

// requestVideoFrameCallback metadata identifies a decoded media frame, unlike currentTime.
const decodedFrames = new WeakMap();
export function seekDecoded(video, t, signal, timeoutMs = 5000) {
  if (signal?.aborted) return Promise.reject(new DOMException('Отменено', 'AbortError'));
  const cached = decodedFrames.get(video);
  // Chromium need not present another frame when seeking to the exact paused
  // position. Reuse only metadata already confirmed for this source/position.
  if (cached && !video.seeking && video.readyState >= 2 && video.currentTime === t &&
      cached.position === t && cached.source === video.currentSrc) return Promise.resolve({ ...cached.frame });
  return new Promise((resolve, reject) => {
    let callback = null, settled = false, seeked = false, decoded = null;
    const visibility = video.ownerDocument ?? document;
    let timer = null, activeSince = null, remainingMs = timeoutMs;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (callback != null) video.cancelVideoFrameCallback(callback);
      video.removeEventListener('seeked', onSeeked); video.removeEventListener('error', failed);
      visibility.removeEventListener('visibilitychange', onVisibility);
      signal?.removeEventListener('abort', cancel);
      if (error) reject(error);
      else {
        decodedFrames.set(video, { source: video.currentSrc, position: video.currentTime, frame: result });
        resolve(result);
      }
    };
    const complete = () => {
      if (!seeked) return;
      if (video.requestVideoFrameCallback) {
        if (decoded && Number.isFinite(decoded.mediaTime)) finish(null, { t: decoded.mediaTime,
          decodedId: `media:${decoded.mediaTime.toFixed(9)}`, timestampSource: 'video-frame-callback' });
      } else if (video.readyState >= 2) finish(null, { t, decodedId: null, timestampSource: 'requested-approximate' });
    };
    const onSeeked = () => { seeked = true; complete(); };
    const failed = () => finish(new Error('Ошибка декодирования видео'));
    const cancel = () => finish(new DOMException('Отменено', 'AbortError'));
    // Frame presentation may pause in a hidden tab. Count only visible time,
    // retaining the pending decoded callback and cancellation while suspended.
    const onVisibility = () => {
      clearTimeout(timer);
      if (activeSince != null) remainingMs -= performance.now() - activeSince;
      activeSince = null;
      if (!visibility.hidden) {
        activeSince = performance.now();
        timer = setTimeout(() => finish(new Error('Истекло время декодирования кадра')), Math.max(0, remainingMs));
      }
    };
    visibility.addEventListener('visibilitychange', onVisibility);
    onVisibility();
    video.addEventListener('seeked', onSeeked); video.addEventListener('error', failed);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }
    if (video.requestVideoFrameCallback) callback = video.requestVideoFrameCallback((_, info) => { decoded = info; complete(); });
    video.currentTime = t;
  });
}

export async function processVideo(file, { onProgress, fps = 30, maxFrames = 1200, signal,
  adaptive = true, targetMs = 60000, numPoses = 1, delegate, wasm, model } = {}) {
  const started = performance.now();
  let landmarker, url;
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto';
  // Offscreen but rendered: Chromium can suppress frame callbacks on detached media.
  video.style.cssText = 'position:fixed;left:-2px;top:-2px;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(video);
  try {
    aborted(signal); url = URL.createObjectURL(file);
    await metadata(video, signal, () => { video.src = url; });
    const requestedFps = fps, exact = !!video.requestVideoFrameCallback;
    if (!exact) fps = Math.min(30, fps);
    let grid = sampleGrid(video.duration, fps, maxFrames);
    const init = performance.now();
    const created = await getPoseLandmarker({ numPoses, delegate, wasm, model });
    landmarker = created.landmarker;
    const modelInitMs = performance.now() - init;
    aborted(signal);
    const samples = [], seen = new Set();
    let decodeMs = 0, inferenceMs = 0, seeks = 0, dedupCount = 0, adapted = false;
    const processing = performance.now();
    for (let i = 0; i < grid.length; i++) {
      aborted(signal);
      let tick = performance.now();
      // Seek just inside an interval: decimal media PTS can round a boundary
      // backwards (e.g. 1/30 vs 0.033333), silently losing every third frame.
      const requestedT = Math.min(video.duration - 0.000001, grid[i] + Math.min(0.001, video.duration / grid.length / 4));
      const frame = await seekDecoded(video, requestedT, signal);
      decodeMs += performance.now() - tick; seeks++;
      aborted(signal);
      if (frame.decodedId != null && seen.has(frame.decodedId)) { dedupCount++; }
      else {
        if (samples.length && frame.t <= samples.at(-1).t) throw new Error('Декодер вернул немонотонное время');
        tick = performance.now();
        const result = landmarker.detectForVideo(video, frame.t * 1000);
        inferenceMs += performance.now() - tick;
        const point = p => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? null,
          ...(p.presence == null ? {} : { presence: p.presence }) });
        samples.push({ sampleIndex: samples.length, requestedT, ...frame,
          poses: (result.worldLandmarks || []).map((joints, n) => ({ joints: joints.map(point), imageJoints: (result.landmarks[n] || []).map(point) })) });
        if (frame.decodedId != null) seen.add(frame.decodedId);
      }
      if (adaptive && !adapted && samples.length >= 12) {
        const next = adaptGrid(grid, i + 1, performance.now() - processing, targetMs);
        adapted = true; grid = next;
      }
      onProgress?.((i + 1) / grid.length);
      // Yield so cancel/new upload can run between synchronous WASM calls.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    aborted(signal);
    return { schemaVersion: 1, samples: normalizeSamples(samples), meta: {
      duration: video.duration, width: video.videoWidth, height: video.videoHeight, sourceFps: null,
      firstDecodedT: samples[0]?.t ?? null, lastDecodedT: samples.at(-1)?.t ?? null,
      requestedFps, effectiveFps: samples.length / video.duration, seeks,
      uniqueDecoded: exact ? seen.size : null, inferenceCount: samples.length, dedupCount, numPoses,
      model: 'heavy', version: '0.10.35', delegate: created.delegate, runtime: 'browser',
      timing: exact ? 'decoded' : 'approximate; dedup unavailable; limited to 30 samples/s',
      adaptive: grid.length < sampleGrid(video.duration, fps, maxFrames).length,
      modelInitMs, decodeMs, inferenceMs, processingMs: performance.now() - processing,
      totalMs: performance.now() - started,
    } };
  } finally {
    landmarker?.close(); video.pause(); video.removeAttribute('src'); video.load(); video.remove();
    if (url) URL.revokeObjectURL(url);
  }
}

// Only in Vite development. The QA runner supplies a File through a local file input.
if (import.meta.env.DEV) window.__poseQA = { processVideo, seekDecoded };
