// Same JS as the UI: tracking, validity, repair, both filters and metrics.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { assignTracks, selectTrack } from '../web/src/poseTracking.js';
import { repairFrames, smoothFrames, commonMask, jitter } from '../web/src/poseFilter.js';
import { computeMetrics, wristSpeeds, angleSeries } from '../web/src/metrics.js';
const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' },
  hand: { type: 'string', default: 'right' }, stroke: { type: 'string', default: 'serve' }, track: { type: 'string' }, reference: { type: 'string' }, compare: { type: 'string', default: 'one-euro,savgol' } } });
if (!values.input || !values.output) throw new Error('--input and --output required');
const capture = JSON.parse(await fs.readFile(values.input, 'utf8'));
const tracked = assignTracks(capture), trackId = values.track ? +values.track : tracked.selectedId;
const raw = selectTrack(tracked, trackId), start = performance.now();
const { frames: repaired, stats } = repairFrames(raw);
const variants = [{ name: 'raw', frames: raw }, { name: 'repaired', frames: repaired }];
let reference = null;
if (values.reference) {
  const other = assignTracks(JSON.parse(await fs.readFile(values.reference, 'utf8')));
  const frames = selectTrack(other, other.selectedId);
  if (frames.length !== raw.length || frames.some((f, i) => Math.abs(f.t - raw[i].t) > 1e-6)) {
    throw new Error('Reference must have the same decoded time grid; do not interpolate for this comparison');
  }
  reference = { source: values.reference, trackId: other.selectedId, meta: other.meta };
  variants.unshift({ name: `raw-${other.meta.numPoses}-pose-reference`, frames });
}
const configs = [
  { name: 'one-euro-1.5-0.3', method: 'one-euro', minCutoff: 1.5, beta: 0.3, dCutoff: 1 },
  { name: 'one-euro-2-1', method: 'one-euro', minCutoff: 2, beta: 1, dCutoff: 1 },
  { name: 'savgol-0.067', method: 'savgol', radius: 2 / 30, degree: 2 },
  { name: 'savgol-0.100', method: 'savgol', radius: 3 / 30, degree: 2 },
];
for (const config of configs.filter(c => values.compare.split(',').includes(c.method))) {
  const before = performance.now();
  variants.push({ name: config.name, config, frames: smoothFrames(repaired, config), filterMs: performance.now() - before });
}
const groups = { body: Array.from({ length: 33 }, (_, i) => i), torso: [11, 12, 23, 24], wrist: [values.hand === 'right' ? 16 : 15] };
const masks = Object.fromEntries(Object.entries(groups).map(([name, joints]) => [name, commonMask(variants.map(v => v.frames), joints)]));
// One common low-motion window, selected using raw torso only.
let quiet = null, quietSpeed = Infinity;
for (const f of raw) {
  const mask = masks.torso.map((joints, i) => raw[i].t >= f.t && raw[i].t <= f.t + 0.5 ? joints : []);
  const score = jitter(raw, mask);
  if (score.weightSeconds >= 1.2 && score.meanSpeed < quietSpeed) { quiet = [f.t, f.t + 0.5]; quietSpeed = score.meanSpeed; }
}
const rows = variants.map(v => ({ name: v.name, config: v.config ?? null, filterMs: v.filterMs ?? 0,
  metrics: { ...computeMetrics(v.frames, values.hand, values.stroke), smoothing: v.name },
  jitter: Object.fromEntries(Object.keys(groups).map(group => [group, jitter(v.frames, masks[group])])),
  quietWindow: quiet, quietSpeed: quiet ? jitter(v.frames, masks.body.map((joints, i) => raw[i].t >= quiet[0] && raw[i].t <= quiet[1] ? joints : [])).meanSpeed : null,
}));
const report = { schemaVersion: 1, source: values.input, reference, hand: values.hand, trackId, tracks: tracked.tracks,
  trackingDiagnostics: tracked.trackingDiagnostics, meta: capture.meta, stats, mask: 'observed triples shared by all variants; no interpolated joints',
  coverage: { firstT: raw[0]?.t ?? null, lastT: raw.at(-1)?.t ?? null, samples: raw.length,
    observedFrames: raw.filter(f => f.joints).length }, rows, downstreamTotalMs: performance.now() - start };
await fs.mkdir(path.dirname(values.output), { recursive: true });
await fs.writeFile(`${values.output}.report.json`, JSON.stringify(report, null, 2));
const cell = n => Number.isFinite(n) ? n.toFixed(2) : '—';
const markdown = ['| Method | Body jitter m/media-s² | Wrist jitter | Quiet speed m/media-s | Contact s | Peak m/media-s | Shoulders ° | Hips ° |',
  '|---|---:|---:|---:|---:|---:|---:|---:|', ...rows.map(r => `| ${r.name} | ${cell(r.jitter.body.rmsAcceleration)} | ${cell(r.jitter.wrist.rmsAcceleration)} | ${cell(r.quietSpeed)} | ${cell(r.metrics.contactT)} | ${cell(r.metrics.peakWristSpeedMs)} | ${cell(r.metrics.shoulderTurnDeg)} | ${cell(r.metrics.hipTurnDeg)} |`) ].join('\n');
await fs.writeFile(`${values.output}.md`, markdown + '\n');
const wri = groups.wrist[0], colors = ['#697b90', '#c28e44', '#be66dd', '#e78da7', '#34b9be', '#56ad36', '#143f8a'];
const plot = (title, series, y, height = 150) => {
  const all = series.flatMap(s => s.values.filter(Number.isFinite));
  const low = all.length ? Math.min(...all) : 0, high = all.length ? Math.max(...all) : 1, duration = capture.meta.duration || 1;
  let svg = `<text x="15" y="${y + 15}" fill="#263746">${title} (${low.toFixed(2)}…${high.toFixed(2)})</text>`;
  for (let tick = 0; tick <= 5; tick++) {
    const x = 50 + tick / 5 * 950;
    svg += `<line x1="${x}" x2="${x}" y1="${y + 25}" y2="${y + height - 5}" stroke="#e8edf0"/><text x="${x}" y="${y + height + 9}" text-anchor="middle" font-size="10" fill="#697b90">${(duration * tick / 5).toFixed(1)}s</text>`;
  }
  raw.forEach((f, i) => { if (!f.joints) svg += `<rect x="${50 + f.t / duration * 950}" y="${y + 25}" width="${Math.max(1, ((raw[i + 1]?.t ?? f.t + 0.03) - f.t) / duration * 950)}" height="${height - 30}" fill="#ffd4d4"/>`; });
  series.forEach((s, n) => {
    let d = '', previous = false;
    s.values.forEach((value, i) => {
      if (!Number.isFinite(value)) { previous = false; return; }
      const x = 50 + raw[i].t / duration * 950, py = y + height - 5 - (value - low) / (high - low || 1) * (height - 35);
      d += `${previous ? 'L' : 'M'}${x.toFixed(1)},${py.toFixed(1)} `; previous = true;
    });
    svg += `<path d="${d}" fill="none" stroke="${colors[n]}" stroke-width="1.2"/>`;
  });
  return svg;
};
let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="930" viewBox="0 0 1040 930"><rect width="1040" height="930" fill="#fff"/><g font-family="monospace" font-size="12">';
svg += `<text x="15" y="20">${path.basename(values.input).replaceAll('&', '&amp;').replaceAll('<', '&lt;')} · track ${trackId} · ${values.hand} · time in media seconds</text>`;
variants.forEach((v, i) => { svg += `<text x="${15 + i % 4 * 250}" y="${43 + Math.floor(i / 4) * 18}" fill="${colors[i]}">${v.name}</text>`; });
for (const [axis, offset] of [['x', 80], ['y', 240]]) svg += plot(`Wrist ${axis} (m)`, variants.map(v => ({ values: v.frames.map(f => f.joints?.[wri]?.[axis] ?? null) })), offset);
svg += plot('Wrist speed (m/media-s)', variants.map(v => ({ values: wristSpeeds(v.frames, values.hand) })), 400);
svg += plot('Unwrapped shoulders (deg)', variants.map(v => ({ values: angleSeries(v.frames, 11, 12).map(p => p?.value ?? null) })), 560);
svg += plot('Unwrapped hips (deg)', variants.map(v => ({ values: angleSeries(v.frames, 23, 24).map(p => p?.value ?? null) })), 720);
svg += '<text x="15" y="915">Pink: missing selected player; reference may continue. Jitter includes real acceleration.</text></g></svg>';
await fs.writeFile(`${values.output}.svg`, svg);
console.log(JSON.stringify({ source: values.input, trackId, samples: raw.length, report: `${values.output}.report.json` }));
