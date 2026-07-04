// TOON ATHLETE — stylized game-style tennis player (readable shoulders/elbows/knees),
// built procedurally from capsule segments + joint balls driven DIRECTLY by our mocap
// (motion_serve.json). No rigging/retarget — limbs attach to joints, so anatomy is exact.
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";

const J = { NOSE: 0, LEAR: 7, REAR: 8, LSHO: 11, RSHO: 12, LELB: 13, RELB: 14,
  LWRI: 15, RWRI: 16, LHIP: 23, RHIP: 24, LKNE: 25, RKNE: 26, LANK: 27, RANK: 28,
  LHEE: 29, RHEE: 30, LFT: 31, RFT: 32 };

// limb segments: [jointA, jointB, radius, colorKey]
const SEGS = [
  [J.LSHO, J.LELB, 0.055, "shirt"], [J.LELB, J.LWRI, 0.045, "skin"],
  [J.RSHO, J.RELB, 0.055, "shirt"], [J.RELB, J.RWRI, 0.045, "skin"],
  [J.LHIP, J.LKNE, 0.078, "shorts"], [J.LKNE, J.LANK, 0.058, "skin"],
  [J.RHIP, J.RKNE, 0.078, "shorts"], [J.RKNE, J.RANK, 0.058, "skin"],
  [J.LANK, J.LFT, 0.05, "shoe"], [J.RANK, J.RFT, 0.05, "shoe"],
];
// joint balls: [joint, radius, colorKey]
const BALLS = [
  [J.LSHO, 0.065, "shirt"], [J.RSHO, 0.065, "shirt"],
  [J.LELB, 0.05, "skin"], [J.RELB, 0.05, "skin"],
  [J.LWRI, 0.045, "skin"], [J.RWRI, 0.045, "skin"],
  [J.LHIP, 0.082, "shorts"], [J.RHIP, 0.082, "shorts"],
  [J.LKNE, 0.06, "skin"], [J.RKNE, 0.06, "skin"],
  [J.LANK, 0.05, "shoe"], [J.RANK, 0.05, "shoe"],
  [J.LHEE, 0.045, "shoe"], [J.RHEE, 0.045, "shoe"],
];
const UP = new THREE.Vector3(0, 1, 0);

function Athlete({ frames, speaking }) {
  const fi = useRef(0);
  const segRefs = useRef([]); const ballRefs = useRef([]);
  const torsoRef = useRef(); const pelvisRef = useRef(); const neckRef = useRef();
  const headRef = useRef(); const racqRef = useRef();
  const smooth = useMemo(() => new Map(), []);
  const headQ = useMemo(() => new THREE.Quaternion(), []);
  const v = useMemo(() => Array.from({ length: 10 }, () => new THREE.Vector3()), []);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);

  const mats = useMemo(() => {
    const mk = (c, r = 0.65) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.05 });
    const band = new THREE.MeshStandardMaterial({ color: "#c8ff00", roughness: 0.5, emissive: "#c8ff00", emissiveIntensity: 0.35 });
    const frame = new THREE.MeshStandardMaterial({ color: "#c8ff00", roughness: 0.45, emissive: "#9fd400", emissiveIntensity: 0.3 });
    return { skin: mk("#f2c9a0"), shirt: mk("#f4f7f2", 0.75), shorts: mk("#232a32", 0.8),
      shoe: mk("#fafafa", 0.5), dark: mk("#1a1e24", 0.6), band, frame,
      strings: new THREE.MeshBasicMaterial({ color: "#eafff1", transparent: true, opacity: 0.28, side: THREE.DoubleSide }),
      eye: mk("#17181c", 0.4) };
  }, []);

  useFrame((state, dt) => {
    if (!frames) return;
    const L = frames.length;
    fi.current = (fi.current + dt * 10) % L;
    const f0 = Math.floor(fi.current), f1 = (f0 + 1) % L, ft = fi.current - f0;
    const A = frames[f0], B = frames[f1];
    const joint = (i) => {
      let sv = smooth.get(i);
      const tx = A[i][0] + (B[i][0] - A[i][0]) * ft;
      const ty = -(A[i][1] + (B[i][1] - A[i][1]) * ft);
      const tz = -(A[i][2] + (B[i][2] - A[i][2]) * ft);
      if (!sv) { sv = new THREE.Vector3(tx, ty, tz); smooth.set(i, sv); }
      else sv.lerp(v[9].set(tx, ty, tz), 0.5);
      return sv;
    };

    // limbs
    SEGS.forEach(([a, b], k) => {
      const m = segRefs.current[k]; if (!m) return;
      const pa = joint(a), pb = joint(b);
      const len = pa.distanceTo(pb);
      m.position.copy(pa).add(pb).multiplyScalar(0.5);
      q.setFromUnitVectors(UP, v[0].copy(pb).sub(pa).normalize());
      m.quaternion.copy(q);
      m.scale.set(1, Math.max(len, 0.02), 1);
    });
    BALLS.forEach(([a], k) => { const m = ballRefs.current[k]; if (m) m.position.copy(joint(a)); });

    // torso + pelvis
    const sho = v[1].copy(joint(J.LSHO)).add(joint(J.RSHO)).multiplyScalar(0.5);
    const hip = v[2].copy(joint(J.LHIP)).add(joint(J.RHIP)).multiplyScalar(0.5);
    const shoW = joint(J.LSHO).distanceTo(joint(J.RSHO));
    const tLen = sho.distanceTo(hip);
    q.setFromUnitVectors(UP, v[0].copy(sho).sub(hip).normalize());
    if (torsoRef.current) { const t = torsoRef.current;
      t.position.copy(hip).lerp(sho, 0.55); t.quaternion.copy(q);
      t.scale.set(shoW * 0.62, tLen * 0.68, shoW * 0.42); }
    if (pelvisRef.current) { const p = pelvisRef.current;
      p.position.copy(hip); p.quaternion.copy(q); p.scale.set(shoW * 0.52, 0.16, shoW * 0.4); }

    // head (oriented by ears + nose) + neck
    const earL = joint(J.LEAR), earR = joint(J.REAR), nose = joint(J.NOSE);
    const hc = v[3].copy(earL).add(earR).multiplyScalar(0.5);
    const xAx = v[4].copy(earR).sub(earL).normalize();
    const fwd = v[5].copy(nose).sub(hc).normalize();
    const yAx = v[6].crossVectors(fwd, xAx).normalize();
    if (yAx.y < 0) { xAx.negate(); yAx.negate(); } // keep the head upright (mocap mirror flips)
    const xOr = v[7].crossVectors(yAx, fwd).normalize();
    m4.makeBasis(xOr, yAx, fwd);
    headQ.slerp(q.setFromRotationMatrix(m4), 0.35);
    if (headRef.current) { headRef.current.position.copy(hc); headRef.current.quaternion.copy(headQ); }
    if (neckRef.current) { const n = neckRef.current;
      n.position.copy(sho).lerp(hc, 0.45);
      n.quaternion.copy(q.setFromUnitVectors(UP, v[0].copy(hc).sub(sho).normalize()));
      n.scale.set(1, Math.max(sho.distanceTo(hc) * 0.6, 0.02), 1); }

    // racquet on the right hand, oriented by forearm
    const elb = joint(J.RELB), wri = joint(J.RWRI);
    const u = v[8].copy(wri).sub(elb).normalize();
    const e2 = v[0].crossVectors(u, UP); if (e2.lengthSq() < 1e-4) e2.set(1, 0, 0); e2.normalize();
    const e3 = v[9].crossVectors(e2, u).normalize();
    m4.makeBasis(e3, u, e2);
    if (racqRef.current) { racqRef.current.position.copy(wri); racqRef.current.quaternion.copy(q.setFromRotationMatrix(m4)); }

    // speaking pulse on emissives
    const p = speaking ? 0.85 + 0.5 * Math.sin(state.clock.elapsedTime * 8) : 0.35;
    mats.band.emissiveIntensity = p; mats.frame.emissiveIntensity = p * 0.8;
  });

  return (
    <group position={[0, 0.93, 0]}>
      {SEGS.map(([, , r, c], k) => (
        <mesh key={"s" + k} ref={(el) => (segRefs.current[k] = el)} material={mats[c]}>
          <cylinderGeometry args={[r, r * 0.88, 1, 14]} />
        </mesh>
      ))}
      {BALLS.map(([, r, c], k) => (
        <mesh key={"b" + k} ref={(el) => (ballRefs.current[k] = el)} material={mats[c]}>
          <sphereGeometry args={[r, 18, 14]} />
        </mesh>
      ))}
      <mesh ref={torsoRef} material={mats.shirt}><sphereGeometry args={[1, 24, 18]} /></mesh>
      <mesh ref={pelvisRef} material={mats.shorts}><sphereGeometry args={[1, 20, 14]} /></mesh>
      <mesh ref={neckRef} material={mats.skin}><cylinderGeometry args={[0.045, 0.05, 1, 12]} /></mesh>
      <group ref={headRef}>
        <mesh material={mats.skin}><sphereGeometry args={[0.105, 24, 18]} /></mesh>
        <mesh material={mats.band} position={[0, 0.045, 0]} rotation={[0.12, 0, 0]}>
          <torusGeometry args={[0.096, 0.02, 10, 28]} />
        </mesh>
        <mesh material={mats.eye} position={[-0.038, 0.012, 0.092]}><sphereGeometry args={[0.013, 10, 8]} /></mesh>
        <mesh material={mats.eye} position={[0.038, 0.012, 0.092]}><sphereGeometry args={[0.013, 10, 8]} /></mesh>
      </group>
      <group ref={racqRef}>
        <mesh material={mats.dark} position={[0, 0.1, 0]}><cylinderGeometry args={[0.016, 0.02, 0.2, 10]} /></mesh>
        <mesh material={mats.frame} position={[0, 0.33, 0]}><torusGeometry args={[0.125, 0.016, 10, 30]} /></mesh>
        <mesh material={mats.strings} position={[0, 0.33, 0]}><circleGeometry args={[0.115, 24]} /></mesh>
      </group>
    </group>
  );
}

export default function ToonCoach3D({ speaking }) {
  const [frames, setFrames] = useState(null);
  useEffect(() => {
    fetch("/motion_serve.json").then((r) => r.json())
      .then((d) => setFrames(d.frames)).catch(() => {});
  }, []);

  return (
    <Canvas camera={{ position: [1.7, 1.5, 3.2], fov: 45 }} dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }} style={{ position: "absolute", inset: 0 }}>
      <color attach="background" args={["#020a06"]} />
      <fog attach="fog" args={["#020a06", 7, 13]} />
      <hemisphereLight args={["#eafff1", "#0a2a18", 0.85]} />
      <directionalLight position={[2.5, 4, 2.5]} intensity={1.3} />
      <pointLight position={[-2.5, 2, -2]} intensity={12} color="#c8ff00" distance={7} />
      <Athlete frames={frames} speaking={speaking} />
      <ContactShadows position={[0, 0.01, 0]} opacity={0.55} scale={6} blur={2.6} far={2.4} resolution={512} frames={Infinity} />
      <Grid args={[14, 14]} cellSize={0.35} cellColor="#12301d" sectionSize={1.4}
        sectionColor="#1f4a2c" fadeDistance={9} infiniteGrid position={[0, 0, 0]} />
      <OrbitControls enablePan={false} minDistance={1.8} maxDistance={6}
        target={[0, 0.95, 0]} autoRotate autoRotateSpeed={0.55} enableDamping />
    </Canvas>
  );
}
