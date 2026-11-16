import { observedJoint, validateTimeline } from "./poseFilter.js";

import { reliableJoint } from "./poseFilter.js";
// Speeds refer to media time. A slow-motion file does not establish physical speed.
export const METRICS = Object.freeze({ minPeakSpeed: 0.6, maxDerivativeGap: 0.10, contactMargin: 0.10,
  serveMinElbow: 140, serveMinElevation: 0.5, maxAngleGap: 0.10, rotationWindow: 1.0 });
const axes = ["x", "y", "z"];
const sub = (a, b) => axes.map(k => a[k] - b[k]);
const length = v => Math.hypot(...v);
const round = (n, p = 0) => Number.isFinite(n) ? Math.round(n * 10 ** p) / 10 ** p : null;
export const shortestAngle = x => ((x + 180) % 360 + 360) % 360 - 180;
export function angleAt(a, b, c) {
  const u = sub(a, b), v = sub(c, b), denominator = length(u) * length(v);
  return denominator > 1e-10 ? Math.acos(Math.max(-1, Math.min(1, u.reduce((s, x, i) => s + x * v[i], 0) / denominator))) * 180 / Math.PI : null;
}
function groundAngle(a, b) {
  return Math.hypot(b.z - a.z, b.x - a.x) > 1e-8 ? Math.atan2(b.z - a.z, b.x - a.x) * 180 / Math.PI : null;
}
export function wristSpeeds(frames, hand = "right") {
  const j = hand === "right" ? 16 : 15;
  return frames.map((f, i) => {
    const a = frames[i - 1], c = frames[i + 1];
    if (![a, f, c].every(v => observedJoint(v, j)) || a.segmentId !== f.segmentId || c.segmentId !== f.segmentId) return null;
    const dl = f.t - a.t, dr = c.t - f.t;
    if (!(dl > 0 && dr > 0) || Math.max(dl, dr) > METRICS.maxDerivativeGap + 1e-8) return null;
    return Math.hypot(...axes.map(k => dr / (dl + dr) * (f.joints[j][k] - a.joints[j][k]) / dl + dl / (dl + dr) * (c.joints[j][k] - f.joints[j][k]) / dr));
  });
}
export function angleSeries(frames, left, right) {
  // Unobserved samples are bridged; only a gap longer than maxAngleGap or a segment change
  // starts a new run. shortestAngle stays unambiguous only while the true turn inside a gap
  // is under 180°, which bounds maxAngleGap.
  let previous = null, previousFrame = null, value = 0, run = -1;
  return frames.map(f => {
    const angle = observedJoint(f, left) && observedJoint(f, right) ? groundAngle(f.joints[left], f.joints[right]) : null;
    if (angle == null) return null;
    if (previous == null || previousFrame.segmentId !== f.segmentId || f.t - previousFrame.t > METRICS.maxAngleGap + 1e-8) { value = angle; run++; }
    else value += shortestAngle(angle - previous);
    previous = angle; previousFrame = f;
    return { angle, value, run };
  });
}
export function computeMetrics(frames, hand = "right", stroke = "unknown") {
  if (!frames?.length) return null;
  validateTimeline(frames);
  const [sho, elb, wri, hip, kne, ank] = hand === "right" ? [12, 14, 16, 24, 26, 28] : [11, 13, 15, 23, 25, 27];
  const speed = wristSpeeds(frames, hand), shoulder = angleSeries(frames, 11, 12), hips = angleSeries(frames, 23, 24);
  let contact = null, peak = METRICS.minPeakSpeed;
  speed.forEach((s, i) => {
    if (s == null || s <= peak || s < (speed[i - 1] ?? Infinity) || s < (speed[i + 1] ?? Infinity)) return;
    const cf = frames[i];
    const neighborhood = frames.filter(f => Math.abs(f.t - cf.t) <= METRICS.contactMargin + 1e-8);
    if (neighborhood.some(f => f.poseOutlier || !observedJoint(f, wri) || f.segmentId !== cf.segmentId)) return;
    if (stroke === "serve") {
      if (![sho, elb, wri].every(j => observedJoint(cf, j))) return;
      const elbow = angleAt(cf.joints[sho], cf.joints[elb], cf.joints[wri]);
      // Conservative plausibility check, not a target for coaching technique.
      const armLength = length(sub(cf.joints[sho], cf.joints[elb])) + length(sub(cf.joints[elb], cf.joints[wri]));
      if (!(cf.joints[sho].y - cf.joints[wri].y >= armLength * METRICS.serveMinElevation && elbow >= METRICS.serveMinElbow)) return;
      // Monocular depth can invent an extended arm during the racket drop.
      // When image evidence exists, require it to corroborate overhead extension.
      if (cf.imageJoints) {
        if (![sho, elb, wri].every(j => reliableJoint(cf.imageJoints[j]))) return;
        const [a, b, c] = [sho, elb, wri].map(j => ({ ...cf.imageJoints[j], x: cf.imageJoints[j].x * (cf.imageAspectRatio ?? 1), z: 0 }));
        if (!(c.y < a.y && angleAt(a, b, c) >= METRICS.serveMinElbow)) return;
      }
    }
    peak = s; contact = i;
  });
  const cf = contact == null ? null : frames[contact];
  const usable = (f, indices) => f && indices.every(j => observedJoint(f, j));
  const rangeAtContact = series => {
    if (contact == null || !series[contact]) return null;
    const values = series.filter(v => v && v.run === series[contact].run).map(v => v.value);
    return values.length >= 2 ? Math.max(...values) - Math.min(...values) : null;
  };
  const knee = cf ? frames.filter(f => f.segmentId === cf.segmentId && usable(f, [hip, kne, ank])).map(f => angleAt(f.joints[hip], f.joints[kne], f.joints[ank])).filter(Number.isFinite) : [];
  const xFactors = cf && shoulder[contact] && hips[contact] ? frames.flatMap((f, i) => i <= contact && f.segmentId === cf.segmentId &&
    shoulder[i]?.run === shoulder[contact].run && hips[i]?.run === hips[contact].run ? [Math.abs(shortestAngle(shoulder[i].angle - hips[i].angle))] : []) : [];
  const elbow = usable(cf, [sho, elb, wri]) ? angleAt(cf.joints[sho], cf.joints[elb], cf.joints[wri]) : null;
  const shoulderRange = rangeAtContact(shoulder), hipRange = rangeAtContact(hips);
  // The turn is complete only if the contact run already existed a full rotation window earlier.
  const runStart = series => {
    const run = series[contact]?.run;
    const i = run == null ? -1 : series.findIndex(v => v?.run === run);
    return i < 0 ? Infinity : frames[i].t;
  };
  const incompleteAngles = !cf || Math.max(runStart(shoulder), runStart(hips)) > cf.t - METRICS.rotationWindow + 1e-8;
  return {
    hand, stroke, frames: frames.length, contactIndex: contact, contactT: cf?.t ?? null, segmentId: cf?.segmentId ?? null,
    peakWristSpeedMs: cf ? round(peak, 3) : null, speedUnits: "m/media-s", smoothing: "smoothed",
    shoulderTurnDeg: round(shoulderRange), hipTurnDeg: round(hipRange),
    xFactorDeg: xFactors.length ? round(Math.max(...xFactors)) : null,
    elbowAtContactDeg: round(elbow), kneeBendMinDeg: knee.length ? round(Math.min(...knee)) : null,
    contactWristAboveShoulderM: usable(cf, [sho, wri]) ? round(cf.joints[sho].y - cf.joints[wri].y, 2) : null,
    canAnalyze: !!cf && elbow != null,
    quality: { contact: cf ? "wrist-speed estimate" : "unavailable", timeScale: "media timeline; slow-motion factor unknown",
      coverage: speed.filter(Number.isFinite).length / frames.length,
      incompleteAngles,
      suspectRotation: shoulderRange > 360 || hipRange > 360 },
  };
}
export function metricRows(m) {
  if (!m) return [];
  const partial = m.quality?.incompleteAngles ? " · неполный участок" : "";
  return [
    ["Поворот плеч", m.shoulderTurnDeg, "°", "непрерывный участок с контактом" + partial],
    ["Поворот бёдер", m.hipTurnDeg, "°", "база вращения" + partial],
    ["X-factor (плечи−бёдра)", m.xFactorDeg, "°", "кратчайшая разность" + partial],
    ["Локоть в контакте", m.elbowAtContactDeg, "°", "оценка по скорости кисти"],
    ["Сгиб колена", m.kneeBendMinDeg, "°", "меньше = глубже загрузка"],
    ["Кисть выше плеча", m.contactWristAboveShoulderM, " м", "подача: высоко"],
  ].map(([k, v, unit, ideal]) => ({ k, v: Number.isFinite(v) ? `${v}${unit}` : "—", ideal }));
}
