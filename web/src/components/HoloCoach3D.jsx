// NEON GHOST — real-time 3D hologram coach: ~6.5k GPU particles forming a tennis player
// that plays OUR mocap serve (motion_serve.json), with a racquet trail, slow camera orbit,
// twinkle shader, and a dissolve→reform beat at the loop point. R3F, no extra deps.
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";

const I = { NOSE: 0, LSHO: 11, RSHO: 12, LELB: 13, RELB: 14, LWRI: 15, RWRI: 16,
  LHIP: 23, RHIP: 24, LKNE: 25, RKNE: 26, LANK: 27, RANK: 28, LFT: 31, RFT: 32 };
const BONES = [
  [I.LSHO, I.RSHO, 260], [I.LHIP, I.RHIP, 220],
  [I.RSHO, I.RELB, 330], [I.RELB, I.RWRI, 330],
  [I.LSHO, I.LELB, 300], [I.LELB, I.LWRI, 300],
  [I.LHIP, I.LKNE, 380], [I.LKNE, I.LANK, 340],
  [I.RHIP, I.RKNE, 380], [I.RKNE, I.RANK, 340],
  [I.LANK, I.LFT, 110], [I.RANK, I.RFT, 110],
];
const TORSO_N = 1400, HEAD_N = 520, RACQ_N = 330, GRIP_N = 90;
const TRAIL_N = 40;

const P = (f, i, out) => out.set(f[i][0], -f[i][1], -f[i][2]); // MP world -> y-up

function makeSprite() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,.55)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
}

function Ghost({ frames, speaking }) {
  const pts = useRef(); const trail = useRef();
  const fi = useRef(0);
  const tmpA = useMemo(() => new THREE.Vector3(), []);
  const tmpB = useMemo(() => new THREE.Vector3(), []);
  const tmpC = useMemo(() => new THREE.Vector3(), []);
  const tmpD = useMemo(() => new THREE.Vector3(), []);
  const boneA = useMemo(() => new THREE.Vector3(), []);
  const boneB = useMemo(() => new THREE.Vector3(), []);
  const hist = useMemo(() => [], []);

  // static per-particle data
  const data = useMemo(() => {
    let seed = 9; const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const g = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
    const rec = [];
    const lime = new THREE.Color("#c8ff00"), grn = new THREE.Color("#4ef08a"),
      white = new THREE.Color("#eafff1"), deep = new THREE.Color("#1f8a4e");
    const pick = (hot) => { const r = rnd();
      if (r < (hot ? 0.30 : 0.10)) return lime; if (r < (hot ? 0.5 : 0.24)) return white;
      return r < 0.85 ? grn : deep; };
    for (const [a, b, n] of BONES) {
      const hot = (a === I.RELB || a === I.RSHO) && (b === I.RWRI || b === I.RELB);
      for (let k = 0; k < n; k++) rec.push({ kind: 0, a, b, t: rnd(),
        j: [g() * 0.016, g() * 0.016, g() * 0.016], c: pick(hot), s: 0.5 + rnd() });
    }
    for (let k = 0; k < TORSO_N; k++) rec.push({ kind: 1, u: rnd(), v: rnd(),
      j: [g() * 0.02, g() * 0.02, g() * 0.02], c: pick(false), s: 0.45 + rnd() * 0.9 });
    for (let k = 0; k < HEAD_N; k++) { const th = rnd() * 6.283, ph = Math.acos(2 * rnd() - 1), r = 0.085 * Math.cbrt(rnd());
      rec.push({ kind: 2, o: [r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th)],
        c: pick(false), s: 0.45 + rnd() * 0.9 }); }
    for (let k = 0; k < RACQ_N; k++) rec.push({ kind: 3, th: (k / RACQ_N) * 6.283 + rnd() * 0.04,
      j: [g() * 0.007, g() * 0.007, g() * 0.007], c: rnd() < 0.45 ? lime : white, s: 0.6 + rnd() });
    for (let k = 0; k < GRIP_N; k++) rec.push({ kind: 4, t: rnd(), j: [g() * 0.008, g() * 0.008, g() * 0.008],
      c: pick(true), s: 0.5 + rnd() });
    // scatter targets for the dissolve beat
    for (const r of rec) { const th = rnd() * 6.283, ph = Math.acos(2 * rnd() - 1), rr = 0.6 + rnd() * 1.1;
      r.sc = [rr * Math.sin(ph) * Math.cos(th), 0.9 + rr * Math.cos(ph) * 0.7, rr * Math.sin(ph) * Math.sin(th)];
      r.phase = rnd() * 6.283; }
    return rec;
  }, []);

  const N = data.length;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const col = new Float32Array(N * 3), sz = new Float32Array(N), ph = new Float32Array(N);
    data.forEach((r, i) => { col.set([r.c.r, r.c.g, r.c.b], i * 3); sz[i] = r.s; ph[i] = r.phase; });
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sz, 1));
    g.setAttribute("aPhase", new THREE.BufferAttribute(ph, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 4);
    return g;
  }, [data, N]);

  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uBoost: { value: 1 }, uMap: { value: makeSprite() }, uFade: { value: 1 } },
    vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aPhase;
      uniform float uTime; uniform float uBoost; varying vec3 vC; varying float vTw;
      void main(){ vC = aColor;
        vTw = .75 + .35*sin(uTime*2.6 + aPhase);
        vec4 mv = modelViewMatrix * vec4(position,1.);
        gl_PointSize = aSize * vTw * uBoost * (26.0 / -mv.z);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D uMap; uniform float uFade; varying vec3 vC; varying float vTw;
      void main(){ vec4 t = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vC, t.a * vTw * uFade * .9); }`,
  }), []);

  const trailGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
    const col = new Float32Array(TRAIL_N * 3);
    for (let i = 0; i < TRAIL_N; i++) { const a = i / (TRAIL_N - 1);
      col.set([0.78 * a + 0.1, 1.0 * a + 0.1, 0.0], i * 3); }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  }, []);

  useFrame((state, dt) => {
    if (!frames) return;
    const L = frames.length;
    fi.current = (fi.current + dt * 9) % L; // slow-mo playback
    const f0 = Math.floor(fi.current), f1 = (f0 + 1) % L, ft = fi.current - f0;
    const A = frames[f0], B = frames[f1];
    const J = (i, out) => { P(A, i, tmpA); P(B, i, tmpB); out.copy(tmpA).lerp(tmpB, ft); return out; };

    // dissolve near the loop seam
    const edge = 7; let d = 0;
    if (fi.current > L - edge) d = (fi.current - (L - edge)) / edge;
    else if (fi.current < edge * 0.8) d = 1 - fi.current / (edge * 0.8);
    d = d * d * (3 - 2 * d);
    mat.uniforms.uFade.value = 1 - d * 0.75;
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    mat.uniforms.uBoost.value = speaking ? 1.35 + 0.25 * Math.sin(state.clock.elapsedTime * 9) : 1;

    const pos = geo.attributes.position.array;
    const sho = J(I.LSHO, new THREE.Vector3()), rsh = J(I.RSHO, new THREE.Vector3());
    const lhp = J(I.LHIP, new THREE.Vector3()), rhp = J(I.RHIP, new THREE.Vector3());
    const nose = J(I.NOSE, new THREE.Vector3());
    const neck = tmpC.copy(sho).add(rsh).multiplyScalar(0.5);
    const headC = tmpD.copy(nose).sub(neck).multiplyScalar(0.55).add(nose);
    const elb = J(I.RELB, new THREE.Vector3()), wri = J(I.RWRI, new THREE.Vector3());
    const u = new THREE.Vector3().copy(wri).sub(elb).normalize();
    const e2 = new THREE.Vector3().crossVectors(u, new THREE.Vector3(0, 1, 0));
    if (e2.lengthSq() < 1e-4) e2.set(1, 0, 0); e2.normalize();
    const e3 = new THREE.Vector3().crossVectors(u, e2).normalize();
    const rc = new THREE.Vector3().copy(wri).addScaledVector(u, 0.30);

    let i3 = 0;
    for (let i = 0; i < N; i++, i3 += 3) {
      const r = data[i]; let x, y, z;
      if (r.kind === 0) { J(r.a, boneA); J(r.b, boneB);
        x = boneA.x + (boneB.x - boneA.x) * r.t + r.j[0];
        y = boneA.y + (boneB.y - boneA.y) * r.t + r.j[1];
        z = boneA.z + (boneB.z - boneA.z) * r.t + r.j[2];
      } else if (r.kind === 1) {
        const tx = sho.x + (rsh.x - sho.x) * r.u, ty = sho.y + (rsh.y - sho.y) * r.u, tz = sho.z + (rsh.z - sho.z) * r.u;
        const bx = lhp.x + (rhp.x - lhp.x) * r.u, by = lhp.y + (rhp.y - lhp.y) * r.u, bz = lhp.z + (rhp.z - lhp.z) * r.u;
        x = tx + (bx - tx) * r.v + r.j[0]; y = ty + (by - ty) * r.v + r.j[1]; z = tz + (bz - tz) * r.v + r.j[2];
      } else if (r.kind === 2) { x = headC.x + r.o[0]; y = headC.y + r.o[1]; z = headC.z + r.o[2];
      } else if (r.kind === 3) { const ct = Math.cos(r.th), st = Math.sin(r.th);
        x = rc.x + u.x * ct * 0.16 + e2.x * st * 0.12 + r.j[0];
        y = rc.y + u.y * ct * 0.16 + e2.y * st * 0.12 + r.j[1];
        z = rc.z + u.z * ct * 0.16 + e2.z * st * 0.12 + r.j[2];
      } else { x = wri.x + u.x * 0.17 * r.t + r.j[0]; y = wri.y + u.y * 0.17 * r.t + r.j[1]; z = wri.z + u.z * 0.17 * r.t + r.j[2]; }
      if (d > 0) { x += (r.sc[0] - x) * d; y += (r.sc[1] - y) * d; z += (r.sc[2] - z) * d; }
      pos[i3] = x; pos[i3 + 1] = y; pos[i3 + 2] = z;
    }
    geo.attributes.position.needsUpdate = true;

    // racquet-tip trail
    const tip = new THREE.Vector3().copy(rc).addScaledVector(u, 0.16);
    if (d > 0.5) hist.length = 0;
    hist.push([tip.x, tip.y, tip.z]); if (hist.length > TRAIL_N) hist.shift();
    const tp = trailGeo.attributes.position.array;
    for (let i = 0; i < TRAIL_N; i++) {
      const h = hist[Math.max(0, hist.length - TRAIL_N + i)] || hist[0] || [0, 0, 0];
      tp[i * 3] = h[0]; tp[i * 3 + 1] = h[1]; tp[i * 3 + 2] = h[2];
    }
    trailGeo.attributes.position.needsUpdate = true;
    e3.set(0, 0, 0); // silence lint (basis kept for clarity)
  });

  return (
    <group position={[0, 0.92, 0]}>
      <points ref={pts} geometry={geo} material={mat} />
      <line ref={trail} geometry={trailGeo}>
        <lineBasicMaterial vertexColors transparent opacity={0.85}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </line>
    </group>
  );
}

function GlowDisc() {
  const tex = useMemo(() => {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(128, 128, 8, 128, 128, 126);
    gr.addColorStop(0, "rgba(120,240,140,.5)"); gr.addColorStop(0.55, "rgba(60,160,90,.16)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }, []);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
      <circleGeometry args={[1.7, 48]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </mesh>
  );
}

export default function HoloCoach3D({ speaking }) {
  const [frames, setFrames] = useState(null);
  useEffect(() => {
    fetch("/motion_serve.json").then((r) => r.json())
      .then((d) => setFrames(d.frames)).catch(() => {});
  }, []);

  return (
    <Canvas camera={{ position: [1.6, 1.35, 3.1], fov: 46 }} dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }} style={{ position: "absolute", inset: 0 }}>
      <color attach="background" args={["#020a06"]} />
      <fog attach="fog" args={["#020a06", 6, 12]} />
      <Ghost frames={frames} speaking={speaking} />
      <GlowDisc />
      <Grid args={[14, 14]} cellSize={0.35} cellColor="#12301d" sectionSize={1.4}
        sectionColor="#1f4a2c" fadeDistance={9} infiniteGrid position={[0, 0, 0]} />
      <OrbitControls enablePan={false} minDistance={1.8} maxDistance={6}
        target={[0, 0.95, 0]} autoRotate autoRotateSpeed={0.7} enableDamping />
    </Canvas>
  );
}
