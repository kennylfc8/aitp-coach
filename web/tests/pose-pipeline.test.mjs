import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleGrid, adaptGrid, normalizeSamples, frameAtTime } from '../src/poseSampling.js';
import { assignTracks, selectTrack, boundingBox } from '../src/poseTracking.js';
import { filterFrames, repairFrames, smoothFrames, commonMask, jitter, polynomialAt } from '../src/poseFilter.js';
import { computeMetrics, angleSeries, shortestAngle, wristSpeeds, metricRows } from '../src/metrics.js';

const joint = (x = 0, y = 0, z = 0) => ({ x, y, z, visibility: 0.99 });
function fixture(fps = 30, seconds = 2, noise = 0, swing = true) {
  let seed = 5123;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
  // Integrate an 8 m/s, sigma=40ms Gaussian velocity pulse on a fine grid.
  const position = t => { let sum = 0; for (let s = 0; s < t; s += 0.0005) sum += 8 * Math.exp(-0.5 * ((s - 1) / 0.04) ** 2) * 0.0005; return sum; };
  return Array.from({ length: seconds * fps + 1 }, (_, i) => {
    const joints = Array.from({ length: 33 }, (_, j) => joint(j % 2 * 0.3, Math.floor(j / 2) * 0.03));
    joints[16] = joint(swing ? position(i / fps) : 0, -0.5, 0);
    joints[15] = { ...joints[16] };
    for (const p of joints) for (const k of ['x', 'y', 'z']) p[k] += noise * random();
    return { t: i / fps, sampleIndex: i, segmentId: 0, joints };
  });
}
test('sampling covers the tail, pilot is included, timelines are strict', () => {
  for (const duration of [0.01, 20, 1000]) {
    const grid = sampleGrid(duration, 60, 1200);
    assert.ok(grid.length <= 1200); assert.ok(grid.at(-1) < duration);
    if (duration > 1) assert.ok(grid.at(-1) > duration * 0.99);
    const adapted = adaptGrid(grid, 12, 50000);
    assert.deepEqual(adapted.slice(0, 12), grid.slice(0, 12));
    assert.ok(adapted.length <= grid.length); assert.equal(adapted.at(-1), grid.at(-1));
  }
  assert.throws(() => sampleGrid(NaN));
  assert.throws(() => sampleGrid(0));
  assert.throws(() => sampleGrid(1, 30, NaN));
  assert.throws(() => sampleGrid(1, 30, Infinity));
  const samples = [{ t: 0, decodedId: 'a' }, { t: 0.001, decodedId: 'a' }, { t: 1 / 240, decodedId: 'b' }];
  assert.equal(normalizeSamples(samples).length, 2);
  assert.equal(frameAtTime([{ t: 0 }, { t: 1 }, { t: 3 }], 2), 1);
  assert.throws(() => normalizeSamples([{ t: 1 }, { t: 0 }]));
});
test('SG uniform coefficients and asymmetric irregular polynomial reproduction', () => {
  const weights = [-2, 3, 6, 7, 6, 3, -2].map(v => v / 21);
  weights.forEach((w, index) => assert.ok(Math.abs(polynomialAt(weights.map((_, i) => ({ t: (i - 3) / 30, value: i === index ? 1 : 0 })), 0) - w) < 1e-9));
  const points = [0, 0.01, 0.06, 0.09].map(t => ({ t, value: 3 + 2 * t + t * t }));
  assert.ok(Math.abs(polynomialAt(points, 0) - 3) < 1e-10);
  assert.equal(polynomialAt([{ t: 0, value: 1 }], 0), null);
});
test('default filter reduces stationary noise >=3x without inventing contact', () => {
  for (const fps of [30, 60]) {
    const raw = fixture(fps, 3, 0.008, false), { smoothed } = filterFrames(raw);
    const mask = commonMask([raw, smoothed]);
    assert.ok(jitter(smoothed, mask).meanSpeed <= jitter(raw, mask).meanSpeed / 3, `stationary ${fps}`);
    assert.equal(computeMetrics(smoothed).contactIndex, null);
    assert.equal(computeMetrics(filterFrames(fixture(fps, 3, 0, false)).smoothed).contactIndex, null);
  }
});
test('default filter preserves clean fast swing peak, timing and amplitude at 30/60', () => {
  for (const fps of [30, 60]) {
    const clean = fixture(fps), raw = fixture(fps, 2, 0.008), before = structuredClone(raw);
    const { smoothed, stats } = filterFrames(raw);
    const baseline = computeMetrics(clean), actual = computeMetrics(smoothed);
    assert.notEqual(actual.contactIndex, null);
    assert.ok(Math.abs(actual.contactIndex - baseline.contactIndex) <= 1, `contact ${fps}: ${actual.contactIndex}/${baseline.contactIndex}`);
    assert.ok(actual.peakWristSpeedMs >= baseline.peakWristSpeedMs * 0.75, `peak ${fps}: ${actual.peakWristSpeedMs}/${baseline.peakWristSpeedMs}`);
    const amp = f => Math.max(...f.map(x => x.joints[16].x)) - Math.min(...f.map(x => x.joints[16].x));
    assert.ok(amp(smoothed) >= amp(clean) * 0.9);
    assert.equal(stats.outliers, 0); assert.deepEqual(raw, before);
    assert.deepEqual(smoothed.map(f => f.t), raw.map(f => f.t));
  }
});
test('repair rejects isolated excursions, only fills bounded short gaps, preserves provenance', () => {
  const raw = fixture(); raw[10].joints[16].x += 3;
  raw[20].joints[16].visibility = 0.1;
  raw[0].joints[16] = null;
  for (let i = 30; i < 40; i++) raw[i].joints[16] = null;
  raw.forEach(f => { f.joints[0] = null; });
  const { repaired, smoothed, stats } = filterFrames(raw);
  assert.equal(stats.outliers, 1);
  assert.equal(repaired[10].provenance[16], 'interpolated');
  assert.equal(repaired[20].sourceConfidence[16].visibility, 0.1);
  assert.equal(smoothed[0].joints[16], null); assert.equal(smoothed[35].joints[16], null);
  assert.ok(smoothed.every(f => f.joints[0] === null));
  assert.equal(wristSpeeds(smoothed)[20], null);
  assert.throws(() => filterFrames([{ t: 0 }, { t: 0 }]));
  assert.doesNotThrow(() => filterFrames([{ t: 0, joints: null }, { t: 1, joints: null }]));
});
test('segments, NaN and optional presence are respected', () => {
  const frames = fixture(); frames[10].joints[16] = null;
  frames[11].segmentId = 1;
  frames[20].joints[0].presence = 0.1; frames[21].joints[0].x = NaN;
  const repaired = repairFrames(frames).frames;
  assert.equal(repaired[10].joints[16], null);
  assert.notEqual(repaired[20].provenance[0], 'observed');
  assert.notEqual(repaired[21].provenance[0], 'observed');
  assert.doesNotThrow(() => smoothFrames(repaired, { method: 'one-euro' }));
});
test('angles unwrap within runs, dt weights are exact for quadratic positions', () => {
  const frames = fixture();
  frames.forEach((f, i) => { const a = (179 + i * 2) * Math.PI / 180; f.joints[11] = joint(); f.joints[12] = joint(Math.cos(a), 0, Math.sin(a)); });
  const angles = angleSeries(frames, 11, 12);
  assert.ok(Math.abs(angles[1].value - 181) < 1e-8); assert.equal(shortestAngle(358), -2);
  frames[5].joints[12] = null;
  const bridged = angleSeries(frames, 11, 12);
  assert.equal(bridged[5], null); assert.equal(bridged[4].run, bridged[6].run);
  assert.ok(Math.abs(bridged[6].value - bridged[4].value - 4) < 1e-8);
  for (const i of [6, 7, 8]) frames[i].joints[12] = null;
  const broken = angleSeries(frames, 11, 12); assert.notEqual(broken[4].run, broken[9].run);
  const irregular = [0, 0.02, 0.07].map(t => ({ t, segmentId: 0, joints: Array.from({ length: 33 }, () => joint(t * t)) }));
  assert.ok(Math.abs(wristSpeeds(irregular)[1] - 0.04) < 1e-10);
});
test('a single unobserved sample mid-turn keeps the full rotation range', () => {
  const turn = () => fixture().map((f, i) => {
    const a = i * 2.5 * Math.PI / 180;
    f.joints[11] = joint(); f.joints[12] = joint(Math.cos(a), 0, Math.sin(a));
    f.joints[23] = joint(); f.joints[24] = joint(Math.cos(a / 2), 0, Math.sin(a / 2));
    return f;
  });
  const clean = computeMetrics(turn());
  assert.equal(clean.contactIndex, 30); assert.equal(clean.shoulderTurnDeg, 150); assert.equal(clean.hipTurnDeg, 75);
  assert.equal(clean.quality.incompleteAngles, false);
  const gapped = turn();
  gapped[20].joints[12] = null;
  gapped[45].provenance = Array(33).fill('observed'); gapped[45].provenance[11] = 'outlier';
  const kept = computeMetrics(gapped);
  assert.equal(kept.shoulderTurnDeg, 150); assert.equal(kept.quality.incompleteAngles, false);
  const lost = turn();
  for (const i of [25, 26, 27, 28]) lost[i].joints[12] = null;
  const cut = computeMetrics(lost);
  assert.equal(cut.quality.incompleteAngles, true);
  assert.match(metricRows(cut).find(r => r.k === 'Поворот плеч').ideal, /неполный участок/);
});
test('contact keeps full index, supports either hand and unavailable geometry', () => {
  const frames = fixture(); frames.forEach(f => { f.joints[0] = null; f.joints[26] = null; });
  const result = computeMetrics(frames);
  assert.equal(result.contactIndex, 30); assert.equal(result.kneeBendMinDeg, null);
  assert.equal(computeMetrics(frames, 'left').contactIndex, 30);
  assert.equal(metricRows(result).find(r => r.k === 'Сгиб колена').v, '—');
  frames[30].joints[14] = { ...frames[30].joints[12] };
  assert.equal(computeMetrics(frames).canAnalyze, false);
});
function candidate(cx, scale = 1, confidence = 0.99) {
  const imageJoints = Array.from({ length: 33 }, (_, i) => ({ x: cx + (i % 2 ? -0.1 : 0.1) * scale,
    y: 0.2 + (i / 33) * 0.6 * scale, z: 0, visibility: confidence }));
  return { imageJoints, joints: fixture()[0].joints };
}
test('tracking survives order swaps, rejects scale gates, keeps short tracks and missing slots', () => {
  const a = candidate(0.3), b = candidate(0.8, 0.5);
  const capture = assignTracks({ meta: { duration: 3 }, samples: Array.from({ length: 20 }, (_, i) => ({ t: i / 30,
    poses: i === 7 ? [] : i % 2 ? [b, a] : [a, b] })) });
  assert.equal(capture.tracks.length, 2);
  const id = capture.samples[0].poses[0].trackId;
  assert.equal(capture.samples[1].poses.find(p => p.bbox.cx < 0.5).trackId, id);
  assert.equal(selectTrack(capture, id)[7].joints, null);
  assert.ok(capture.tracks.every(t => t.coverage < 0.3));
  const scaled = assignTracks({ meta: { duration: 1 }, samples: [0, 0.1, 0.2, 0.3].map((t, i) => ({ t, poses: [candidate(0.5, i < 2 ? 1 : 0.2)] })) });
  assert.equal(scaled.tracks.length, 2);
  assert.equal(boundingBox([]), null);
  const weak = assignTracks({ meta: { duration: 1 }, samples: [{ t: 0, poses: [candidate(0.5, 1, 0.2)] }] });
  assert.equal(weak.selectedId, null);
});
test('lost buffers use seconds and reacquisition starts a segment; duplicates do not create identities', () => {
  for (const fps of [30, 60]) {
    const p = candidate(0.5);
    const capture = assignTracks({ meta: { duration: 2 }, samples: [0, 1 / fps, 1, 1 + 1 / fps].map(t => ({ t, poses: [p] })) });
    assert.equal(capture.tracks.length, 1); assert.equal(capture.tracks[0].segments, 2);
  }
  const capture = assignTracks({ meta: { duration: 1 }, samples: [0, 0.03, 0.06].map(t => ({ t, poses: [candidate(0.5), candidate(0.5)] })) });
  assert.equal(capture.trackingDiagnostics.duplicates, 3);
  assert.equal(capture.tracks.length, 1);
  assert.equal(capture.tracks[0].hits, 3);
});

test('leg visibility loss keeps one identity and crossing ambiguity creates no phantom players', () => {
  const poses = Array.from({ length: 45 }, (_, i) => {
    const p = candidate(0.5);
    if (i >= 5 && i <= 35) for (const j of [25,26,27,28]) p.imageJoints[j].visibility = 0.1;
    return { t: i/30, poses: [p] };
  });
  const tracked = assignTracks({ meta: { duration: 1.5 }, samples: poses });
  assert.equal(tracked.tracks.length, 1);
  assert.equal(tracked.tracks[0].hits, 45);
  const crossed = assignTracks({ meta: { duration: 1 }, samples: [
    { t: 0, poses: [candidate(0.4), candidate(0.6)] },
    { t: 0.03, poses: [candidate(0.4), candidate(0.6)] },
    { t: 0.06, poses: [candidate(0.5)] },
    { t: 0.09, poses: [candidate(0.4), candidate(0.6)] },
  ] });
  assert.ok(crossed.trackingDiagnostics.ambiguous > 0);
  assert.equal(crossed.samples[2].poses.length, 0);
  assert.equal(crossed.trackingDiagnostics.created, 2);
  assert.equal(crossed.tracks.length, 2);
});

test('short whole-body excursions and left/right reversals cannot invent a contact', () => {
  for (const count of [2,3]) for (const reversal of [false,true]) {
    const raw = fixture(30, 2, 0, false);
    for (let i=10; i<10+count; i++) {
      if (reversal) {
        for (const [a,b] of [[11,12],[23,24]]) [raw[i].joints[a],raw[i].joints[b]] = [raw[i].joints[b],raw[i].joints[a]];
        raw[i].joints[16].x += 2;
      } else raw[i].joints.forEach(p => { p.x += 2; });
    }
    const before = structuredClone(raw), result = filterFrames(raw);
    assert.equal(result.stats.poseOutlierFrames, count);
    assert.ok(result.repaired.slice(10,10+count).every(f => f.poseOutlier));
    assert.equal(computeMetrics(result.smoothed).contactIndex, null);
    assert.deepEqual(raw, before);
  }
});

test('contact chooses a separate supported peak, never the shoulder of an invalid maximum', () => {
  const raw = fixture(30, 4);
  const second = fixture();
  for (let i=60;i<raw.length;i++) raw[i].joints[16].x += second[i-60].joints[16].x * 0.8;
  raw[28].joints[16].visibility = 0.1;
  const metrics = computeMetrics(raw);
  assert.equal(metrics.contactIndex, 90);
  assert.equal(computeMetrics(raw.slice(0,60)).contactIndex, null);
});

test('serve contact requires overhead extension corroborated by image geometry', () => {
  const frames = fixture();
  frames.forEach(f => {
    const a=f.joints[12], c=f.joints[16];
    f.joints[14]=joint((a.x+c.x)/2,(a.y+c.y)/2,(a.z+c.z)/2);
  });
  assert.equal(computeMetrics(frames,'right','serve').contactIndex, 30);
  frames.forEach(f => { f.imageJoints=f.joints.map(p=>({...p})); f.imageAspectRatio=0.5625; });
  assert.equal(computeMetrics(frames,'right','serve').contactIndex, 30);
  frames.forEach(f => {
    f.imageJoints = f.joints.map(p => ({...p}));
    f.imageJoints[12]=joint(0,0.5); f.imageJoints[14]=joint(0.1,0.25); f.imageJoints[16]=joint(0.2,0.5);
  });
  assert.equal(computeMetrics(frames,'right','serve').canAnalyze, false);
  assert.equal(computeMetrics(frames,'right','forehand').canAnalyze, true);
  frames.forEach(f => { f.imageJoints=null; f.joints[16].y=1; });
  assert.equal(computeMetrics(frames,'right','serve').canAnalyze, false);
});

test('seek timeout excludes hidden time, still aborts, and removes visibility listeners', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/pose.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('const decodedFrames'), source.indexOf('export async function processVideo'));
  const { seekDecoded } = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  class Visibility extends EventTarget {
    hidden = false;
    listeners = 0;
    addEventListener(...args) { this.listeners++; super.addEventListener(...args); }
    removeEventListener(...args) { this.listeners--; super.removeEventListener(...args); }
    setHidden(value) { this.hidden=value; this.dispatchEvent(new Event('visibilitychange')); }
  }
  class Video extends EventTarget {
    ownerDocument = new Visibility();
    readyState = 2;
    currentSrc = 'fixture';
    requestVideoFrameCallback(fn) { this.callback=fn; return 1; }
    cancelVideoFrameCallback() { this.callback=null; }
    present() { this.dispatchEvent(new Event('seeked')); this.callback?.(0,{mediaTime:this.currentTime}); }
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const video = new Video();
  let settled = false;
  const pending = seekDecoded(video, 0.2, null, 100).finally(() => { settled=true; });
  video.ownerDocument.setHidden(true);
  await sleep(160);
  assert.equal(settled,false);
  video.ownerDocument.setHidden(false); video.present();
  assert.equal((await pending).t,0.2);
  assert.equal(video.ownerDocument.listeners,0);
  video.ownerDocument.setHidden(true);
  const abort = new AbortController(), cancelled = seekDecoded(video,0.3,abort.signal,100);
  abort.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(video.ownerDocument.listeners,0);
  video.ownerDocument.setHidden(false);
  await assert.rejects(seekDecoded(video,0.4,null,10), /Истекло время/);
  assert.equal(video.ownerDocument.listeners,0);
});

test('curved overhead swing survives noise, accelerated time and isolated spikes', () => {
  for (const fps of [30, 60]) {
    const clean = fixture(fps), noisy = fixture(fps, 2, 0.004);
    for (const frames of [clean, noisy]) for (const f of frames) {
      const theta = f.joints[16].x * 2;
      f.joints[16] = joint(0.5 * Math.sin(theta), -0.5 - 0.5 * Math.cos(theta), 0.1 * theta);
    }
    const before = computeMetrics(clean), filtered = filterFrames(noisy);
    const after = computeMetrics(filtered.smoothed);
    assert.ok(Math.abs(before.contactIndex - after.contactIndex) <= 1);
    assert.ok(after.peakWristSpeedMs >= before.peakWristSpeedMs * 0.75);
    assert.equal(filtered.stats.outliers, 0);
    // Velocity alone must not erase coherent fast motion on a compressed timeline.
    const fast = clean.map(f => ({ ...f, t: f.t / 3 }));
    assert.equal(repairFrames(fast).stats.outliers, 0);
    const damaged = structuredClone(clean); damaged[5].joints[16].z += 2;
    assert.equal(repairFrames(damaged).stats.outliers, 1);
  }
});

test('empty streams, full-frame short gaps and restored points retain honest validity', () => {
  const empty = assignTracks({ meta: { duration: 1 }, samples: [{ t: 0, poses: [] }, { t: 0.03, poses: [] }] });
  assert.equal(empty.selectedId, null);
  const blank = filterFrames(selectTrack(empty, null)).smoothed;
  assert.equal(computeMetrics(blank).canAnalyze, false);
  assert.ok(blank.every(f => f.joints.every(j => j === null)));
  const frames = fixture(); frames[10].joints = null; frames[10].segmentId = null;
  const repaired = repairFrames(frames).frames;
  assert.equal(repaired[10].provenance[16], 'interpolated');
  assert.equal(repaired[10].sourceConfidence[16].visibility, null);
  assert.equal(repaired[10].joints[16].visibility, undefined);
  assert.equal(wristSpeeds(repaired)[10], null);
  assert.deepEqual(commonMask([frames, repaired])[10], []);
});

test('long losses create a new identity and a brief large background subject does not win', () => {
  const main = candidate(0.5, 0.6), background = candidate(0.85, 1);
  const capture = assignTracks({ meta: { duration: 3 }, samples: Array.from({ length: 90 }, (_, i) => ({
    t: i / 30, poses: i < 3 ? [main, background] : [main],
  })) });
  assert.equal(capture.selectedId, capture.samples[0].poses[0].trackId);
  const lost = assignTracks({ meta: { duration: 5 }, samples: [0, 0.03, 4, 4.03].map(t => ({ t, poses: [main] })) });
  assert.equal(lost.tracks.length, 2);
});
