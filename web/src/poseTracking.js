import { normalizeSamples } from "./poseSampling.js";

export const TRACKING = Object.freeze({ lostSeconds: 0.5, reacquireSeconds: 3, confidence: 0.5, ambiguity: 0.12 });
const anchors = [11, 12, 23, 24, 25, 26, 27, 28];
const visible = (p, threshold = 0.5) => p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
  Number.isFinite(p.visibility) && p.visibility >= threshold && (p.presence == null || p.presence >= threshold);

export function boundingBox(points, indices = anchors) {
  const valid = indices.map(i => points?.[i]).filter(p => visible(p));
  if (valid.length < 4) return null;
  const xs = valid.map(p => p.x), ys = valid.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
  return w > 0.005 && h > 0.01 ? { x, y, w, h, cx: x + w / 2, cy: y + h / 2, area: w * h } : null;
}

function cost(a, b) {
  // Compare the same visible anatomy: losing the legs must not halve one box.
  const shared = anchors.filter(i => visible(a.imageJoints?.[i]) && visible(b.imageJoints?.[i]));
  const x = boundingBox(a.imageJoints, shared), y = boundingBox(b.imageJoints, shared);
  if (!x || !y) return Infinity;
  const ratio = Math.max(x.area / y.area, y.area / x.area);
  // Turning side-on changes box width without changing the person's scale.
  // Height still gates genuinely different scales; area remains a soft cost.
  if (Math.max(x.h / y.h, y.h / x.h) > 1.8) return Infinity;
  const center = Math.hypot(x.cx - y.cx, x.cy - y.cy) / Math.max(x.h, y.h);
  if (center > 0.65) return Infinity;
  const intersection = Math.max(0, Math.min(x.x + x.w, y.x + y.w) - Math.max(x.x, y.x)) *
    Math.max(0, Math.min(x.y + x.h, y.y + y.h) - Math.max(x.y, y.y));
  const iou = intersection / (x.area + y.area - intersection);
  const torso = [11, 12, 23, 24].filter(i => visible(a.imageJoints?.[i]) && visible(b.imageJoints?.[i]));
  const distance = torso.length ? torso.reduce((s, i) => s + Math.hypot(a.imageJoints[i].x - b.imageJoints[i].x,
    a.imageJoints[i].y - b.imageJoints[i].y), 0) / torso.length / Math.max(x.h, y.h) : center;
  return center + 0.3 * (1 - iou) + 0.2 * Math.abs(Math.log(ratio)) + distance * 0.5;
}

export function assignTracks(capture, config = TRACKING) {
  const tracks = [], samples = normalizeSamples(capture.samples);
  let ambiguous = 0, duplicates = 0, gated = 0, created = 0;
  const assigned = samples.map((sample, sampleIndex) => {
    const proposals = sample.poses.map(p => {
      const values = anchors.map(i => p.imageJoints?.[i]?.visibility).filter(Number.isFinite);
      return { ...p, bbox: boundingBox(p.imageJoints), confidence: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null };
    }).sort((a, b) => b.confidence - a.confidence);
    const candidates = [];
    for (const p of proposals) {
      // Require matching torso landmarks as well as overlap; IoU alone would
      // suppress different people at a crossing.
      const duplicate = candidates.some(q => {
        const shared = [11, 12, 23, 24].filter(j => visible(p.imageJoints?.[j]) && visible(q.imageJoints?.[j]));
        if (shared.length < 4 || !p.bbox || !q.bbox) return false;
        return cost(p, q) < 0.18 && shared.every(j =>
          Math.hypot(p.imageJoints[j].x - q.imageJoints[j].x, p.imageJoints[j].y - q.imageJoints[j].y) < Math.max(p.bbox.h, q.bbox.h) * 0.08);
      });
      if (duplicate) duplicates++; else candidates.push(p);
    }
    const used = new Set(), matched = new Map(), blocked = new Set();
    for (const strong of [true, false]) {
      const pairs = [];
      candidates.forEach((p, pi) => {
        if (!p.bbox || used.has(pi) || (p.confidence >= config.confidence) !== strong) return;
        tracks.forEach(tr => {
          const gap = sample.t - tr.lastT;
          if (matched.has(tr.id) || gap > config.reacquireSeconds || (!strong && tr.hits < 2)) return;
          const c = cost(tr.lastPose, p);
          if (!Number.isFinite(c)) gated++;
          if (c < (gap > config.lostSeconds ? 0.45 : 1.0)) pairs.push({ pi, tr, c });
        });
      });
      pairs.sort((a, b) => a.c - b.c || a.tr.id - b.tr.id || a.pi - b.pi);
      // Reject ambiguous row OR column, before greedy one-to-one assignment.
      for (const pair of pairs) {
        if (used.has(pair.pi) || matched.has(pair.tr.id)) continue;
        if (pairs.some(other => other !== pair && !used.has(other.pi) && !matched.has(other.tr.id) &&
            (other.pi === pair.pi || other.tr === pair.tr) && Math.abs(other.c - pair.c) < config.ambiguity)) {
          blocked.add(pair.pi); ambiguous++; continue;
        }
        if (blocked.has(pair.pi)) continue;
        used.add(pair.pi); matched.set(pair.tr.id, pair.pi);
      }
    }
    candidates.forEach((p, pi) => {
      if (used.has(pi) || blocked.has(pi) || !p.bbox || !(p.confidence >= config.confidence)) return;
      const tr = { id: tracks.length + 1, hits: 0, strongHits: 0, firstT: sample.t, lastT: sample.t,
        coveredSeconds: 0, areaSum: 0, centerSum: 0, segmentId: 0, lastPose: p };
      tracks.push(tr); matched.set(tr.id, pi); created++;
    });
    const poses = [];
    for (const [id, pi] of matched) {
      const tr = tracks[id - 1], p = candidates[pi], gap = sample.t - tr.lastT;
      if (tr.hits && gap > config.lostSeconds) tr.segmentId++;
      if (tr.hits && gap <= config.lostSeconds) tr.coveredSeconds += gap;
      tr.hits++; tr.strongHits += p.confidence >= config.confidence ? 1 : 0;
      tr.areaSum += p.bbox.area; tr.centerSum += Math.max(0, 1 - Math.hypot(p.bbox.cx - 0.5, p.bbox.cy - 0.5));
      tr.lastT = sample.t; tr.lastPose = p;
      poses.push({ ...p, trackId: id, segmentId: tr.segmentId });
    }
    return { ...sample, sampleIndex, poses };
  });
  const duration = capture.meta.duration || samples.at(-1)?.t || 1;
  const ranked = tracks.filter(tr => tr.strongHits >= 2).map(tr => ({
    id: tr.id, hits: tr.hits, segments: tr.segmentId + 1, coverage: tr.coveredSeconds / duration,
    area: tr.areaSum / tr.hits, centrality: tr.centerSum / tr.hits,
    score: Math.sqrt(tr.areaSum / tr.hits) * (0.3 + tr.coveredSeconds / duration) * (0.5 + tr.centerSum / tr.hits),
  })).sort((a, b) => b.score - a.score || a.id - b.id);
  return { ...capture, samples: assigned, tracks: ranked, selectedId: ranked[0]?.id ?? null,
    trackingDiagnostics: { ambiguous, duplicates, gated, created } };
}

export function selectTrack(capture, id) {
  return capture.samples.map(sample => {
    const pose = sample.poses.find(p => p.trackId === id);
    return { sampleIndex: sample.sampleIndex, t: sample.t, trackId: id, segmentId: pose?.segmentId ?? null,
      joints: pose?.joints ?? null, imageJoints: pose?.imageJoints ?? null,
      imageAspectRatio: capture.meta.width / capture.meta.height || 1 };
  });
}
