export const FILTER = Object.freeze({ method: "savgol", visibility: 0.5, maxGap: 0.10,
  hampelRadius: 2 / 30, hampelK: 3, outlierFloor: 0.05,
  fastSpeed: 30, bodySpeed: 12, radius: 0.10, degree: 2,
  minCutoff: 1.5, beta: 0.3, dCutoff: 1, poseExcursion: 0.12, poseExcursionSeconds: 0.10 });
export const finiteJoint = p => !!p && [p.x, p.y, p.z].every(Number.isFinite);
export const reliableJoint = (p, threshold = FILTER.visibility) => finiteJoint(p) &&
  Number.isFinite(p.visibility ?? p.score) && (p.visibility ?? p.score) >= threshold &&
  (p.presence == null || (Number.isFinite(p.presence) && p.presence >= threshold));
export const observedJoint = (frame, j) => reliableJoint(frame?.joints?.[j]) &&
  (!frame.provenance || frame.provenance[j] === "observed");
const axes = ["x", "y", "z"];
const distance = (a, b) => Math.hypot(...axes.map(k => a[k] - b[k]));
const median = values => { const v = [...values].sort((a, b) => a - b); return v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; };

export function validateTimeline(frames) {
  frames.forEach((f, i) => {
    if (!Number.isFinite(f.t) || (i && f.t <= frames[i - 1].t)) throw new Error("Pose times must strictly increase");
  });
}

function returningPoseOutliers(raw, config) {
  const rejected = new Set(), torso = [11, 12, 23, 24];
  const usable = f => torso.every(j => reliableJoint(f?.joints?.[j], config.visibility));
  const delta = (a, b) => torso.reduce((sum, j) => sum + distance(a.joints[j], b.joints[j]), 0) / torso.length;
  for (let start = 1; start < raw.length - 1; start++) {
    const before = raw[start - 1];
    if (!usable(before)) continue;
    for (let end = start; end < raw.length - 1; end++) {
      const after = raw[end + 1];
      if (raw[end].t - before.t > config.poseExcursionSeconds + 1e-8) break;
      const window = raw.slice(start, end + 2);
      if (window.some(f => !usable(f) || f.segmentId !== before.segmentId)) break;
      if (after.t - raw[end].t > config.maxGap + 1e-8) break;
      const excursion = Math.min(...window.slice(0, -1).flatMap(f => [delta(f, before), delta(f, after)]));
      // A short, whole-torso excursion must return near its origin. Wrist-only
      // overhead motion and sustained rotations are deliberately unaffected.
      if (excursion > config.poseExcursion && delta(before, after) < excursion * 0.5) {
        for (let n = start; n <= end; n++) rejected.add(n);
        break;
      }
    }
  }
  return rejected;
}

export function repairFrames(raw, options = {}) {
  const config = { ...FILTER, ...options };
  validateTimeline(raw);
  const frames = raw.map(f => ({ ...f, joints: Array.from({ length: 33 }, (_, j) => reliableJoint(f.joints?.[j], config.visibility) ? { ...f.joints[j] } : null),
    provenance: Array.from({ length: 33 }, (_, j) => reliableJoint(f.joints?.[j], config.visibility) ? "observed" : finiteJoint(f.joints?.[j]) ? "low-confidence" : "missing"),
    sourceConfidence: Array.from({ length: 33 }, (_, j) => ({ visibility: f.joints?.[j]?.visibility ?? f.joints?.[j]?.score ?? null, presence: f.joints?.[j]?.presence ?? null })) }));
  const stats = { observed: 0, missing: 0, lowConfidence: 0, outliers: 0, interpolated: 0, speedFlags: 0,
    originalMissing: frames.reduce((sum, f) => sum + f.provenance.filter(p => p !== "observed").length, 0),
    originalLowConfidence: frames.reduce((sum, f) => sum + f.provenance.filter(p => p === "low-confidence").length, 0) };
  const poseOutliers = returningPoseOutliers(raw, config);
  stats.poseOutlierFrames = poseOutliers.size;
  for (const i of poseOutliers) {
    frames[i].poseOutlier = true;
    frames[i].joints.forEach((p, j) => {
      if (p) { frames[i].joints[j] = null; frames[i].provenance[j] = "outlier"; stats.outliers++; }
    });
  }
  // Compute all outliers on original observations, so removal cannot cascade.
  for (let j = 0; j < 33; j++) {
    for (let i = 1; i < raw.length - 1; i++) {
      const f = raw[i], prev = raw[i - 1], next = raw[i + 1], p = f.joints?.[j];
      if (poseOutliers.has(i)) continue;
      if (![f, prev, next].every(v => reliableJoint(v.joints?.[j], config.visibility)) ||
          f.segmentId !== prev.segmentId || f.segmentId !== next.segmentId || next.t - prev.t > config.maxGap + 1e-8) continue;
      const a = prev.joints[j], b = next.joints[j];
      const v = distance(p, a) / (f.t - prev.t);
      if (v > ([13, 14, 15, 16].includes(j) ? config.fastSpeed : config.bodySpeed)) stats.speedFlags++;
      const neighbors = [];
      for (let n = i - 1; n >= 0 && f.t - raw[n].t <= config.hampelRadius + 1e-8; n--) {
        if (raw[n].segmentId !== f.segmentId) break;
        if (reliableJoint(raw[n].joints?.[j], config.visibility)) neighbors.push(raw[n].joints[j]);
      }
      for (let n = i + 1; n < raw.length && raw[n].t - f.t <= config.hampelRadius + 1e-8; n++) {
        if (raw[n].segmentId !== f.segmentId) break;
        if (reliableJoint(raw[n].joints?.[j], config.visibility)) neighbors.push(raw[n].joints[j]);
      }
      if (neighbors.length < 3) continue;
      const center = Object.fromEntries(axes.map(k => [k, median(neighbors.map(p => p[k]))]));
      const mad = median(neighbors.map(p => distance(p, center)));
      const threshold = Math.max(config.outlierFloor, config.hampelK * 1.4826 * mad);
      // An isolated excursion returns near its origin; coherent fast travel does not.
      if (distance(p, center) > threshold && Math.min(distance(p, a), distance(p, b)) > threshold &&
          distance(a, b) < Math.min(distance(p, a), distance(p, b)) * 0.5) {
        frames[i].joints[j] = null; frames[i].provenance[j] = "outlier"; stats.outliers++;
      }
    }
    let left = -1;
    for (let i = 0; i < frames.length; i++) {
      if (!frames[i].joints[j]) continue;
      if (left >= 0 && i > left + 1 && frames[i].segmentId === frames[left].segmentId &&
          frames[i].t - frames[left].t <= config.maxGap + 1e-8 &&
          frames.slice(left + 1, i).every(f => f.segmentId == null || f.segmentId === frames[left].segmentId)) {
        for (let n = left + 1; n < i; n++) {
          const ratio = (frames[n].t - frames[left].t) / (frames[i].t - frames[left].t);
          frames[n].joints[j] = Object.fromEntries(axes.map(k => [k, frames[left].joints[j][k] * (1 - ratio) + frames[i].joints[j][k] * ratio]));
          frames[n].provenance[j] = "interpolated";
          frames[n].segmentId = frames[left].segmentId;
          stats.interpolated++;
        }
      }
      left = i;
    }
  }
  frames.forEach(f => f.provenance.forEach(p => {
    if (p === "observed") stats.observed++;
    if (p === "low-confidence") stats.lowConfidence++;
    if (p === "missing" || p === "outlier" || p === "low-confidence") stats.missing++;
  }));
  return { frames, stats };
}

// Local unweighted least squares in actual time, centered/scaled for conditioning.
export function polynomialAt(points, t, degree = 2) {
  if (points.length <= degree) return null;
  const scale = Math.max(...points.map(p => Math.abs(p.t - t)));
  if (!scale) return null;
  const n = degree + 1, matrix = Array.from({ length: n }, () => Array(n + 1).fill(0));
  for (const p of points) {
    const x = (p.t - t) / scale;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) matrix[i][j] += x ** (i + j);
      matrix[i][n] += p.value * x ** i;
    }
  }
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++) if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j;
    [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
    if (Math.abs(matrix[i][i]) < 1e-10) return null;
    const divisor = matrix[i][i];
    for (let k = i; k <= n; k++) matrix[i][k] /= divisor;
    for (let j = 0; j < n; j++) if (j !== i) {
      const factor = matrix[j][i];
      for (let k = i; k <= n; k++) matrix[j][k] -= factor * matrix[i][k];
    }
  }
  return matrix[0][n];
}

export function smoothFrames(repaired, options = {}) {
  const config = { ...FILTER, ...options };
  validateTimeline(repaired);
  if (!["savgol", "one-euro"].includes(config.method)) throw new Error("Unknown pose filter");
  const output = repaired.map(f => ({ ...f, joints: f.joints.map(p => p ? { ...p } : null) }));
  const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
  for (let j = 0; j < 33; j++) {
    let start = 0;
    while (start < repaired.length) {
      if (!repaired[start].joints[j]) { start++; continue; }
      let end = start + 1;
      while (end < repaired.length && repaired[end].joints[j] && repaired[end].segmentId === repaired[start].segmentId &&
        repaired[end].t - repaired[end - 1].t <= config.maxGap + 1e-8) end++;
      for (const k of axes) {
        let value = repaired[start].joints[j][k], derivative = 0;
        for (let i = start; i < end; i++) {
          if (config.method === "savgol") {
            const points = [];
            for (let n = i; n >= start && repaired[i].t - repaired[n].t <= config.radius + 1e-8; n--) points.push({ t: repaired[n].t, value: repaired[n].joints[j][k] });
            for (let n = i + 1; n < end && repaired[n].t - repaired[i].t <= config.radius + 1e-8; n++) points.push({ t: repaired[n].t, value: repaired[n].joints[j][k] });
            output[i].joints[j][k] = polynomialAt(points, repaired[i].t, config.degree) ?? repaired[i].joints[j][k];
          } else if (i > start) {
            const dt = repaired[i].t - repaired[i - 1].t;
            const d = (repaired[i].joints[j][k] - repaired[i - 1].joints[j][k]) / dt;
            derivative += alpha(config.dCutoff, dt) * (d - derivative);
            value += alpha(config.minCutoff + config.beta * Math.abs(derivative), dt) * (repaired[i].joints[j][k] - value);
            output[i].joints[j][k] = value;
          }
        }
      }
      start = end;
    }
  }
  return output;
}

export function filterFrames(raw, options = {}) {
  const { frames: repaired, stats } = repairFrames(raw, options);
  return { repaired, smoothed: smoothFrames(repaired, options), stats };
}

export function commonMask(streams, joints = Array.from({ length: 33 }, (_, i) => i)) {
  return streams[0].map((_, i) => joints.filter(j => streams.every(frames => [-1, 0, 1].every(d => observedJoint(frames[i + d], j)) &&
    frames[i - 1].segmentId === frames[i].segmentId && frames[i + 1].segmentId === frames[i].segmentId &&
    frames[i + 1].t - frames[i - 1].t <= 2 * FILTER.maxGap + 1e-8)));
}

export function jitter(frames, mask = commonMask([frames])) {
  let energy = 0, speed = 0, weight = 0, triples = 0;
  for (let i = 1; i < frames.length - 1; i++) {
    const a = frames[i - 1], b = frames[i], c = frames[i + 1], dl = b.t - a.t, dr = c.t - b.t;
    if (dl <= 0 || dr <= 0) continue;
    for (const j of mask[i]) {
      if (![a, b, c].every(f => finiteJoint(f.joints?.[j]))) continue;
      const acceleration = axes.map(k => 2 * ((c.joints[j][k] - b.joints[j][k]) / dr - (b.joints[j][k] - a.joints[j][k]) / dl) / (dl + dr));
      const w = (dl + dr) / 2;
      energy += acceleration.reduce((sum, v) => sum + v * v, 0) * w;
      speed += (distance(a.joints[j], b.joints[j]) / dl + distance(b.joints[j], c.joints[j]) / dr) / 2 * w;
      weight += w; triples++;
    }
  }
  return { rmsAcceleration: weight ? Math.sqrt(energy / weight) : null, meanSpeed: weight ? speed / weight : null, triples, weightSeconds: weight };
}
