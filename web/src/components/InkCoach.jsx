// SUMI-E ink coach: our real mocap serve, drawn as boiling brush strokes on rice paper.
// 2D canvas, ~10fps hand-drawn cadence, red sun accent, ink splatter on fast strokes.
import { useEffect, useRef } from "react";

// MediaPipe indices
const I = { HEAD: 0, LSHO: 11, RSHO: 12, LELB: 13, RELB: 14, LWRI: 15, RWRI: 16,
  LHIP: 23, RHIP: 24, LKNE: 25, RKNE: 26, LANK: 27, RANK: 28, LFT: 31, RFT: 32 };
const LIMBS = [ // [a, b, base width]
  [I.LSHO, I.RSHO, 10], [I.LSHO, I.LHIP, 12], [I.RSHO, I.RHIP, 12], [I.LHIP, I.RHIP, 11],
  [I.RSHO, I.RELB, 9], [I.RELB, I.RWRI, 7.5],
  [I.LSHO, I.LELB, 9], [I.LELB, I.LWRI, 7.5],
  [I.LHIP, I.LKNE, 11], [I.LKNE, I.LANK, 9], [I.RHIP, I.RKNE, 11], [I.RKNE, I.RANK, 9],
  [I.LANK, I.LFT, 6], [I.RANK, I.RFT, 6],
];
const AZ = 0.38; // camera yaw for a 3/4 view

export default function InkCoach({ speaking }) {
  const ref = useRef(null);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv.getContext("2d");
    let frames = null, fi = 0, timer = null, raf = null, splats = [], alive = true;
    let seed = 7;
    const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const g = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;

    const fit = () => { const r = cv.parentElement.getBoundingClientRect();
      cv.width = r.width; cv.height = r.height; };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(cv.parentElement);

    fetch("/motion_serve.json").then((r) => r.json()).then((d) => { frames = d.frames; });

    // project world -> canvas
    function P(j, W, H, S) {
      const x = j[0] * Math.cos(AZ) + j[2] * Math.sin(AZ);
      return [W * 0.5 + x * S, H * 0.62 + j[1] * S];
    }

    function stroke(a, b, w, boil) {
      const n = 3;
      for (let k = 0; k < n; k++) {
        ctx.globalAlpha = 0.42 + rnd() * 0.5;
        ctx.lineWidth = Math.max(1.2, w * (1 - k * 0.26) + g() * 1.6);
        ctx.beginPath();
        ctx.moveTo(a[0] + g() * boil, a[1] + g() * boil);
        ctx.quadraticCurveTo((a[0] + b[0]) / 2 + g() * boil * 2.2, (a[1] + b[1]) / 2 + g() * boil * 2.2,
          b[0] + g() * boil, b[1] + g() * boil);
        ctx.stroke();
      }
    }

    function draw() {
      if (!alive) return;
      const W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);
      // red sun (breathes when the coach speaks)
      const pulse = speakRef.current ? 1 + 0.1 * Math.sin(Date.now() / 220) : 1;
      ctx.globalAlpha = 0.92; ctx.fillStyle = "#c23b2e";
      ctx.beginPath(); ctx.arc(W * 0.78, H * 0.2, 26 * pulse, 0, 7); ctx.fill();

      if (!frames) return;
      const F = frames[fi], S = H * 0.42;
      seed = 100 + fi * 13; // deterministic boil per frame
      const boil = speakRef.current ? 2.6 : 1.7;
      ctx.strokeStyle = "#17171a"; ctx.lineCap = "round";

      const pts = {};
      for (const k of Object.values(I)) pts[k] = P(F[k], W, H, S);
      // ground brush line under the lower foot
      const gy = Math.max(pts[I.LFT][1], pts[I.RFT][1]) + 12;
      ctx.globalAlpha = 0.5; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(W * 0.5 - S * 0.62, gy + g() * 2);
      ctx.quadraticCurveTo(W * 0.5, gy + 4 + g() * 2, W * 0.5 + S * 0.62, gy + g() * 2); ctx.stroke();

      for (const [a, b, w] of LIMBS) stroke(pts[a], pts[b], w * (S / 240), boil);
      // head
      const hd = P(F[I.HEAD], W, H, S);
      const neck = [(pts[I.LSHO][0] + pts[I.RSHO][0]) / 2, (pts[I.LSHO][1] + pts[I.RSHO][1]) / 2];
      const hx = neck[0] + (hd[0] - neck[0]) * 1.35, hy = neck[1] + (hd[1] - neck[1]) * 1.35;
      ctx.globalAlpha = 0.92; ctx.fillStyle = "#17171a";
      ctx.beginPath(); ctx.arc(hx + g() * boil, hy + g() * boil, S * 0.085, 0, 7); ctx.fill();
      // racquet from forearm direction
      const e = pts[I.RELB], wr = pts[I.RWRI];
      const dx = wr[0] - e[0], dy = wr[1] - e[1], L = Math.hypot(dx, dy) || 1;
      const u = [dx / L, dy / L];
      const rc = [wr[0] + u[0] * S * 0.30, wr[1] + u[1] * S * 0.30];
      ctx.globalAlpha = 0.85; ctx.lineWidth = 3.4;
      ctx.beginPath(); ctx.ellipse(rc[0], rc[1], S * 0.115, S * 0.085, Math.atan2(u[1], u[0]), 0, 7); ctx.stroke();
      ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(wr[0], wr[1]);
      ctx.lineTo(wr[0] + u[0] * S * 0.17, wr[1] + u[1] * S * 0.17); ctx.stroke();

      // splatter on fast wrist
      if (frames[fi + 1]) {
        const n1 = P(frames[fi + 1][I.RWRI], W, H, S);
        const v = Math.hypot(n1[0] - wr[0], n1[1] - wr[1]);
        if (v > S * 0.055) for (let i = 0; i < 4; i++)
          splats.push({ x: rc[0] + g() * 26, y: rc[1] + g() * 26, r: 0.8 + rnd() * 2.4, life: 8 });
      }
      ctx.fillStyle = "#17171a";
      splats = splats.filter((s) => s.life-- > 0);
      for (const s of splats) { ctx.globalAlpha = 0.12 + (s.life / 8) * 0.5;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1;
    }

    // hand-drawn cadence: ~11fps frame advance
    timer = setInterval(() => { if (frames) fi = (fi + 1) % frames.length; draw(); }, 90);
    draw();
    return () => { alive = false; clearInterval(timer); cancelAnimationFrame(raf); ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep latest `speaking` visible to the draw loop without re-mounting
  const speakRef = useRef(speaking);
  speakRef.current = speaking;

  return <canvas ref={ref} style={{ position: "absolute", inset: 0 }} />;
}
