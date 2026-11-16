// Media seconds throughout. A cap changes spacing, never truncates the tail.
export function sampleGrid(duration, fps = 30, cap = 1200) {
  if (!(duration > 0) || !Number.isFinite(duration) || !(fps > 0) || !Number.isFinite(fps) || !Number.isFinite(cap) || cap < 1) {
    throw new Error("Invalid video duration or sampling budget");
  }
  const n = Math.min(Math.floor(cap), Math.max(1, Math.ceil(duration * fps)));
  return Array.from({ length: n }, (_, i) => i * duration / n);
}

export function adaptGrid(grid, completed, elapsedMs, targetMs = 60000) {
  if (completed < 1 || completed >= grid.length || elapsedMs <= 0) return grid;
  const remaining = Math.max(2, Math.floor((targetMs - elapsedMs) * 0.85 / (elapsedMs / completed)));
  if (remaining >= grid.length - completed) return grid;
  const first = grid[completed], last = grid.at(-1);
  return [...grid.slice(0, completed), ...Array.from({ length: remaining }, (_, i) => first + (last - first) * i / (remaining - 1))];
}

export function normalizeSamples(samples) {
  const seen = new Set(), result = [];
  for (const sample of samples) {
    if (!Number.isFinite(sample.t) || sample.t < 0) throw new Error("Invalid sample time");
    if (result.length && sample.t < result.at(-1).t) throw new Error("Sample time moved backwards");
    if (sample.t === result.at(-1)?.t || (sample.decodedId != null && seen.has(sample.decodedId))) continue;
    if (sample.decodedId != null) seen.add(sample.decodedId);
    result.push({ ...sample, sampleIndex: result.length });
  }
  return result;
}

export function frameAtTime(frames, t) {
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frames[mid].t <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}
