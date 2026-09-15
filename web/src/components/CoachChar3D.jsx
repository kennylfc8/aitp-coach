// COACH 3D — game-quality coach with a real animation state machine (40 Mixamo clips)
// and a live face: audio-driven lipsync (wawa-lipsync visemes → morph targets) + blinking.
// Default character: Avaturn T2 (full ARKit + Oculus viseme morphs, Mixamo-compatible rig).
// Legacy Ch28 (static face) stays behind ?char=ch28.
// Boot: Standing Greeting → Idle. Idle alternates with Breathing Idle + rare Look Around.
// Speaking: keyword gesture (clap/point/fist/...) → Talking loop → back to Idle.
// Right-hand fingers stay curled on the racquet (clip tracks for them are filtered out).
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid, ContactShadows, useGLTF } from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";
import { getClipFor, buildBoneIndex, getHipsRestY, gestureFor } from "../coachAnims";
import { lipsyncManager, hasCues, cueAt, audioTime } from "../lipsync";
import { demo, DEMO_MOVES, GRIPS } from "../demoBus";
import CourtEnv, { THEMES } from "./CourtEnv";

// ch28 finger curls: local-euler deltas tuned by eye (that rig curls around local Z)
const CURL = { f1: 0.95, f2: 1.05, f3: 0.75, t1x: 0.5, t2z: -0.55, t3z: -0.3 };

// Avaturn (and any unknown rig): local bone axes differ, so curl around WORLD axes —
// fingers fold around the knuckle line, thumb wraps around the finger direction.
// Signs are resolved by a probe rotation (a curl must move the finger toward the palm).
function curlFistWorldAxes(scene, bones) {
  const need = ["rHand", "index1", "pinky1", "middle1", "middle2", "thumb1", "thumb2", "thumb3"];
  if (need.some((k) => !bones[k])) return;
  scene.updateMatrixWorld(true);
  const wp = (b) => b.getWorldPosition(new THREE.Vector3());
  const pH = wp(bones.rHand), pI = wp(bones.index1), pP = wp(bones.pinky1), pM1 = wp(bones.middle1);
  const across = pI.clone().sub(pP).normalize();
  const along = pM1.clone().sub(pH).normalize();
  let normal = new THREE.Vector3().crossVectors(along, across).normalize();
  if (normal.dot(wp(bones.thumb1).sub(pH)) < 0) normal.negate(); // palm side ≈ thumb side
  const curl = (bone, ang, axisWorld) => {
    const inv = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
    const la = axisWorld.clone().applyQuaternion(inv).normalize();
    bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(la, ang));
    bone.updateMatrixWorld(true);
  };
  const probeSign = (bone, tip, axis) => {
    const before = wp(tip);
    curl(bone, 0.3, axis);
    const s = wp(tip).sub(before).dot(normal) > 0 ? 1 : -1;
    curl(bone, -0.3, axis);
    return s;
  };
  const sF = probeSign(bones.middle1, bones.middle2, across);
  // per-finger curls solved against the handle cylinder (PIP/DIP pads land on the
  // surface, r=1.75cm + finger flesh): index rides relaxed over the handle like a
  // trigger finger, ring/pinky squeeze — a uniform fist can't be tangent for all four
  const F = { index: [0.65, 0.85, 0.45], middle: [0.95, 1.25, 0.5],
              ring: [1.05, 1.25, 0.5], pinky: [1.05, 1.25, 0.5] };
  for (const f of ["index", "middle", "ring", "pinky"])
    F[f].forEach((ang, i) => { if (bones[f + (i + 1)]) curl(bones[f + (i + 1)], sF * ang, across); });
  const sT = probeSign(bones.thumb1, bones.thumb3, along);
  curl(bones.thumb1, sT * 0.55, along);
  curl(bones.thumb2, sT * 0.55, along);
  curl(bones.thumb3, sT * 0.4, along);
}
const RQ_POS = [0.055, 0.08, 0];  // ch28 hand-local constants (calibrated by eye)
const RQ_ROT = [-1.57, 0, 0];

// Derive the grip from the hand's own anatomy (works for any rig). Runs AFTER the
// finger curls, so the curled fingers themselves define where the handle must be:
//   grip center  = center of the arc of the curled middle finger (knuckle..last joint)
//   handle axis  = across the fist, pinky knuckle -> index knuckle (head on the thumb side)
//   face normal  = palm normal, sign resolved toward the grip center
// Fine-tune via URL: ?rqa=(deg twist around handle) ?rqox/rqoy/rqoz=(cm offsets)
function fitRacquetToHand(scene, bones, rq, gripName) {
  const { rHand, index1, pinky1, middle1, middle2, middle3 } = bones;
  if (!rHand || !index1 || !pinky1 || !middle1 || !middle2 || !middle3) return;
  scene.updateMatrixWorld(true);
  const wp = (b) => b.getWorldPosition(new THREE.Vector3());
  const pH = wp(rHand), pI = wp(index1), pP = wp(pinky1), pM1 = wp(middle1), pM2 = wp(middle2);
  const across = pI.clone().sub(pP).normalize();            // handle: butt on pinky side
  const along = pM1.clone().sub(pH).normalize();            // toward the fingers
  let normal = new THREE.Vector3().crossVectors(along, across).normalize(); // palm normal
  // sign anchor: the curled middle finger bends toward the palm side
  if (normal.dot(pM2.clone().sub(pM1)) < 0) normal.negate();
  // handle axis: ~a finger-width below the knuckle line, where the solved finger
  // ring is tangent to the handle. Constants were solved at hand scale 0.953 —
  // scaling them by the CURRENT hand scale keeps the fit right on any avatar.
  const kh = (rHand.getWorldScale(new THREE.Vector3()).x || 0.953) / 0.953;
  const gripCenter = pI.clone().add(pP).multiplyScalar(0.5)
    .addScaledVector(normal, 0.028 * kh).addScaledVector(along, -0.009 * kh);
  // real grips run DIAGONALLY across the palm (index knuckle -> heel), not straight
  // along the knuckle line — tilt the handle toward the fingers (?rqd=deg to taste)
  const diag = ((parseFloat(FLAGS.get("rqd")) ?? NaN) || 23) * Math.PI / 180;
  const handleDir = across.clone().multiplyScalar(Math.cos(diag))
    .addScaledVector(along, Math.sin(diag)).normalize();
  // optional lateral tilt around the finger axis (?rqt=deg), 0 = natural hang
  const tilt = (parseFloat(FLAGS.get("rqt")) || 0) * Math.PI / 180;
  const qTilt = new THREE.Quaternion().setFromAxisAngle(along, tilt);
  handleDir.applyQuaternion(qTilt);
  const normalT = normal.clone().applyQuaternion(qTilt);
  // (handleDir × normalT), NOT the reverse: the basis must stay right-handed —
  // a det=-1 basis makes setFromRotationMatrix emit a non-unit quaternion that
  // skews the racquet unpredictably
  const ortho = new THREE.Vector3().crossVectors(handleDir, normalT).normalize();
  const basis = new THREE.Matrix4().makeBasis(ortho, handleDir, normalT); // rq: +Y handle, +Z face
  const qWorld = new THREE.Quaternion().setFromRotationMatrix(basis);
  // twist around the handle: grip preset (bevel) + optional URL fine-tune
  const grip = GRIPS[gripName] || GRIPS.continental;
  const twist = ((parseFloat(FLAGS.get("rqa")) || 0) + grip.twist) * Math.PI / 180;
  if (twist) qWorld.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), twist));
  const qHand = rHand.getWorldQuaternion(new THREE.Quaternion()).invert();
  rq.quaternion.copy(qHand).multiply(qWorld);
  // the hand holds NEAR THE BUTT, like a real grip: fist center a hand-scaled
  // ~4.5cm up the handle, butt cap just peeks past the heel
  const butt = gripCenter.clone().addScaledVector(handleDir, -0.045 * kh);
  const off = ["rqox", "rqoy", "rqoz"].map((k) => (parseFloat(FLAGS.get(k)) || 0) / 100);
  butt.addScaledVector(ortho, off[0]).addScaledVector(across, off[1]).addScaledVector(normal, off[2]);
  rq.position.copy(rHand.worldToLocal(butt));
}
const FLAGS = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
const _tmpShadow = new THREE.Vector3(); // per-frame scratch for the contact shadow
const CHAR = FLAGS.get("char") === "ch28" ? "ch28" : "avaturn";
const MODEL_URL = CHAR === "ch28" ? "/Ch28w.glb" : "/AvaturnCoach.glb";
const JAW_SCALE = parseFloat(FLAGS.get("jaw")) || 1; // mouth-opening strength knob
const LOOK_HAND = FLAGS.has("lookhand"); // dev: aim the camera at the racquet hand

function Char({ speaking, transcript }) {
  const { scene } = useGLTF(MODEL_URL);
  const group = useRef();
  const bones = useMemo(() => ({}), []);
  const A = useRef({ mixer: null, actions: new Map(), current: null, currentName: "",
    boneIndex: null, hipsY: 0, speaking: false, busy: false, booted: false,
    t: 0, nextBlink: 2.5, blinkT: null,
    nextBrow: 4, browT: null,
    nextSacc: 1.5, eyeX: 0, eyeY: 0, demoSeen: 0 }).current;

  // ---------- model prep (once) ----------
  useEffect(() => {
    scene.traverse((o) => {
      if (o.isMesh) {
        const meshName = (o.name || "").toLowerCase();
        if (CHAR === "ch28") {
          // Ch28's alpha-card accessories (eyelashes, nape braids, wrist beads) can't be
          // rendered cleanly — they show as dark debris / a card fan. He's shaved by design
          // (brows/stubble are painted in the face texture), so drop both card meshes.
          if (meshName.includes("eyelash") || meshName.includes("hair")) { o.visible = false; return; }
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) {
            m.roughness = Math.min(0.85, (m.roughness ?? 0.8) + 0.05);
            // inflate the hoodie a touch along normals so wrists/forearms stop poking through
            if (meshName.includes("hoody") && !m.userData.inflated) {
              m.userData.inflated = true;
              m.onBeforeCompile = (sh) => {
                sh.vertexShader = sh.vertexShader.replace(
                  "#include <begin_vertex>",
                  "#include <begin_vertex>\n transformed += objectNormal * 0.004;"
                );
              };
              m.needsUpdate = true;
            }
          }
        }
        o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false;
      }
      if (o.isBone) {
        const n = o.name.toLowerCase();
        const put = (k) => { if (!bones[k]) bones[k] = o; };
        if (n.endsWith("righthand")) put("rHand");
        if (n.endsWith("lefthand")) put("lHand"); // serve-ball anchor
        if (n.endsWith("hips")) put("hips");      // contact-shadow anchor
        if (n.endsWith("neck")) put("neck"); // GRIP.CAM anchor: keeps the closeup outside the body
        if (n === "head") put("head");       // sport-fit cap anchor
        for (const f of ["index", "middle", "ring", "pinky"])
          for (let i = 1; i <= 3; i++) if (n.endsWith("righthand" + f + i)) put(f + i);
        for (let i = 1; i <= 3; i++) if (n.endsWith("righthandthumb" + i)) put("thumb" + i);
      }
    });
    // face rig: meshes with viseme / blink / brow / smile morphs + eye bones (Avaturn T2)
    // v tag: the scene object outlives HMR swaps — rebuild when the shape changes
    if (!scene.userData.face || scene.userData.face.v !== 2) {
      const face = { v: 2, viseme: [], blink: [], brow: [], smile: [], eyes: [] };
      scene.traverse((o) => {
        if (o.isMesh && o.morphTargetDictionary) {
          const d = o.morphTargetDictionary;
          if ("viseme_aa" in d) face.viseme.push(o);
          if ("eyeBlinkLeft" in d) face.blink.push(o);
          if ("browInnerUp" in d) face.brow.push(o);
          if ("mouthSmile" in d) face.smile.push(o);
        }
        if (o.isBone && /^(left|right)eye$/.test(o.name.toLowerCase())) {
          face.eyes.push({ bone: o, baseX: o.rotation.x, baseY: o.rotation.y });
        }
      });
      scene.userData.face = face;
      console.log("[FACE] viseme meshes:", face.viseme.map(m => m.name).join(",") || "NONE",
        "| blink:", face.blink.length, "| brow:", face.brow.length, "| eyes:", face.eyes.length);
      if (typeof window !== "undefined") window.__face = { viseme: face.viseme, lastViseme: "", speaking: false };
    }
    if (!scene.userData.normed) {
      scene.userData.normed = true;
      const box = new THREE.Box3().setFromObject(scene);
      const h = box.getSize(new THREE.Vector3()).y;
      scene.scale.setScalar(1.8 / h);
      scene.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(scene);
      scene.position.y -= box2.min.y;
    }
    // sport recolor: the exported look is a white tee with a PINK trim + DENIM
    // shorts — repaint the texture in place: denim -> black sport fabric,
    // pink trim -> lime (brand). Pixel masks keep the fabric shading detail.
    if (!scene.userData.recolored) {
      scene.userData.recolored = true;
      scene.traverse((o) => {
        if (!o.isMesh || o.name !== "avaturn_look_0") return;
        const tex = o.material && o.material.map;
        const img = tex && tex.image;
        if (!img || !img.width) return;
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height);
        const px = d.data;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i], gr = px[i + 1], b = px[i + 2];
          const lum = 0.299 * r + 0.587 * gr + 0.114 * b;
          if (b > r + 12 && b > gr + 6 && b > 40) {
            // denim (blue-dominant) -> dark sport fabric, keep weave shading
            const v = Math.max(14, Math.min(70, lum * 0.32));
            px[i] = v; px[i + 1] = v + 3; px[i + 2] = v + 5;
          } else if (r > 170 && r > gr + 40 && gr > b - 10 && b > 90) {
            // pink trim -> lime
            px[i] = 168; px[i + 1] = 228; px[i + 2] = 0;
          }
        }
        // jeans hardware (leather label on the seat, rivets, cord tips) isn't
        // blue so the denim mask missed it. It always sits as a bright enclave
        // INSIDE the recolored dark fabric — erode such enclaves into the fabric
        // tone. isDark matches our exact recolor signature (v, v+3, v+5), so the
        // white tank, lime trim and atlas gaps never qualify as "fabric".
        const W2 = c.width, H2 = c.height;
        const isDark = (j) => px[j] >= 12 && px[j] <= 74 &&
          Math.abs(px[j + 1] - px[j] - 3) <= 7 && Math.abs(px[j + 2] - px[j] - 5) <= 7;
        // fence the eroder inside the shorts' UV islands — cells marked by the
        // UVs of leg-weighted (or below-hip Hips-weighted) vertices, so the tank
        // island can never be nibbled no matter how close the atlas packs them
        const GRID = 128;
        const occ = new Uint8Array(GRID * GRID);
        {
          const gg2 = o.geometry;
          const uvA = gg2.attributes.uv, siA = gg2.attributes.skinIndex, swA = gg2.attributes.skinWeight;
          const legSet = new Set(), hipSet = new Set();
          let yHip2 = Infinity;
          if (o.skeleton) o.skeleton.bones.forEach((b, i) => {
            if (/^(Left|Right)(UpLeg|Leg)$/.test(b.name)) legSet.add(i);
            if (b.name === "Hips") hipSet.add(i);
            if (/^(Left|Right)UpLeg$/.test(b.name))
              yHip2 = Math.min(yHip2, new THREE.Vector3().setFromMatrixPosition(
                new THREE.Matrix4().copy(o.skeleton.boneInverses[i]).invert()).y);
          });
          const wSum = (v, set) => {
            let w = 0;
            for (let k = 0; k < 4; k++) if (set.has(siA.getComponent(v, k))) w += swA.getComponent(v, k);
            return w;
          };
          const tb = new THREE.Vector3();
          // garments are separate shells → mesh connected components ARE the
          // garment pieces. The shorts component = the one holding leg-weighted
          // verts (its waistband, label, rivets included by construction). A
          // component that ALSO reaches chest height is a top garment — veto.
          const nV = uvA.count, par = new Int32Array(nV);
          for (let i = 0; i < nV; i++) par[i] = i;
          const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
          const ix0 = gg2.index.array;
          for (let t = 0; t < ix0.length; t += 3) {
            const a = find(ix0[t]), b2 = find(ix0[t + 1]), c2 = find(ix0[t + 2]);
            if (b2 !== a) par[b2] = a;
            if (c2 !== a) par[c2] = a;
          }
          // hip-weighted counts too: the leather label is its OWN glued-on
          // component, skinned to Hips only. The chest test still kicks the
          // tank out (its component reaches chest height, shorts never do).
          const legRoot = new Set(), chestRoot = new Set();
          for (let v = 0; v < nV; v++) {
            if (wSum(v, legSet) > 0.35 || wSum(v, hipSet) > 0.45) legRoot.add(find(v));
            tb.fromBufferAttribute(gg2.attributes.position, v).applyMatrix4(o.bindMatrix);
            if (tb.y > yHip2 + 0.15) chestRoot.add(find(v));
          }
          const shortsRoot = new Set([...legRoot].filter((r) => !chestRoot.has(r)));
          const shortsVert = (v) => shortsRoot.has(find(v));
          // the leather label / rivets / cord tips are tiny glued-on components;
          // even recolored they read as raised patches — amputate their geometry
          const cnt = new Map(), bbMin = new Map(), bbMax = new Map();
          for (let v = 0; v < nV; v++) {
            const r0 = find(v);
            if (!shortsRoot.has(r0)) continue;
            cnt.set(r0, (cnt.get(r0) || 0) + 1);
            tb.fromBufferAttribute(gg2.attributes.position, v).applyMatrix4(o.bindMatrix);
            if (!bbMin.has(r0)) { bbMin.set(r0, tb.clone()); bbMax.set(r0, tb.clone()); }
            else { bbMin.get(r0).min(tb); bbMax.get(r0).max(tb); }
          }
          const junkRoot = new Set();
          for (const [r0, n0] of cnt) {
            const d = bbMax.get(r0).clone().sub(bbMin.get(r0));
            if (n0 < 400 && Math.max(d.x, d.y, d.z) < 0.09) junkRoot.add(r0);
          }
          if (junkRoot.size) {
            const keepIx = [];
            for (let t = 0; t < ix0.length; t += 3)
              if (!junkRoot.has(find(ix0[t]))) keepIx.push(ix0[t], ix0[t + 1], ix0[t + 2]);
            gg2.setIndex(keepIx);
          }
          // self-calibrate the uv->canvas vertical orientation: the right one
          // lands shorts verts on the already-recolored dark fabric
          let hitFlip = 0, hitStraight = 0;
          const probe = [];
          for (let v = 0; v < uvA.count; v += 17) if (shortsVert(v)) probe.push(v);
          for (const v of probe.slice(0, 60)) {
            const ux = Math.min(W2 - 1, Math.floor(uvA.getX(v) * W2));
            const vf = Math.min(H2 - 1, Math.floor((1 - uvA.getY(v)) * H2));
            const vs = Math.min(H2 - 1, Math.floor(uvA.getY(v) * H2));
            if (isDark((vf * W2 + ux) * 4)) hitFlip++;
            if (isDark((vs * W2 + ux) * 4)) hitStraight++;
          }
          const FLIPV = hitFlip >= hitStraight;
          // shorts cells vs veto cells (any non-shorts vertex): veto always wins,
          // so a cell shared with the tank island can never be nibbled
          const mark = new Uint8Array(GRID * GRID), veto = new Uint8Array(GRID * GRID);
          for (let v = 0; v < uvA.count; v++) {
            const cu = Math.min(GRID - 1, Math.floor(uvA.getX(v) * GRID));
            const cy = Math.min(GRID - 1, Math.floor((FLIPV ? 1 - uvA.getY(v) : uvA.getY(v)) * GRID));
            (shortsVert(v) ? mark : veto)[cy * GRID + cu] = 1;
          }
          for (let cy = 0; cy < GRID; cy++) for (let cu = 0; cu < GRID; cu++) {
            if (!mark[cy * GRID + cu]) continue; // dilate to fill vertex-grid holes
            for (let dy = -1; dy <= 1; dy++) for (let du = -1; du <= 1; du++) {
              const ny = cy + dy, nu = cu + du;
              if (ny >= 0 && ny < GRID && nu >= 0 && nu < GRID && !veto[ny * GRID + nu])
                occ[ny * GRID + nu] = 1;
            }
          }
          // the leather label proved to be WELDED into the waistband shell (no
          // component of its own): find its raised layer inside a bind-space box
          // at the back-right waist — verts sitting farther from the waist axis
          // than the base fabric — sink them under the band and force their
          // texels into the fill region
          const LB = { x0: 0.02, x1: 0.16, y0: 0.96, y1: 1.10, z0: -0.15, z1: -0.02 };
          const nra = gg2.attributes.normal, boxV = [];
          let rMin = Infinity;
          for (let v = 0; v < nV; v++) {
            if (!shortsVert(v)) continue; // never sink or unmask the tank
            tb.fromBufferAttribute(gg2.attributes.position, v).applyMatrix4(o.bindMatrix);
            if (tb.x < LB.x0 || tb.x > LB.x1 || tb.y < LB.y0 || tb.y > LB.y1 ||
              tb.z < LB.z0 || tb.z > LB.z1) continue;
            const rad2 = Math.hypot(tb.x, tb.z + 0.02);
            boxV.push([v, rad2]); if (rad2 < rMin) rMin = rad2;
          }
          const nv2 = new THREE.Vector3();
          for (const [v, rad2] of boxV) {
            if (rad2 < rMin + 0.0015) continue; // base waistband fabric stays
            nv2.fromBufferAttribute(nra, v).multiplyScalar(0.005);
            gg2.attributes.position.setXYZ(v,
              gg2.attributes.position.getX(v) - nv2.x,
              gg2.attributes.position.getY(v) - nv2.y,
              gg2.attributes.position.getZ(v) - nv2.z);
            const cu = Math.min(GRID - 1, Math.floor(uvA.getX(v) * GRID));
            const cy = Math.min(GRID - 1, Math.floor((FLIPV ? 1 - uvA.getY(v) : uvA.getY(v)) * GRID));
            occ[cy * GRID + cu] = 1; // calibrated orientation only — veto stays intact
          }
          if (boxV.length) gg2.attributes.position.needsUpdate = true;
        }
        // inside the shorts component's cells, anything still bright and
        // non-lime is jeans hardware (leather label, rivets, cord tips) —
        // flatten it into the fabric tone, no ring tests needed
        for (let y = 0; y < H2; y++) {
          const cyG = Math.floor(y / H2 * GRID) * GRID;
          for (let x = 0; x < W2; x++) {
            if (!occ[cyG + Math.floor(x / W2 * GRID)]) continue;
            const j = (y * W2 + x) * 4;
            const r = px[j], gr = px[j + 1], b = px[j + 2];
            if (gr > r + 12) continue; // lime trim stays
            const lum = 0.299 * r + 0.587 * gr + 0.114 * b;
            if (lum < 85) continue;    // already fabric
            const v = Math.max(16, Math.min(60, lum * 0.22));
            px[j] = v; px[j + 1] = v + 3; px[j + 2] = v + 5;
          }
        }
        g.putImageData(d, 0, 0);
        const nt = new THREE.CanvasTexture(c);
        nt.flipY = tex.flipY; nt.colorSpace = tex.colorSpace;
        nt.wrapS = tex.wrapS; nt.wrapT = tex.wrapT;
        o.material.map = nt;
        o.material.needsUpdate = true;
      });
    }
    // безрукавка: cut the tee's sleeves — drop triangles whose verts are skinned
    // to the arm bones; the exposed shoulders are backed by the FULL body mesh
    // (AvaturnBody.glb, "Body only" export) swapped in below
    if (!scene.userData.sleeveCut) {
      scene.userData.sleeveCut = true;
      scene.traverse((o) => {
        if (!o.isSkinnedMesh || o.name !== "avaturn_look_0" || !o.geometry.index) return;
        const g = o.geometry;
        const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, ps = g.attributes.position;
        const armIdx = new Set(), armX = [], armY = [], armZ = [];
        o.skeleton.bones.forEach((b, i) => {
          if (/^(Left|Right)(Arm|ForeArm)$/.test(b.name)) armIdx.add(i);
          if (/^(Left|Right)Arm$/.test(b.name)) {
            const m = new THREE.Matrix4().copy(o.skeleton.boneInverses[i]).invert();
            const p = new THREE.Vector3().setFromMatrixPosition(m);
            armX.push(Math.abs(p.x)); armY.push(p.y); armZ.push(p.z);
          }
        });
        // sleeve = arm-weighted fabric inside the TUBE around the arm axis (in
        // T-pose bind the axis runs along ±X through the shoulder joint; measured
        // drape reaches rad≈0.09, so the tube is 0.105) starting just outside the
        // joint, PLUS the thin flaps right on top of the shoulder. The armhole
        // borders on the blade/chest sit inboard of the joint and survive.
        const armXmin = Math.min(...armX), shY = Math.min(...armY);
        const cutX = armXmin - 0.008;
        const zJ = armZ.reduce((a, b) => a + b, 0) / armZ.length;
        const tmp = new THREE.Vector3();
        const armW = (v) => {
          let w = 0;
          for (let c = 0; c < 4; c++) if (armIdx.has(si.getComponent(v, c))) w += sw.getComponent(v, c);
          return w;
        };
        const sleeve = (v) => {
          if (armW(v) <= 0.30) return false;
          tmp.fromBufferAttribute(ps, v).applyMatrix4(o.bindMatrix);
          const rad = Math.hypot(tmp.y - shY, tmp.z - zJ);
          // top clause only outboard: inboard shoulder fabric stays = wider
          // straps that actually cover the deltoid patch seam
          return (rad < 0.105 && Math.abs(tmp.x) > cutX) ||
            (rad < 0.05 && tmp.y > shY + 0.012 && Math.abs(tmp.x) > cutX - 0.004);
        };
        const idx = g.index.array, keep = [];
        for (let t = 0; t < idx.length; t += 3) {
          if (!(sleeve(idx[t]) && sleeve(idx[t + 1]) && sleeve(idx[t + 2])))
            keep.push(idx[t], idx[t + 1], idx[t + 2]);
        }
        g.setIndex(keep);
        // the cut strands tiny fabric flaps at the armhole (triangles with mixed
        // sleeve/keep verts lose their neighbours) — too small for the boundary
        // loops, immune to smoothing. Drop every small disconnected island.
        {
          const par2 = new Int32Array(ps.count);
          for (let i = 0; i < ps.count; i++) par2[i] = i;
          const find2 = (a) => { while (par2[a] !== a) { par2[a] = par2[par2[a]]; a = par2[a]; } return a; };
          for (let t = 0; t < keep.length; t += 3) {
            const a = find2(keep[t]), b2 = find2(keep[t + 1]), c2 = find2(keep[t + 2]);
            if (b2 !== a) par2[b2] = a;
            if (c2 !== a) par2[c2] = a;
          }
          const cnt2 = new Map();
          for (const v of keep) { const r0 = find2(v); cnt2.set(r0, (cnt2.get(r0) || 0) + 1); }
          const keep2 = [];
          for (let t = 0; t < keep.length; t += 3)
            if (cnt2.get(find2(keep[t])) >= 120) keep2.push(keep[t], keep[t + 1], keep[t + 2]);
          keep.length = 0;
          for (const v of keep2) keep.push(v);
          g.setIndex(keep);
        }
        // lime piping over the raw armhole edges — real tanks bind this seam,
        // and the tube hides the triangle-level jaggedness for good. The tube is
        // skinned with weights copied from the nearest edge vertex, so it moves
        // with the shoulder like sewn-on trim.
        {
          const eCount = new Map();
          for (let t = 0; t < keep.length; t += 3) {
            for (const [a, b2] of [[keep[t], keep[t + 1]], [keep[t + 1], keep[t + 2]], [keep[t + 2], keep[t]]]) {
              const k2 = a < b2 ? a * 1000000 + b2 : b2 * 1000000 + a;
              eCount.set(k2, (eCount.get(k2) || 0) + 1);
            }
          }
          const adj = new Map();
          for (const [k2, c2] of eCount) {
            if (c2 !== 1) continue;
            const a = Math.floor(k2 / 1000000), b2 = k2 % 1000000;
            if (!adj.has(a)) adj.set(a, []);
            if (!adj.has(b2)) adj.set(b2, []);
            adj.get(a).push(b2); adj.get(b2).push(a);
          }
          const seenV = new Set(), loops = [];
          for (const start of adj.keys()) {
            if (seenV.has(start)) continue;
            const loop = [start]; seenV.add(start);
            let prev = -1, cur = start;
            for (;;) {
              const nx = (adj.get(cur) || []).find((n2) => n2 !== prev && !seenV.has(n2));
              if (nx === undefined) break;
              loop.push(nx); seenV.add(nx); prev = cur; cur = nx;
            }
            if (loop.length > 12) loops.push(loop);
          }
          const bindOf = (v) => tmp.fromBufferAttribute(ps, v).applyMatrix4(o.bindMatrix).clone();
          const pipeMat = new THREE.MeshStandardMaterial({ color: "#c8e83c", roughness: 0.7 });
          for (const loop of loops) {
            let mx = 0, my = 0;
            for (const v of loop) { const p = bindOf(v); mx += Math.abs(p.x); my += p.y; }
            mx /= loop.length; my /= loop.length;
            if (mx < cutX - 0.06 || my < shY - 0.22) continue; // skip neck + hems
            const raw = loop.map((v) => new THREE.Vector3().fromBufferAttribute(ps, v));
            // Laplacian smoothing: the boundary is a triangle staircase; the
            // piping should ride its midline, not every tooth. Then re-inflate
            // about the centroid to counter Laplacian shrinkage.
            for (let it2 = 0; it2 < 6; it2++) {
              const src2 = raw.map((p) => p.clone());
              for (let i2 = 0; i2 < raw.length; i2++) {
                const a2 = src2[(i2 + raw.length - 1) % raw.length];
                const b3 = src2[(i2 + 1) % raw.length];
                raw[i2].copy(src2[i2]).multiplyScalar(0.4)
                  .addScaledVector(a2, 0.3).addScaledVector(b3, 0.3);
              }
            }
            const ctr2 = raw.reduce((a2, p) => a2.add(p), new THREE.Vector3()).multiplyScalar(1 / raw.length);
            for (const p of raw) p.sub(ctr2).multiplyScalar(1.02).add(ctr2);
            // write the smoothed line back into the fabric itself: the staircase
            // edge becomes a smooth hem, and the piping rides exactly on it
            for (let j2 = 0; j2 < loop.length; j2++)
              ps.setXYZ(loop[j2], raw[j2].x, raw[j2].y, raw[j2].z);
            ps.needsUpdate = true;
            const tg2 = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(raw, true),
              loop.length * 2, 0.0035, 6, true);
            const tp = tg2.attributes.position, cnt2 = tp.count;
            const tsi = new THREE.Uint16BufferAttribute(new Uint16Array(cnt2 * 4), 4);
            const tsw = new THREE.Float32BufferAttribute(new Float32Array(cnt2 * 4), 4);
            const vv = new THREE.Vector3();
            for (let i2 = 0; i2 < cnt2; i2++) {
              vv.fromBufferAttribute(tp, i2);
              let best = loop[0], bd = Infinity;
              for (let j2 = 0; j2 < raw.length; j2++) {
                const d2 = vv.distanceToSquared(raw[j2]);
                if (d2 < bd) { bd = d2; best = loop[j2]; }
              }
              for (let c2 = 0; c2 < 4; c2++) {
                tsi.setComponent(i2, c2, si.getComponent(best, c2));
                tsw.setComponent(i2, c2, sw.getComponent(best, c2));
              }
            }
            tg2.setAttribute("skinIndex", tsi);
            tg2.setAttribute("skinWeight", tsw);
            const pipe = new THREE.SkinnedMesh(tg2, pipeMat);
            pipe.skeleton = o.skeleton; pipe.bindMatrix.copy(o.bindMatrix);
            pipe.bindMode = o.bindMode; pipe.frustumCulled = false;
            pipe.name = "armhole_pipe";
            o.parent.add(pipe);
          }
        }
        // opaque outer shell of the tank: a +1.8mm copy along bind normals that
        // permanently swallows any skin poking through the base fabric in
        // animated poses (shoulder patch, blade band) — двойная ткань
        {
          let yHipS = Infinity;
          o.skeleton.bones.forEach((b, i) => {
            if (/^(Left|Right)UpLeg$/.test(b.name))
              yHipS = Math.min(yHipS, new THREE.Vector3().setFromMatrixPosition(
                new THREE.Matrix4().copy(o.skeleton.boneInverses[i]).invert()).y);
          });
          const bindYof = (v) => tmp.fromBufferAttribute(ps, v).applyMatrix4(o.bindMatrix).y;
          const nr = g.attributes.normal;
          const p0 = ps.array.slice();
          for (let v = 0; v < ps.count; v++) {
            p0[v * 3] += nr.getX(v) * 0.0018;
            p0[v * 3 + 1] += nr.getY(v) * 0.0018;
            p0[v * 3 + 2] += nr.getZ(v) * 0.0018;
          }
          const sg3 = new THREE.BufferGeometry();
          sg3.setAttribute("position", new THREE.Float32BufferAttribute(p0, 3));
          sg3.setAttribute("normal", nr.clone());
          sg3.setAttribute("uv", g.attributes.uv.clone());
          sg3.setAttribute("skinIndex", si.clone());
          sg3.setAttribute("skinWeight", sw.clone());
          // congruent with the base cut: same edge line, so the armhole piping
          // (r 3.8mm > the 1.8mm shell offset) binds both layers into one seam
          const tankIx = [];
          for (let t = 0; t < keep.length; t += 3) {
            if (bindYof(keep[t]) > yHipS + 0.02 && bindYof(keep[t + 1]) > yHipS + 0.02 &&
              bindYof(keep[t + 2]) > yHipS + 0.02)
              tankIx.push(keep[t], keep[t + 1], keep[t + 2]);
          }
          sg3.setIndex(tankIx);
          const shell = new THREE.SkinnedMesh(sg3, o.material);
          shell.skeleton = o.skeleton; shell.bindMatrix.copy(o.bindMatrix);
          shell.bindMode = o.bindMode; shell.frustumCulled = false;
          shell.name = "tank_shell";
          o.parent.add(shell);
        }
      });
      // shoulders under the cut: take ONLY the deltoid patch from the full-body
      // export (keeping its torso would poke through the shirt), native partial
      // body keeps doing arms/legs/neck
      const partial = scene.getObjectByName("Body_Mesh");
      if (partial) {
        new GLTFLoader().load("/AvaturnBody.glb", (g) => {
          const full = g.scene.getObjectByName("Body_Full") || g.scene.getObjectByName("Body_Mesh");
          if (!full) return;
          const fg = full.geometry;
          const fsi = fg.attributes.skinIndex, fsw = fg.attributes.skinWeight;
          const shIdx = new Set();
          full.skeleton.bones.forEach((b, i) => {
            if (/^(Left|Right)(Shoulder|Arm|ForeArm)$/.test(b.name)) shIdx.add(i);
          });
          const shW = (v) => {
            let w = 0;
            for (let c = 0; c < 4; c++) if (shIdx.has(fsi.getComponent(v, c))) w += fsw.getComponent(v, c);
            return w;
          };
          // the patch may only live in the window the sleeve cut exposed
          // (outboard of the shoulder joint); its inboard band would z-fight
          // through the shirt in animated poses
          const fps = fg.attributes.position, fnr = fg.attributes.normal;
          const fArmX = [], fArmY = [];
          full.skeleton.bones.forEach((b, i) => {
            if (/^(Left|Right)Arm$/.test(b.name)) {
              const m = new THREE.Matrix4().copy(full.skeleton.boneInverses[i]).invert();
              const p = new THREE.Vector3().setFromMatrixPosition(m);
              fArmX.push(Math.abs(p.x)); fArmY.push(p.y);
            }
          });
          const fCutX = Math.min(...fArmX) - 0.02, fShY = Math.min(...fArmY);
          const tv = new THREE.Vector3();
          // same diagonal metric as the sleeve cut, so the skin window matches it
          const fEff = (v) => {
            tv.fromBufferAttribute(fps, v).applyMatrix4(full.bindMatrix);
            return Math.abs(tv.x) + Math.max(0, tv.y - (fShY - 0.02)) * 1.4;
          };
          // LEG patch: the original pants were longer, so Avaturn culled the
          // thigh/knee skin from the native body — the shortened loose shorts
          // exposed the void. Take that band from the full-body export too.
          const legIdxF = new Set();
          let fYHip = Infinity, fYKnee = -Infinity;
          full.skeleton.bones.forEach((b, i) => {
            if (/^(Left|Right)(UpLeg|Leg)$/.test(b.name)) legIdxF.add(i);
            const mm = new THREE.Matrix4().copy(full.skeleton.boneInverses[i]).invert();
            const py = new THREE.Vector3().setFromMatrixPosition(mm).y;
            if (/^(Left|Right)UpLeg$/.test(b.name)) fYHip = Math.min(fYHip, py);
            if (/^(Left|Right)Leg$/.test(b.name)) fYKnee = Math.max(fYKnee, py);
          });
          const legW = (v) => {
            let w = 0;
            for (let c = 0; c < 4; c++) if (legIdxF.has(fsi.getComponent(v, c))) w += fsw.getComponent(v, c);
            return w;
          };
          const fY = (v) => { tv.fromBufferAttribute(fps, v).applyMatrix4(full.bindMatrix); return tv.y; };
          const legKeep = (v) => {
            if (legW(v) <= 0.2) return false;
            const y = fY(v);
            return y < fYHip - 0.02 && y > fYKnee - 0.12; // thigh + knee band
          };
          // low weight threshold: blade skin is mostly Spine2-weighted, and the
          // window+tuck keep anything extra safely under the shirt
          const fidx = fg.index.array, fkeep = [];
          for (let t = 0; t < fidx.length; t += 3) {
            const w = shW(fidx[t]) > 0.22 || shW(fidx[t + 1]) > 0.22 || shW(fidx[t + 2]) > 0.22;
            const inWin = fEff(fidx[t]) > fCutX - 0.022 || fEff(fidx[t + 1]) > fCutX - 0.022 ||
              fEff(fidx[t + 2]) > fCutX - 0.022;
            const legs = legKeep(fidx[t]) || legKeep(fidx[t + 1]) || legKeep(fidx[t + 2]);
            if ((w && inWin) || legs) fkeep.push(fidx[t], fidx[t + 1], fidx[t + 2]);
          }
          fg.setIndex(fkeep);
          // tuck the overlap band (still under the shirt) inward along normals —
          // deep enough to survive skinning-weight mismatch in animated poses
          const nrm = new THREE.Vector3();
          const zBind = [];
          full.skeleton.bones.forEach((b, i) => {
            if (/^(Left|Right)Arm$/.test(b.name)) {
              const m = new THREE.Matrix4().copy(full.skeleton.boneInverses[i]).invert();
              zBind.push(new THREE.Vector3().setFromMatrixPosition(m).z);
            }
          });
          const zJf = zBind.reduce((a, b) => a + b, 0) / zBind.length;
          const sink = (v, d) => {
            nrm.fromBufferAttribute(fnr, v).multiplyScalar(d);
            fps.setXYZ(v, fps.getX(v) - nrm.x, fps.getY(v) - nrm.y, fps.getZ(v) - nrm.z);
          };
          for (let v = 0; v < fps.count; v++) {
            const y = fY(v);
            if (y > fShY - 0.30) {
              // shoulder zone: window-feathered tuck under the shirt
              const t = Math.min(1, Math.max(0, (fCutX + 0.030 - fEff(v)) / 0.055));
              if (t > 0) {
                // fEff left the bind position in tv; the blade side (behind the
                // joint) deforms hardest against the shirt, sink it deeper
                sink(v, (tv.z < zJf + 0.005 ? 0.007 : 0.0035) * t);
              }
            } else if (y < fYHip && y > fYKnee - 0.13) {
              // leg zone: knee band stays true skin; the part under the shorts
              // and the strip overlapping the native shin get tucked inward
              if (y > fYKnee + 0.105) sink(v, 0.0025);
              else if (y < fYKnee - 0.02) sink(v, 0.002);
            }
          }
          fps.needsUpdate = true;
          full.skeleton = partial.skeleton;       // same rig, same joint order — verified
          full.bindMatrix.copy(partial.bindMatrix);
          full.bindMode = partial.bindMode;
          full.frustumCulled = false;
          full.name = "Body_Full";
          partial.parent.add(full);
          // the native body keeps its own ragged cull line at the old sleeve hem
          // (Avaturn cut the skin under the tee's sleeves) — that staircase is
          // what peeks at the armhole. The patch owns the upper arm now: cut the
          // native deltoid/biceps above the elbow entirely.
          {
            const pg = partial.geometry;
            const psi = pg.attributes.skinIndex, psw = pg.attributes.skinWeight;
            const pArm = new Set(); let elbowX = Infinity;
            partial.skeleton.bones.forEach((b, i) => {
              if (/^(Left|Right)(Arm|ForeArm)$/.test(b.name)) pArm.add(i);
              if (/^(Left|Right)ForeArm$/.test(b.name))
                elbowX = Math.min(elbowX, Math.abs(new THREE.Vector3().setFromMatrixPosition(
                  new THREE.Matrix4().copy(partial.skeleton.boneInverses[i]).invert()).x));
            });
            const pw2 = (v) => {
              let w = 0;
              for (let c = 0; c < 4; c++) if (pArm.has(psi.getComponent(v, c))) w += psw.getComponent(v, c);
              return w;
            };
            const pps = pg.attributes.position, pv2 = new THREE.Vector3();
            const upperArm = (v) => {
              if (pw2(v) <= 0.2) return false;
              pv2.fromBufferAttribute(pps, v).applyMatrix4(partial.bindMatrix);
              return Math.abs(pv2.x) < elbowX - 0.02;
            };
            const pidx = pg.index.array, pkeep = [];
            for (let t = 0; t < pidx.length; t += 3) {
              if (!(upperArm(pidx[t]) && upperArm(pidx[t + 1]) && upperArm(pidx[t + 2])))
                pkeep.push(pidx[t], pidx[t + 1], pidx[t + 2]);
            }
            pg.setIndex(pkeep);
          }
        });
      }
    }
    // loose pro-match shorts: the base pair hugs the thighs; real tennis shorts
    // (Alcaraz/Sinner cut) hang from the waistband and flare toward the hem.
    // Inflate the shorts region radially away from each leg's bind axis, growing
    // toward the hem + a small hem drop. Waistband stays snug, the crotch gusset
    // barely moves, inner faces push less so left/right fabric can't collide.
    if (!scene.userData.shortsLoose) {
      scene.userData.shortsLoose = true;
      const PUSH = parseFloat(FLAGS.get("baggy")) || 0.028; // live knob: ?baggy=
      scene.traverse((o) => {
        if (!o.isSkinnedMesh || o.name !== "avaturn_look_0" || !o.geometry.index) return;
        const g = o.geometry;
        const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, ps = g.attributes.position;
        const legIdx = new Set(), hipIdx = new Set(), legPos = {};
        let yKnee = -Infinity;
        o.skeleton.bones.forEach((b, i) => {
          if (/^(Left|Right)(UpLeg|Leg)$/.test(b.name)) legIdx.add(i);
          if (b.name === "Hips") hipIdx.add(i);
          const m = new THREE.Matrix4().copy(o.skeleton.boneInverses[i]).invert();
          if (/^(Left|Right)UpLeg$/.test(b.name))
            legPos[b.name[0]] = new THREE.Vector3().setFromMatrixPosition(m);
          if (/^(Left|Right)Leg$/.test(b.name))
            yKnee = Math.max(yKnee, new THREE.Vector3().setFromMatrixPosition(m).y);
        });
        if (!legPos.L || !legPos.R || yKnee === -Infinity) return;
        const yHip = Math.min(legPos.L.y, legPos.R.y), yStart = yHip + 0.02;
        // pro-length hem: well above the knee; extra fabric below is compressed
        // into a tight band there, reading as the rolled cuff
        const hemT = yKnee + 0.11;
        const wOf = (v, set) => {
          let w = 0;
          for (let c = 0; c < 4; c++) if (set.has(si.getComponent(v, c))) w += sw.getComponent(v, c);
          return w;
        };
        const tv = new THREE.Vector3(), pv = new THREE.Vector3();
        const marks = new Uint8Array(ps.count);
        let hemY = Infinity;
        for (let v = 0; v < ps.count; v++) {
          if (wOf(v, legIdx) + wOf(v, hipIdx) * 0.5 <= 0.15) continue;
          tv.fromBufferAttribute(ps, v).applyMatrix4(o.bindMatrix);
          if (tv.y >= yStart) continue;
          marks[v] = 1; // shorts (plus the tee's lowest fringe — a mm there is fine)
          if (tv.y < hemY) hemY = tv.y;
        }
        if (hemY >= yStart) return;
        const span = yStart - hemT, inv = o.bindMatrix.clone().invert();
        for (let v = 0; v < ps.count; v++) {
          if (!marks[v]) continue;
          tv.fromBufferAttribute(ps, v).applyMatrix4(o.bindMatrix);
          const t = Math.min(1, Math.max(0, (yStart - tv.y) / span));
          const leg = Math.abs(tv.x - legPos.L.x) < Math.abs(tv.x - legPos.R.x) ? legPos.L : legPos.R;
          let dx = tv.x - leg.x, dz = tv.z - leg.z;
          const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
          const outer = 0.45 + 0.55 * Math.max(0, dx * Math.sign(leg.x)); // inner side pushes less
          const gusset = Math.min(1, Math.abs(tv.x) / 0.035);             // midline fabric stays
          const push = PUSH * Math.pow(t, 0.75) * outer * gusset;
          const sx = Math.sign(tv.x) || 1;
          tv.x += dx * push; tv.z += dz * push;
          if (Math.sign(tv.x) !== sx) tv.x = 0.002 * sx; // never cross the midline
          if (tv.y < hemT) tv.y = hemT - (hemT - tv.y) * 0.08; // squash into the cuff
          pv.copy(tv).applyMatrix4(inv);
          ps.setXYZ(v, pv.x, pv.y, pv.z);
        }
        ps.needsUpdate = true;
        o.material.side = THREE.DoubleSide; // hem interior visible from low angles
        o.material.needsUpdate = true;
      });
    }
    // grip curls (persist; clips never touch right-hand fingers)
    const rot = (k, dx, dy, dz) => { const b = bones[k]; if (!b) return;
      b.rotation.set(b.rotation.x + dx, b.rotation.y + dy, b.rotation.z + dz); };
    if (!scene.userData.gripped) {
      scene.userData.gripped = true;
      if (CHAR === "ch28") {
        for (const f of ["index", "middle", "ring", "pinky"]) {
          rot(f + 1, 0, 0, -CURL.f1); rot(f + 2, 0, 0, -CURL.f2); rot(f + 3, 0, 0, -CURL.f3);
        }
        rot("thumb1", CURL.t1x, 0, 0); rot("thumb2", 0, 0, CURL.t2z); rot("thumb3", 0, 0, CURL.t3z);
      } else {
        curlFistWorldAxes(scene, bones);
      }
    }
    // racquet parented to the right hand — proper tennis proportions:
    // elliptical hoop + V-throat + octagonal grip + real string grid (canvas texture)
    if (bones.rHand && !bones.rHand.getObjectByName("racq")) {
      const rq = new THREE.Group(); rq.name = "racq";
      const frameMat = new THREE.MeshStandardMaterial({ color: "#17191d", roughness: 0.35, metalness: 0.5 });
      const limeMat = new THREE.MeshStandardMaterial({ color: "#c8ff00", roughness: 0.45, metalness: 0.15, emissive: "#3d5500", emissiveIntensity: 0.4 });
      // the racquet inherits the hand bone's scale, so it stays proportional to
      // the athlete no matter how Avaturn sizes the arms — like a grip picked
      // for the player's hand
      const GRIP_SIZE = 1.0;
      // pro handle: CRISP octagon bevels (flat shading — smoothed normals read
      // as a round sausage) + spiral overgrip texture, like an ATP overwrap
      const og = document.createElement("canvas"); og.width = og.height = 128;
      const c2 = og.getContext("2d");
      c2.fillStyle = "#2a2d33"; c2.fillRect(0, 0, 128, 128);
      c2.strokeStyle = "rgba(255,255,255,0.12)"; c2.lineWidth = 6;
      for (let i = -128; i < 256; i += 24) {
        c2.beginPath(); c2.moveTo(i, 128); c2.lineTo(i + 128, 0); c2.stroke();
      }
      c2.strokeStyle = "rgba(0,0,0,0.35)"; c2.lineWidth = 2;
      for (let i = -128; i < 256; i += 24) {
        c2.beginPath(); c2.moveTo(i + 7, 128); c2.lineTo(i + 135, 0); c2.stroke();
      }
      const gripTex = new THREE.CanvasTexture(og);
      gripTex.wrapS = gripTex.wrapT = THREE.RepeatWrapping; gripTex.repeat.set(3, 3);
      const gripMat = new THREE.MeshStandardMaterial({ map: gripTex, roughness: 0.92, flatShading: true });

      // bevel #1 flat faces the string plane (+Z): thetaStart -π/8 centers a facet there
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0165 * GRIP_SIZE, 0.018 * GRIP_SIZE, 0.19, 8, 1, false, -Math.PI / 8), gripMat);
      grip.position.y = 0.105; rq.add(grip);
      // flared butt cap (wider than the handle, like a real racquet) + end sticker
      const capMat = new THREE.MeshStandardMaterial({ color: "#17191d", roughness: 0.5, flatShading: true });
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0195 * GRIP_SIZE, 0.021 * GRIP_SIZE, 0.016, 8, 1, false, -Math.PI / 8), capMat);
      cap.position.y = 0.008; rq.add(cap);
      const stick = document.createElement("canvas"); stick.width = stick.height = 64;
      const c3 = stick.getContext("2d");
      c3.fillStyle = "#17191d"; c3.beginPath(); c3.arc(32, 32, 32, 0, 7); c3.fill();
      c3.strokeStyle = "#c8ff00"; c3.lineWidth = 5; c3.beginPath(); c3.arc(32, 32, 26, 0, 7); c3.stroke();
      c3.fillStyle = "#c8ff00"; c3.font = "bold 18px monospace"; c3.textAlign = "center"; c3.textBaseline = "middle";
      c3.fillText("ACE", 32, 33);
      const sticker = new THREE.Mesh(new THREE.CircleGeometry(0.0185, 24),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(stick) }));
      sticker.rotation.x = Math.PI / 2; sticker.position.y = -0.0002; rq.add(sticker);
      // collar where the overgrip ends and the shaft begins (lime accent ring)
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0172 * GRIP_SIZE, 0.018, 8, 1, false, -Math.PI / 8), limeMat);
      collar.position.y = 0.207; rq.add(collar);

      // ---- PRO FRAME: modern ATP geometry (averaged Blade/Pure-Aero/Speed) ----
      // superellipse head (boxier top than an ellipse), aero BEAM cross-section
      // (deep across the string plane, thin in-plane), lime gloss paint
      const paintMat = new THREE.MeshPhysicalMaterial({
        color: "#a4e400", metalness: 0.2, roughness: 0.3,
        clearcoat: 0.8, clearcoatRoughness: 0.25, emissive: "#1d2a00", emissiveIntensity: 0.3 });
      const blackMat = new THREE.MeshStandardMaterial({ color: "#101216", roughness: 0.5, metalness: 0.3 });
      const SE_N = 2.5, RXh = 0.124, RYh = 0.156, HOOP_Y = 0.5; // 100in² head, 27in total
      const sePoint = (a) => {
        const c = Math.cos(a), s = Math.sin(a), p = 2 / SE_N;
        return new THREE.Vector3(RXh * Math.sign(c) * Math.abs(c) ** p,
          RYh * Math.sign(s) * Math.abs(s) ** p, 0);
      };
      class SEArc extends THREE.Curve {
        constructor(a0 = 0, a1 = Math.PI * 2) { super(); this.a0 = a0; this.a1 = a1; }
        getPoint(t) { return sePoint(this.a0 + (this.a1 - this.a0) * t); }
      }
      // cross-section: rounded-rectangle beam 23mm deep × 12mm in-plane —
      // real frames are boxy with soft chamfers, not elliptical sausages
      const bw = 0.006, bd = 0.0115, br = 0.0035;
      const beam = new THREE.Shape();
      beam.moveTo(-bw + br, -bd);
      beam.lineTo(bw - br, -bd); beam.quadraticCurveTo(bw, -bd, bw, -bd + br);
      beam.lineTo(bw, bd - br); beam.quadraticCurveTo(bw, bd, bw - br, bd);
      beam.lineTo(-bw + br, bd); beam.quadraticCurveTo(-bw, bd, -bw, bd - br);
      beam.lineTo(-bw, -bd + br); beam.quadraticCurveTo(-bw, -bd, -bw + br, -bd);
      const hoop = new THREE.Mesh(new THREE.ExtrudeGeometry(beam, {
        extrudePath: new SEArc(), steps: 140, curveSegments: 12 }), paintMat);
      hoop.position.y = HOOP_Y; rq.add(hoop);
      // bumper guard: black cap on the outer edge, 10-to-2 o'clock
      const bumpShape = new THREE.Shape();
      bumpShape.absellipse(0, 0, 0.0045, 0.0128, 0, Math.PI * 2);
      const bumper = new THREE.Mesh(new THREE.ExtrudeGeometry(bumpShape, {
        extrudePath: new SEArc(Math.PI * 0.3, Math.PI * 0.7), steps: 40, curveSegments: 10 }), blackMat);
      bumper.position.y = HOOP_Y; rq.add(bumper);
      // shaft: single lime beam from the collar up to the throat split
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.0135, 0.075, 12), paintMat);
      shaft.position.y = 0.253; rq.add(shaft);
      // open throat: two beams sweeping from the shaft top INTO the hoop (~5 & 7 o'clock)
      const joinA = 1.25 * Math.PI, joinB = 1.75 * Math.PI; // superellipse angles
      for (const [aJoin, sx] of [[joinA, -1], [joinB, 1]]) {
        const j = sePoint(aJoin).add(new THREE.Vector3(0, HOOP_Y, 0));
        const path = new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 0.283, 0),
          new THREE.Vector3(sx * 0.028, 0.315, 0),
          new THREE.Vector3(j.x * 0.94, j.y - 0.012, 0),
          j,
        ]);
        const armGeo = new THREE.ExtrudeGeometry(beam, { extrudePath: path, steps: 32, curveSegments: 10 });
        rq.add(new THREE.Mesh(armGeo, paintMat));
      }
      // yoke: straight black bridge closing the throat between the join points
      const yA = sePoint(joinA).add(new THREE.Vector3(0, HOOP_Y, 0));
      const yB = sePoint(joinB).add(new THREE.Vector3(0, HOOP_Y, 0));
      const yokeShape = new THREE.Shape();
      yokeShape.absellipse(0, 0, 0.0055, 0.0105, 0, Math.PI * 2);
      const yoke = new THREE.Mesh(new THREE.ExtrudeGeometry(yokeShape, {
        extrudePath: new THREE.LineCurve3(yA, yB), steps: 2, curveSegments: 10 }), blackMat);
      rq.add(yoke);

      // strings: REAL 3D strings — 16 mains + 19 crosses as thin cylinders,
      // each clipped to the inner superellipse (y = ry(1-|x/rx|^n)^(1/n))
      const rxI = RXh * 0.947, ryI = RYh * 0.947;
      const seY = (x) => ryI * Math.max(0, 1 - Math.abs(x / rxI) ** SE_N) ** (1 / SE_N);
      const seX = (y) => rxI * Math.max(0, 1 - Math.abs(y / ryI) ** SE_N) ** (1 / SE_N);
      const strGeos = [];
      const addStr = (len, x, y, vertical) => {
        if (len < 0.01) return;
        const g = new THREE.CylinderGeometry(0.00075, 0.00075, len, 5);
        if (!vertical) g.rotateZ(Math.PI / 2);
        // mains ride slightly in front of crosses — reads as a real weave
        g.translate(x, y, vertical ? 0.0007 : -0.0007);
        strGeos.push(g);
      };
      for (let i = 0; i < 16; i++) { // mains
        const x = ((i / 15) - 0.5) * 2 * rxI * 0.8;
        addStr(2 * seY(x) - 0.004, x, 0, true);
      }
      for (let j = 0; j < 19; j++) { // crosses
        const y = ((j / 18) - 0.5) * 2 * ryI * 0.85;
        addStr(2 * seX(y) - 0.004, 0, y, false);
      }
      const strMat = new THREE.MeshStandardMaterial({ color: "#e9e5da", roughness: 0.55, metalness: 0.05 });
      const strings = new THREE.Mesh(mergeGeometries(strGeos), strMat);
      strings.position.y = HOOP_Y; rq.add(strings);
      // faint lime stencil ink "floating" on the bed (pros stencil the brand on)
      const sc = document.createElement("canvas"); sc.width = sc.height = 256;
      const sg = sc.getContext("2d");
      sg.strokeStyle = "rgba(168,228,0,0.55)"; sg.lineWidth = 13; sg.lineCap = "round";
      sg.beginPath(); sg.moveTo(92, 168); sg.lineTo(128, 88); sg.lineTo(164, 168); sg.stroke();
      sg.beginPath(); sg.moveTo(106, 138); sg.lineTo(150, 138); sg.stroke();
      const stencil = new THREE.Mesh(new THREE.PlaneGeometry(rxI * 1.1, rxI * 1.1),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      stencil.position.set(0, HOOP_Y, 0.0012); rq.add(stencil);
      // grommet strip: black plastic band along the inner rim where strings enter
      const gromShape = new THREE.Shape();
      gromShape.absellipse(0, 0, 0.0022, 0.009, 0, Math.PI * 2);
      class SEArcIn extends THREE.Curve {
        getPoint(t) { const p = sePoint(t * Math.PI * 2); return new THREE.Vector3(p.x * 0.968, p.y * 0.968, 0); }
      }
      const grommets = new THREE.Mesh(new THREE.ExtrudeGeometry(gromShape, {
        extrudePath: new SEArcIn(), steps: 120, curveSegments: 8 }), blackMat);
      grommets.position.y = HOOP_Y; rq.add(grommets);
      // vibration dampener: the little rubber button every player's racquet has
      const damp = new THREE.Mesh(new THREE.CylinderGeometry(0.0062, 0.0062, 0.007, 16), limeMat);
      damp.rotation.x = Math.PI / 2;
      damp.position.set(0.0045, HOOP_Y - ryI * 0.78, 0); rq.add(damp);
      // shaft decal: brand text on both faces
      const dc = document.createElement("canvas"); dc.width = 256; dc.height = 64;
      const dg = dc.getContext("2d");
      dg.fillStyle = "#0c0e12"; dg.font = "bold 40px monospace"; dg.textAlign = "center"; dg.textBaseline = "middle";
      dg.fillText("ACE PRO", 128, 34);
      const decTex = new THREE.CanvasTexture(dc);
      for (const sz of [-1, 1]) {
        const dec = new THREE.Mesh(new THREE.PlaneGeometry(0.052, 0.013),
          new THREE.MeshBasicMaterial({ map: decTex, transparent: true, depthWrite: false }));
        dec.position.set(0, 0.245, sz * 0.0068);
        dec.rotation.y = sz > 0 ? 0 : Math.PI;
        dec.rotation.z = -Math.PI / 2; // brand runs along the shaft, like the real thing
        rq.add(dec);
      }

      if (CHAR === "ch28") {
        rq.position.set(...RQ_POS); rq.rotation.set(...RQ_ROT);
      } else {
        fitRacquetToHand(scene, bones, rq);
      }
      bones.rHand.add(rq);
    }
    // sport-fit accessories (default; opt out with ?fit=office): adidas-style cap
    // + sport wraparound shades. Outfit meshes (tank/shorts/sneakers) arrive with
    // the re-exported avatar — Avaturn culls body geometry under clothes.
    if ((FLAGS.get("fit") || "sport") === "sport" && bones.head && !bones.head.getObjectByName("cap")) {
      // head-bone local axes are rig-specific: derive world up/back at bind pose
      scene.updateMatrixWorld(true);
      const qh = bones.head.getWorldQuaternion(new THREE.Quaternion()).invert();
      const upL = new THREE.Vector3(0, 1, 0).applyQuaternion(qh).normalize();
      const backL = new THREE.Vector3(0, 0, -1).applyQuaternion(qh)
        .projectOnPlane(upL).normalize();
      const xL = new THREE.Vector3().crossVectors(upL, backL.clone().negate()).normalize();
      const qAlign = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(xL, upL, backL.clone().negate()));
      // hide the office glasses and the man-bun (Head_Mesh texture keeps the
      // shaved-sides shading under the cap)
      scene.traverse((o) => {
        if (o.isMesh && /avaturn_hair|avaturn_glasses/.test(o.name)) o.visible = false;
      });
      // adidas Tennis Originals Climacool replica (boss's reference photo): white
      // 6-panel dome + green trefoil at center-front, PRE-CURVED rounded-D visor
      // with the green sandwich layer showing on its edge, worn forward
      const capHolder = new THREE.Group(); capHolder.name = "cap";
      capHolder.quaternion.copy(qAlign);
      // holder sits at mid-skull: the crown is generated around this point from
      // actual skull measurements, so it HUGS the head instead of resting on it
      capHolder.position.copy(upL.clone().multiplyScalar(0.10)).addScaledVector(backL, -0.005);
      bones.head.add(capHolder);
      // ---- skull radius map: bin Head_Mesh SKINNED vertices by direction from
      // the holder origin, everything expressed in the holder's OWN frame — the
      // measurement and the crown share one frame by construction, in any pose.
      // Rows below ~88° stay unused, so ears/nose can't pollute the fit.
      const skull = scene.getObjectByName("Head_Mesh");
      scene.updateMatrixWorld(true);
      const toCapLocal = capHolder.matrixWorld.clone().invert();
      const skullToCap = toCapLocal.clone().multiply(skull.matrixWorld);
      const NT = 48, NP = 20, PHI_SMP = Math.PI * (92 / 180);
      const bins = Array.from({ length: NT }, () => new Array(NP).fill(0));
      {
        const sp = skull.geometry.attributes.position, pw = new THREE.Vector3();
        const skinned = skull.getVertexPosition ? (v) => skull.getVertexPosition(v, pw)
          : skull.boneTransform ? (v) => skull.boneTransform(v, pw)
          : (v) => pw.fromBufferAttribute(sp, v);
        const dirOf = (v) => { // → [θbinFloat, φbinFloat, r] in NODE coordinates
          skinned(v); pw.applyMatrix4(skullToCap);
          const rr = pw.length(); if (rr < 0.02) return null;
          const ph = Math.acos(Math.max(-1, Math.min(1, pw.y / rr)));
          if (ph > PHI_SMP) return null;
          const x = ((Math.atan2(pw.x, pw.z) / (2 * Math.PI) % 1) + 1) % 1 * NT;
          return [x, ph / PHI_SMP * (NP - 1), rr];
        };
        for (let v = 0; v < sp.count; v++) {
          const d = dirOf(v); if (!d) continue;
          const ti = Math.round(d[0]) % NT, pi = Math.min(NP - 1, Math.round(d[1]));
          if (d[2] > bins[ti][pi]) bins[ti][pi] = d[2];
        }
        for (let pass = 0; pass < 40; pass++) { // fill sparse bins from neighbors
          let empty = 0;
          for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) if (!bins[t][p]) {
            const c = [bins[(t + 1) % NT][p], bins[(t + NT - 1) % NT][p],
              p > 0 ? bins[t][p - 1] : 0, p < NP - 1 ? bins[t][p + 1] : 0].filter(Boolean);
            if (c.length) bins[t][p] = c.reduce((a, b) => a + b, 0) / c.length; else empty++;
          }
          if (!empty) break;
        }
        for (let pass = 0; pass < 2; pass++) { // smooth noise dips, NEVER shrink
          const src = bins.map((row) => row.slice()); // below the raw skull maxima
          for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) {
            let s = src[t][p] * 2, n = 2;
            s += src[(t + 1) % NT][p] + src[(t + NT - 1) % NT][p]; n += 2;
            if (p > 0) { s += src[t][p - 1]; n++; }
            if (p < NP - 1) { s += src[t][p + 1]; n++; }
            bins[t][p] = Math.max(src[t][p], s / n);
          }
        }
        // clearance: bump the four surrounding nodes of EVERY skull vertex, so
        // the interpolated crown surface clears the whole scalp everywhere
        for (let v = 0; v < sp.count; v++) {
          const d = dirOf(v); if (!d) continue;
          const x0 = Math.floor(d[0]) % NT, x1 = (x0 + 1) % NT;
          const y0 = Math.min(NP - 1, Math.floor(d[1])), y1 = Math.min(NP - 1, y0 + 1);
          for (const [tt, pp] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]])
            if (bins[tt][pp] < d[2]) bins[tt][pp] = d[2];
        }
      }
      const sampleR = (th, ph) => { // bilinear, θ wraps
        const x = ((th / (2 * Math.PI) % 1) + 1) % 1 * NT;
        const y = Math.min(NP - 1.001, Math.max(0, ph / PHI_SMP * (NP - 1)));
        const x0 = Math.floor(x) % NT, x1 = (x0 + 1) % NT, fx = x - Math.floor(x);
        const y0 = Math.floor(y), y1 = Math.min(NP - 1, y0 + 1), fy = y - y0;
        return (bins[x0][y0] * (1 - fx) + bins[x1][y0] * fx) * (1 - fy) +
          (bins[x0][y1] * (1 - fx) + bins[x1][y1] * fx) * fy;
      };
      // dome texture: fabric grain, 6 panel seams meeting at the button (one runs
      // center-front like the real cap), eyelets at panel centers, trefoil logo.
      // Sphere UV: u=0.25 → local +Z (forward), canvas bottom → brim edge.
      const cv = document.createElement("canvas"); cv.width = 1024; cv.height = 384;
      const cg2 = cv.getContext("2d");
      cg2.fillStyle = "#f7f8f6"; cg2.fillRect(0, 0, 1024, 384);
      for (let i = 0; i < 3200; i++) {
        cg2.fillStyle = `rgba(185,190,186,${(Math.random() * 0.14).toFixed(3)})`;
        cg2.fillRect(Math.random() * 1024, Math.random() * 384, 2, 1);
      }
      cg2.strokeStyle = "rgba(176,181,176,0.9)"; cg2.lineWidth = 2;
      for (let k = 0; k < 6; k++) {
        const sx = ((0.25 + k / 6) % 1) * 1024;
        cg2.beginPath(); cg2.moveTo(sx, 0); cg2.lineTo(sx, 384); cg2.stroke();
        const ex = ((0.25 + (k + 0.5) / 6) % 1) * 1024;
        cg2.beginPath(); cg2.arc(ex, 130, 8, 0, Math.PI * 2); cg2.stroke();
      }
      // trefoil: three fanned leaves cut by two stripe gaps + flat base (offscreen
      // canvas so the cuts stay transparent, then composited over the seam)
      const tf = document.createElement("canvas"); tf.width = 240; tf.height = 200;
      const tg = tf.getContext("2d"); tg.fillStyle = "#0f8a43";
      for (const rot of [-0.68, 0.68, 0]) {
        tg.save(); tg.translate(120, 176); tg.rotate(rot);
        tg.beginPath(); tg.ellipse(0, -84, 33, 86, 0, 0, Math.PI * 2); tg.fill(); tg.restore();
      }
      tg.clearRect(0, 176, 240, 24);
      tg.clearRect(0, 122, 240, 9); tg.clearRect(0, 150, 240, 9);
      cg2.drawImage(tf, 256 - 54, 246, 108, 90);
      const capTex = new THREE.CanvasTexture(cv);
      capTex.colorSpace = THREE.SRGBColorSpace; capTex.anisotropy = 8;
      capTex.wrapS = THREE.RepeatWrapping;
      const fabricW = new THREE.MeshStandardMaterial({ map: capTex, roughness: 0.88,
        side: THREE.DoubleSide });
      const visorW = new THREE.MeshStandardMaterial({ color: "#f7f8f6", roughness: 0.85 });
      const trimG = new THREE.MeshStandardMaterial({ color: "#0f8a43", roughness: 0.62 });
      // ---- crown = measured skull + 7.5mm of fabric. Brim edge dips past the
      // equator: ~97° over the brow, ~112° on the nape (like a worn cap), with a
      // slight inward taper at the edge and a folded hem inside.
      const OFF = 0.0075, ROWS = 14, SEGS = 48, W = SEGS + 1;
      // edge band measured against the worn reference: ~68° from center over the
      // brow (well clear of the shades), dipping to ~97° on the nape
      const phiEdge = (th) => (68 + 29 * (1 - Math.cos(th)) / 2) * Math.PI / 180;
      const capR = (th, ph) => {
        let r = sampleR(th, Math.min(ph, 88 * Math.PI / 180)) + OFF;
        const cd = Math.max(0, Math.cos(th)); // front panel stands a touch taller
        r += 0.0045 * cd * cd * Math.sin(Math.max(0, Math.min(1,
          (ph - 0.30) / 0.85)) * Math.PI);
        if (ph > Math.PI / 2) r -= (ph - Math.PI / 2) * 0.014; // edge tucks in
        return r;
      };
      const pos = [], uv = [];
      for (let k = 0; k <= ROWS + 1; k++) {       // last row = folded hem
        for (let j = 0; j <= SEGS; j++) {
          const th = j / SEGS * Math.PI * 2;
          const hem = k === ROWS + 1;
          const kk = hem ? ROWS : k;
          const ph = 0.06 + (phiEdge(th) - 0.06) * kk / ROWS;
          const r = capR(th, ph) - (hem ? 0.0035 : 0);
          pos.push(r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph), r * Math.sin(ph) * Math.cos(th));
          uv.push(0.25 + th / (2 * Math.PI), hem ? 0 : 1 - kk / ROWS);
        }
      }
      const cidx = [];
      for (let k = 0; k <= ROWS; k++) for (let j = 0; j < SEGS; j++) {
        const a = k * W + j, b = a + W;
        cidx.push(a, b, a + 1, a + 1, b, b + 1);
      }
      const cg3 = new THREE.BufferGeometry();
      cg3.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      cg3.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      cg3.setIndex(cidx); cg3.computeVertexNormals();
      capHolder.add(new THREE.Mesh(cg3, fabricW));
      const btn = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 12, 8), visorW);
      btn.scale.y = 0.55; btn.position.y = capR(0, 0.06) + 0.001; capHolder.add(btn);
      // pre-curved visor, real proportions: base arc = the measured brow radius,
      // ~9.8cm rounded-D plan, gentle droop + lateral curl; box side walls carry
      // the green sandwich edge
      const eF = phiEdge(0), rEdgeF = capR(0, eF);
      const rF = rEdgeF * Math.sin(eF), yF = rEdgeF * Math.cos(eF); // front brim edge
      const hW = rF * 0.86, vL = 0.098;
      const vg = new THREE.BoxGeometry(hW * 2, 0.0045, vL, 18, 1, 12);
      const vp = vg.attributes.position;
      for (let i = 0; i < vp.count; i++) {
        const x = vp.getX(i), y = vp.getY(i), z = vp.getZ(i);
        const zn = (z + vL / 2) / vL, u = x / hW;
        const back = Math.sqrt(rF * rF - x * x) - 0.008; // tucked under the crown
        const len = vL * (1 - 0.30 * u ** 4);            // rounded-D front
        vp.setXYZ(i, x,
          y - 0.018 * zn * zn + 0.010 * u * u * (0.2 + 0.8 * zn),
          back + zn * len);
      }
      vg.computeVertexNormals();
      // dedicated under-brim material: emissive lift so the lime hemisphere ground
      // light doesn't paint the white underside green
      const underW = new THREE.MeshStandardMaterial({ color: "#e9ebe8", roughness: 0.9,
        emissive: "#5a5e5a", emissiveIntensity: 0.55 });
      // green sandwich on the OUTER edge only (front + sides); the root edge that
      // peeks below the crown reads as white binding, like the real cap
      const visor = new THREE.Mesh(vg, [trimG, trimG, visorW, underW, trimG, underW]);
      const visorPivot = new THREE.Group();
      visorPivot.position.y = yF + 0.005; visorPivot.rotation.x = 0.10;
      visorPivot.add(visor); capHolder.add(visorPivot);
      // rear adjustable strap + slide on the measured nape, proud of the crown
      const aB = 92 * Math.PI / 180, rB = capR(Math.PI, aB);
      const sy = rB * Math.cos(aB), sz = rB * Math.sin(aB);
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.015, 0.006), visorW);
      strap.position.set(0, sy, -sz + 0.0005); capHolder.add(strap);
      const slide = new THREE.Mesh(new THREE.BoxGeometry(0.021, 0.019, 0.007),
        new THREE.MeshStandardMaterial({ color: "#d8dad6", roughness: 0.35, metalness: 0.3 }));
      slide.position.set(0, sy, -sz - 0.003); capHolder.add(slide);
      // sport shades — switchable styles (?shades=nike|blade|shield|visor|radar):
      // nike   = Nike Lucent Flash EV24050-891: total-orange wrap shield with an
      //          orange multilayer mirror lens (default, по заказу босса)
      // blade  = two-lens semi-rimless with browline
      // shield = one bold mono-shield, Sutro vibe
      // visor  = slim rimless mirror strip, futuristic
      // radar  = full-rim two-lens with lime accents
      const SHADES = FLAGS.get("shades") || "nike";
      const shades = new THREE.Group(); shades.name = "shades";
      const R = 0.093; // face-wrap radius
      const smoke = (op = 0.92) => new THREE.MeshPhysicalMaterial({
        color: "#0a0e16", metalness: 0.55, roughness: 0.06,
        clearcoat: 1, clearcoatRoughness: 0.08,
        emissive: "#0e1c2e", emissiveIntensity: 0.5,
        transparent: true, opacity: op, side: THREE.DoubleSide });
      const mirror = new THREE.MeshStandardMaterial({
        color: "#9fd4ff", metalness: 1, roughness: 0.05,
        emissive: "#12293d", emissiveIntensity: 0.35, side: THREE.DoubleSide });
      const frame2 = new THREE.MeshStandardMaterial({ color: "#0b0d11", roughness: 0.35, metalness: 0.5 });
      const tipMat = new THREE.MeshStandardMaterial({ color: "#c8ff00", roughness: 0.5, emissive: "#2c3d00", emissiveIntensity: 0.4 });
      const temples = (edgeA, y = 0.02) => {
        const eX = R * Math.sin(edgeA), eZ = R * Math.cos(edgeA);
        for (const sx of [-1, 1]) {
          const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.008, 0.008), frame2);
          hinge.position.set(sx * eX, y, eZ - 0.002); shades.add(hinge);
          const arm = new THREE.Mesh(new THREE.BoxGeometry(0.0035, 0.006, 0.115), frame2);
          arm.position.set(sx * (eX + 0.009), y, eZ - 0.06);
          arm.rotation.y = sx * -0.16; shades.add(arm);
          const tip = new THREE.Mesh(new THREE.BoxGeometry(0.0042, 0.0068, 0.026), tipMat);
          tip.position.set(sx * (eX + 0.017), y - 0.003, eZ - 0.115);
          tip.rotation.y = sx * -0.16; shades.add(tip);
        }
      };
      if (SHADES === "nike") {
        // Lucent Flash: orange multilayer mirror shield + glossy orange brow bar,
        // orange temples with a white tick accent
        const oMirror = new THREE.MeshStandardMaterial({
          color: "#ff8a2a", metalness: 1, roughness: 0.07,
          emissive: "#7a2c00", emissiveIntensity: 0.55, side: THREE.DoubleSide });
        const oFrame = new THREE.MeshPhysicalMaterial({
          color: "#ff5f00", roughness: 0.25, clearcoat: 0.9, clearcoatRoughness: 0.15 });
        shades.add(new THREE.Mesh(new THREE.SphereGeometry(R, 40, 12,
          Math.PI / 2 - 0.74, 1.48, Math.PI / 2 - 0.25, 0.42), oMirror));
        shades.add(new THREE.Mesh(new THREE.SphereGeometry(R + 0.002, 40, 4,
          Math.PI / 2 - 0.77, 1.54, Math.PI / 2 - 0.285, 0.09), oFrame));
        const nose = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.012, 0.005), oFrame);
        nose.position.set(0, -0.001, R - 0.002); shades.add(nose);
        const eX = R * Math.sin(0.77), eZ = R * Math.cos(0.77);
        for (const sx of [-1, 1]) {
          const arm = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.0075, 0.115), oFrame);
          arm.position.set(sx * (eX + 0.009), 0.02, eZ - 0.058);
          arm.rotation.y = sx * -0.16; shades.add(arm);
          const tick = new THREE.Mesh(new THREE.BoxGeometry(0.0045, 0.0035, 0.014),
            new THREE.MeshBasicMaterial({ color: "#f4f4f4" }));
          tick.position.set(sx * (eX + 0.013), 0.019, eZ - 0.075);
          tick.rotation.y = sx * -0.16; tick.rotation.x = sx * 0.15; shades.add(tick);
        }
      } else if (SHADES === "shield") {
        // one wide smoked shield + black top bar + center nose piece
        shades.add(new THREE.Mesh(new THREE.SphereGeometry(R, 36, 12,
          Math.PI / 2 - 0.72, 1.44, Math.PI / 2 - 0.26, 0.44), smoke(0.9)));
        shades.add(new THREE.Mesh(new THREE.SphereGeometry(R + 0.0018, 36, 4,
          Math.PI / 2 - 0.75, 1.5, Math.PI / 2 - 0.29, 0.08), frame2));
        const nose = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.014, 0.005), frame2);
        nose.position.set(0, 0.0, R - 0.002); shades.add(nose);
        temples(0.75);
      } else if (SHADES === "visor") {
        // slim rimless mirror strip — pure cyber
        shades.add(new THREE.Mesh(new THREE.SphereGeometry(R, 40, 8,
          Math.PI / 2 - 0.8, 1.6, Math.PI / 2 - 0.16, 0.26), mirror));
        temples(0.82, 0.012);
      } else if (SHADES === "radar") {
        // full-rim two-lens: black rim fakes as a slightly larger patch behind
        for (const sx of [-1, 1]) {
          const w0 = sx > 0 ? Math.PI / 2 + 0.05 : Math.PI / 2 - 0.05 - 0.66;
          shades.add(new THREE.Mesh(new THREE.SphereGeometry(R + 0.0015, 24, 10,
            w0 - 0.025, 0.71, Math.PI / 2 - 0.265, 0.45), frame2));
          shades.add(new THREE.Mesh(new THREE.SphereGeometry(R + 0.003, 24, 10,
            w0, 0.66, Math.PI / 2 - 0.24, 0.4), smoke(0.94)));
        }
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.006, 0.006), tipMat);
        bridge.position.set(0, 0.017, R - 0.001); shades.add(bridge);
        temples(0.73);
      } else {
        // blade (default): two-lens semi-rimless + browline + bridge
        for (const sx of [-1, 1]) {
          shades.add(new THREE.Mesh(new THREE.SphereGeometry(R, 24, 10,
            sx > 0 ? Math.PI / 2 + 0.045 : Math.PI / 2 - 0.045 - 0.7, 0.7,
            Math.PI / 2 - 0.24, 0.4), smoke()));
        }
        shades.add(new THREE.Mesh(new THREE.SphereGeometry(R + 0.0018, 36, 4,
          Math.PI / 2 - 0.78, 1.56, Math.PI / 2 - 0.275, 0.07), frame2));
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.005, 0.006), frame2);
        bridge.position.set(0, 0.019, R - 0.003); shades.add(bridge);
        temples(0.745);
      }
      shades.quaternion.copy(qAlign);
      shades.rotateX(0.05); // slight pantoscopic tilt, like real sport frames
      shades.position.copy(upL.clone().multiplyScalar(0.094)).addScaledVector(backL, -0.028);
      bones.head.add(shades);
    }
    // tennis balls + wristband: procedural ball (felt + the classic wavy seam
    // = the equator modulated by cos2t, normalized back onto the sphere), three
    // resting by the baseline, one parked in the left palm during the serve
    // demo (visibility driven from the frame loop)
    if (!scene.userData.balls && bones.rHand) {
      scene.userData.balls = true;
      const R_BALL = 0.0335;
      const feltMat = new THREE.MeshStandardMaterial({ color: "#d9ec4e", roughness: 1,
        emissive: "#5a6a10", emissiveIntensity: 0.25 });
      const seamMat = new THREE.MeshStandardMaterial({ color: "#eef0e0", roughness: 0.8 });
      const makeBall = () => {
        const b = new THREE.Group();
        b.add(new THREE.Mesh(new THREE.SphereGeometry(R_BALL, 28, 20), feltMat));
        const pts = [];
        for (let i = 0; i < 96; i++) {
          const t = i / 96 * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(t), Math.sin(t), 0.62 * Math.cos(2 * t))
            .normalize().multiplyScalar(R_BALL + 0.0004));
        }
        b.add(new THREE.Mesh(new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(pts, true), 128, 0.0016, 6, true), seamMat));
        return b;
      };
      scene.userData.makeBall = makeBall; // reused by the court dressing block
      for (const [bx, bz, ry] of [[0.55, 0.42, 0.4], [-0.75, -0.25, 1.9], [0.85, -0.95, 3.6]]) {
        const b = makeBall();
        b.position.set(bx, R_BALL, bz);
        b.rotation.set(ry, bx * 7, ry * 1.7); // random-ish resting orientations
        scene.add(b);
      }
      if (bones.lHand) {
        const hb = makeBall(); hb.name = "serveBall"; hb.visible = false;
        const ls = bones.lHand.getWorldScale(new THREE.Vector3()).x || 1;
        hb.scale.setScalar(1 / ls);
        // toss hold: nest against the finger pads — direction to the middle
        // knuckle + offset along the palm normal (fingers x thumb), so the
        // placement follows any rig's hand instead of guessed axes
        let mid1 = null, th1 = null;
        bones.lHand.traverse((o2) => {
          const n2 = (o2.name || "").toLowerCase();
          if (/lefthandmiddle1$/.test(n2)) mid1 = o2;
          if (/lefthandthumb1$/.test(n2)) th1 = o2;
        });
        if (mid1 && th1) {
          const F = bones.lHand.worldToLocal(mid1.getWorldPosition(new THREE.Vector3()));
          const dMid = F.length(); F.normalize();
          const Th = bones.lHand.worldToLocal(th1.getWorldPosition(new THREE.Vector3())).normalize();
          const N = new THREE.Vector3().crossVectors(F, Th).normalize();
          hb.position.copy(F.multiplyScalar(dMid * 1.03).addScaledVector(N, 0.027));
        } else hb.position.set(0, -0.035, 0.02);
        bones.lHand.add(hb);
        scene.userData.serveBall = hb;
      }
      // lime sweat wristband on the hitting wrist, aligned to the forearm axis
      const fore = bones.rHand.parent;
      if (fore) {
        scene.updateMatrixWorld(true);
        const dir = bones.rHand.worldToLocal(fore.getWorldPosition(new THREE.Vector3())).normalize();
        const rs = bones.rHand.getWorldScale(new THREE.Vector3()).x || 1;
        const wb = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.05, 20, 1, true),
          new THREE.MeshStandardMaterial({ color: "#c8ff00", roughness: 0.92,
            emissive: "#2c3d00", emissiveIntensity: 0.3, side: THREE.DoubleSide }));
        wb.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        wb.scale.setScalar(1 / rs);
        wb.position.copy(dir.clone().multiplyScalar(0.035));
        bones.rHand.add(wb);
      }
    }
    // court dressing: training ball hopper + a soft contact shadow that keeps
    // the coach grounded (the frame loop drags it under the hips)
    if (!scene.userData.dressing && scene.userData.makeBall) {
      scene.userData.dressing = true;
      const makeBall = scene.userData.makeBall;
      // --- wire ball hopper: stacked rings + vertical bars + handles + balls
      const wireMat = new THREE.MeshStandardMaterial({ color: "#3a3f46", metalness: 0.85, roughness: 0.35 });
      const hop = new THREE.Group(); hop.name = "hopper";
      const HR = 0.165, HH = 0.42;
      for (const hy of [0.10, 0.21, 0.32, HH]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(HR, 0.0042, 8, 40), wireMat);
        ring.rotation.x = Math.PI / 2; ring.position.y = hy; hop.add(ring);
      }
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2;
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.0038, 0.0038, HH - 0.09, 6), wireMat);
        bar.position.set(Math.cos(a) * HR, (HH + 0.10) / 2, Math.sin(a) * HR);
        hop.add(bar);
      }
      const bot = new THREE.Mesh(new THREE.CylinderGeometry(HR, HR, 0.006, 28), wireMat);
      bot.position.y = 0.10; hop.add(bot);
      for (const sx of [-1, 1]) { // carry handles folded up
        const hd = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.0042, 8, 24, Math.PI), wireMat);
        hd.position.set(sx * (HR - 0.002), HH + 0.02, 0);
        hd.rotation.y = sx * Math.PI / 2; hop.add(hd);
      }
      // balls piled inside (two loose layers)
      const pile = [[0, 0], [0.075, 0.04], [-0.07, 0.06], [0.02, -0.085], [-0.075, -0.05],
        [0.085, -0.03, 1], [-0.01, 0.08, 1], [-0.06, -0.02, 1]];
      for (let i = 0; i < pile.length; i++) {
        const [px2, pz2, lay] = pile[i];
        const b = makeBall();
        b.position.set(px2, 0.10 + 0.034 + (lay ? 0.06 : 0), pz2);
        b.rotation.set(i * 1.3, i * 2.1, i * 0.7);
        hop.add(b);
      }
      hop.position.set(-0.95, 0, 0.30);
      hop.rotation.y = 0.5;
      scene.add(hop);
      // --- contact shadow: radial-gradient blob, layered above the glow disc
      const sc = document.createElement("canvas"); sc.width = sc.height = 128;
      const sg2 = sc.getContext("2d");
      const grad = sg2.createRadialGradient(64, 64, 5, 64, 64, 60);
      grad.addColorStop(0, "rgba(0,0,0,0.68)");
      grad.addColorStop(0.55, "rgba(0,0,0,0.38)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      sg2.fillStyle = grad; sg2.fillRect(0, 0, 128, 128);
      const st = new THREE.CanvasTexture(sc);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85),
        new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.012;
      shadow.renderOrder = 2;
      scene.add(shadow);
      scene.userData.contactShadow = shadow;
    }
    // dev handle: lets the grip be measured/nudged from the page console
    if (import.meta.env.DEV && typeof window !== "undefined")
      window.__rig = { scene, bones, THREE, rq: bones.rHand?.getObjectByName("racq"),
        cap: bones.head?.getObjectByName("cap") };
    scene.updateMatrixWorld(true);
  }, [scene, bones]);

  // ---------- animation machine ----------
  const ensure = async (name) => {
    if (A.actions.has(name)) return A.actions.get(name);
    const clip = await getClipFor(name, A.boneIndex, A.hipsY);
    const action = A.mixer.clipAction(clip);
    A.actions.set(name, action);
    return action;
  };
  const switchTo = (to, fade) => {
    to.enabled = true;
    if (A.current && A.current !== to) { to.play(); A.current.crossFadeTo(to, fade, false); }
    else to.fadeIn(fade).play();
    A.current = to;
  };
  const playLoop = async (name, fade = 0.35) => {
    try {
      const to = await ensure(name);
      if (A.currentName === name && to === A.current) return;
      to.reset(); to.setLoop(THREE.LoopRepeat, Infinity);
      switchTo(to, fade); A.currentName = name;
    } catch (e) { console.warn("[anim]", name, e); }
  };
  const playOnce = (name, fade = 0.3) => new Promise((resolve) => {
    ensure(name).then((to) => {
      to.reset(); to.setLoop(THREE.LoopOnce, 1); to.clampWhenFinished = true;
      switchTo(to, fade); A.currentName = name;
      const onFin = (e) => { if (e.action === to) { A.mixer.removeEventListener("finished", onFin); resolve(); } };
      A.mixer.addEventListener("finished", onFin);
    }).catch((e) => { console.warn("[anim]", name, e); resolve(); });
  });

  // boot: greeting → idle; schedulers for idle variety
  useEffect(() => {
    if (A.booted) return; A.booted = true;
    A.mixer = new THREE.AnimationMixer(scene);
    A.boneIndex = buildBoneIndex(scene);
    A.hipsY = getHipsRestY(scene);
    (async () => {
      A.busy = true;
      await playOnce("greet", 0.2);
      A.busy = false;
      if (!A.speaking) playLoop("idle");
    })();
    const sway = setInterval(() => {
      if (A.speaking || A.busy || demo.active || demo.gripCam) return;
      if (A.currentName === "idle") playLoop("breathing", 0.6);
      else if (A.currentName === "breathing") playLoop("idle", 0.6);
    }, 32000);
    const look = setInterval(async () => {
      if (A.speaking || A.busy || demo.active || demo.gripCam) return;
      if (A.currentName === "idle" || A.currentName === "breathing") {
        A.busy = true; await playOnce("look", 0.4); A.busy = false;
        if (!A.speaking && !demo.active && !demo.gripCam) playLoop("idle", 0.4);
      }
    }, 77000);
    return () => { clearInterval(sway); clearInterval(look); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  // speaking: gesture → talking loop → idle (body untouched while a demo is running —
  // the mouth still lipsyncs via morphs)
  useEffect(() => {
    if (!A.mixer) return;
    A.speaking = speaking;
    if (demo.active || demo.gripCam) return; // closeup holds the pose; morphs still lipsync
    (async () => {
      if (speaking) {
        const g = gestureFor(transcript);
        A.busy = true;
        if (g) await playOnce(g, 0.25);
        A.busy = false;
        if (A.speaking && !demo.active && !demo.gripCam) playLoop("talk", 0.3);
      } else if (!A.busy) {
        playLoop("idle", 0.5);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speaking]);

  // DEMO.LAB commands (consumed once per cmdId) + playback state reporting
  const setGrip = (name) => {
    const rq = bones.rHand && bones.rHand.getObjectByName("racq");
    if (!rq) return;
    demo.grip = GRIPS[name] ? name : "continental";
    fitRacquetToHand(scene, bones, rq, demo.grip);
  };
  const runDemoCmd = () => {
    const a = demo.active ? A.actions.get(demo.active) : null;
    switch (demo.cmd) {
      case "start":
        (async () => {
          try {
            const act = await ensure(demo.arg);
            act.reset(); act.setLoop(THREE.LoopRepeat, Infinity);
            act.paused = false; act.timeScale = demo.speed;
            switchTo(act, 0.25); A.currentName = demo.arg;
            demo.active = demo.arg; demo.paused = false;
            const move = DEMO_MOVES.find((m) => m[1] === demo.arg);
            setGrip((move && move[2]) || "continental"); // each stroke has its grip
          } catch (e) { console.warn("[demo]", demo.arg, e); }
        })();
        break;
      case "exit":
        if (demo.active) { demo.active = null; playLoop("idle", 0.4); setGrip("continental"); }
        break;
      case "grip": setGrip(demo.arg); break;
      case "pause": if (a) { a.paused = true; demo.paused = true; } break;
      case "play": if (a) { a.paused = false; demo.paused = false; } break;
      case "speed": demo.speed = demo.arg; if (a) a.timeScale = demo.arg; break;
      case "scrub": if (a) a.time = demo.arg * a.getClip().duration; break;
      case "step":
        if (a) {
          const d = a.getClip().duration;
          a.paused = true; demo.paused = true;
          a.time = (a.time + demo.arg / 30 + d) % d;
        }
        break;
      case "gripcam":
        demo.gripCam = !!demo.arg;
        if (demo.gripCam) {
          A.grip = { mode: "in", t: 0, homePos: null, homeTgt: null, dir: null };
          // no demo running -> raise the fist (point gesture frozen at its apex);
          // during a demo the pose is sacred, only the camera moves
          if (!demo.active) {
            A.gripPose = true;
            (async () => {
              try {
                const act = await ensure("point");
                act.reset(); act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true;
                act.timeScale = 1;
                switchTo(act, 0.3); A.currentName = "point";
                A.gripFreezeAt = 0.45 * act.getClip().duration;
              } catch (e) { console.warn("[gripcam]", e); }
            })();
          }
        } else {
          if (A.grip) A.grip.mode = "out";
          if (A.gripPose) {
            A.gripPose = false;
            if (!demo.active) playLoop(A.speaking ? "talk" : "idle", 0.4);
          }
        }
        break;
      default: break;
    }
  };

  useFrame((state, dt) => {
    if (import.meta.env.DEV) { window.__cam = state.camera; window.__ctr = state.controls; }
    if (demo.cmdId !== A.demoSeen) { A.demoSeen = demo.cmdId; runDemoCmd(); }
    if (A.mixer) A.mixer.update(dt);
    // GRIP.CAM pose: hold the point gesture at its apex while the closeup is on.
    // Clamp-and-pause (not just pause) — recovers even if a slow clip load let
    // the gesture run past the apex before this check saw it.
    if (A.gripPose && A.gripFreezeAt) {
      const pa = A.actions.get("point");
      if (pa && pa.time >= A.gripFreezeAt) { pa.time = A.gripFreezeAt; pa.paused = true; }
    }
    // GRIP.CAM camera: fly to the fist -> orbit-follow it -> fly home
    if (!LOOK_HAND && A.grip && bones.rHand && state.controls) {
      const g = A.grip, ctr = state.controls, cam = state.camera;
      // aim at the KNUCKLES (not the wrist) and approach from the back of the hand —
      // derived from the hand's own axes, so the framing survives any pose
      const wp = (b) => b.getWorldPosition(new THREE.Vector3());
      let fist = wp(bones.rHand), dirIn = null;
      if (bones.index1 && bones.pinky1 && bones.middle1 && bones.middle2) {
        const pI = wp(bones.index1), pP = wp(bones.pinky1),
              pM1 = wp(bones.middle1), pM2 = wp(bones.middle2), pH = fist;
        fist = pI.clone().add(pP).multiplyScalar(0.5);
        const across = pI.clone().sub(pP).normalize();
        const along = pM1.clone().sub(pH).normalize();
        const normal = new THREE.Vector3().crossVectors(along, across).normalize();
        if (normal.dot(pM2.clone().sub(pM1)) < 0) normal.negate();
        dirIn = normal.clone().multiplyScalar(-1) // knuckle side
          .addScaledVector(along, 0.25).add(new THREE.Vector3(0, 0.35, 0)).normalize();
        // in wound-up poses the knuckles can face the torso — approaching from
        // there dives the camera inside the body. Blend toward "radially out
        // from the chest", and if the knuckle side truly faces inward, use it outright.
        const chest = bones.neck ? wp(bones.neck) : new THREE.Vector3(0, 1.35, 0);
        const out = fist.clone().sub(chest).normalize();
        if (dirIn.dot(out) < 0.15) dirIn.copy(out).add(new THREE.Vector3(0, 0.3, 0)).normalize();
        else dirIn.lerp(out, 0.35).normalize();
      }
      const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
      if (g.mode === "in") {
        if (!g.homePos) {
          g.homePos = cam.position.clone(); g.homeTgt = ctr.target.clone();
          ctr.enabled = false;
        }
        g.t = Math.min(1, g.t + dt / 0.9);
        const dir = dirIn || cam.position.clone().sub(fist).normalize();
        const goal = fist.clone().addScaledVector(dir, 0.48);
        const e = ease(g.t);
        cam.position.lerpVectors(g.homePos, goal, e);
        ctr.target.lerpVectors(g.homeTgt, fist, e);
        if (g.t >= 1) { g.mode = "follow"; ctr.enabled = true; }
      } else if (g.mode === "follow") {
        // OrbitControls owns the orbit; we chase the fist with target AND camera
        // by the same delta, so the user's offset survives even mid-swing
        const move = fist.clone().sub(ctr.target).multiplyScalar(1 - Math.exp(-10 * dt));
        ctr.target.add(move);
        cam.position.add(move);
      }
      if (import.meta.env.DEV) window.__gc = { mode: g.mode, t: +g.t.toFixed(2),
        cam: cam.position.toArray().map((v) => +v.toFixed(2)),
        tgt: ctr.target.toArray().map((v) => +v.toFixed(2)),
        fist: fist.toArray().map((v) => +v.toFixed(2)) };
      if (g.mode === "out") {
        if (g.t >= 1 || !g.outFrom) {
          g.outFrom = { pos: cam.position.clone(), tgt: ctr.target.clone() };
          g.t = 0; ctr.enabled = false;
        }
        g.t = Math.min(1, g.t + dt / 0.8);
        const e = ease(g.t);
        cam.position.lerpVectors(g.outFrom.pos, g.homePos, e);
        ctr.target.lerpVectors(g.outFrom.tgt, g.homeTgt, e);
        if (g.t >= 1) { ctr.enabled = true; A.grip = null; }
      }
      if (!scene.userData.inspectLight) {
        scene.userData.inspectLight = new THREE.PointLight("#ffffff", 6, 3);
        state.scene.add(scene.userData.inspectLight);
      }
      scene.userData.inspectLight.visible = true;
      scene.userData.inspectLight.position.copy(state.camera.position);
    } else if (!LOOK_HAND && scene.userData.inspectLight) {
      scene.userData.inspectLight.visible = false;
    }
    if (LOOK_HAND && bones.rHand) {
      // dev macro-cam: lock onto the racquet hand from a fixed azimuth (?ang=0..359)
      const p = bones.rHand.getWorldPosition(new THREE.Vector3());
      const ang = (parseFloat(FLAGS.get("ang")) || 0) * Math.PI / 180;
      const dist = parseFloat(FLAGS.get("d")) || 0.75;
      state.camera.position.set(p.x + Math.sin(ang) * dist, p.y + 0.02, p.z + Math.cos(ang) * dist);
      state.camera.lookAt(p.x, p.y - dist * 0.16, p.z); // frame the fist (+ hoop when far)
      if (!scene.userData.inspectLight) {
        scene.userData.inspectLight = new THREE.PointLight("#ffffff", 6, 3);
        state.scene.add(scene.userData.inspectLight);
      }
      scene.userData.inspectLight.position.copy(state.camera.position);
    }
    if (demo.active) {
      const a = A.actions.get(demo.active);
      if (a) { demo.t = a.time; demo.dur = a.getClip().duration; }
    }
    // serve ball lives in the left palm only while the serve demo runs
    if (scene.userData.serveBall)
      scene.userData.serveBall.visible = demo.active === "pitch" && !demo.gripCam;
    // contact shadow trails the hips projection; fades a bit when airborne
    if (scene.userData.contactShadow && bones.hips) {
      const hw = bones.hips.getWorldPosition(_tmpShadow);
      const sh = scene.userData.contactShadow;
      sh.position.x = hw.x; sh.position.z = hw.z;
      const lift = Math.max(0, hw.y - 1.02);
      sh.material.opacity = Math.max(0.35, 1 - lift * 2.2);
      const k = 1 + lift * 0.55;
      sh.scale.set(k, k, 1);
    }
    const face = scene.userData.face;
    if (!face || face.v !== 2 || (!face.viseme.length && !face.blink.length)) return;

    // --- lipsync: mouth morphs from Rhubarb phoneme cues (precise, server-computed),
    // falling back to realtime FFT visemes when no cues arrived.
    // Avaturn visemes shape the LIPS only — the jaw is a separate jawOpen morph;
    // each shape carries its own jaw amount. Tunable via ?jaw=1.5 / ?jaw=0.5.
    const RB = { // Rhubarb shape -> lip viseme + jaw openness
      A: { v: "viseme_PP", jaw: 0.0,  lip: 0.75 }, // closed: P/B/M
      B: { v: "viseme_kk", jaw: 0.08, lip: 0.5 },
      C: { v: "viseme_E",  jaw: 0.2,  lip: 0.55 },
      D: { v: "viseme_aa", jaw: 0.34, lip: 0.6 },
      E: { v: "viseme_O",  jaw: 0.24, lip: 0.6 },
      F: { v: "viseme_U",  jaw: 0.14, lip: 0.65 },
      G: { v: "viseme_FF", jaw: 0.04, lip: 0.7 },
      H: { v: "viseme_nn", jaw: 0.16, lip: 0.5 },
      X: { v: "viseme_sil", jaw: 0,   lip: 0 },
    };
    const JAW = { viseme_aa: 0.32, viseme_O: 0.28, viseme_E: 0.2, viseme_U: 0.16, viseme_I: 0.14,
      viseme_CH: 0.12, viseme_DD: 0.14, viseme_kk: 0.14, viseme_nn: 0.12, viseme_RR: 0.14,
      viseme_TH: 0.14, viseme_SS: 0.06, viseme_FF: 0.04, viseme_PP: 0.02, viseme_sil: 0 };
    let target = "viseme_sil", jawGoal = 0, lipAmp = 0.6;
    if (A.speaking) {
      if (hasCues()) {
        const m = RB[cueAt(audioTime())] || RB.X;
        target = m.v; jawGoal = m.jaw * JAW_SCALE; lipAmp = m.lip;
      } else {
        lipsyncManager.processAudio();
        target = lipsyncManager.viseme || "viseme_sil";
        const vol = Math.min(1, (lipsyncManager.features?.volume ?? 0) * 2);
        jawGoal = (JAW[target] ?? 0.12) * (0.4 + 0.6 * vol) * JAW_SCALE;
      }
    }
    if (window.__face) { window.__face.lastViseme = target; window.__face.speaking = A.speaking; }
    const k = 1 - Math.exp(-16 * dt); // fast attack/decay, no popping
    for (const m of face.viseme) {
      const dict = m.morphTargetDictionary, inf = m.morphTargetInfluences;
      for (const name in dict) {
        if (name.charCodeAt(0) !== 118 /* 'v' */ || !name.startsWith("viseme_")) continue;
        const goal = name === target && target !== "viseme_sil" ? lipAmp : 0;
        const i = dict[name];
        inf[i] += (goal - inf[i]) * k;
      }
      if (dict.jawOpen !== undefined) {
        inf[dict.jawOpen] += (jawGoal - inf[dict.jawOpen]) * k;
      }
    }

    // --- co-speech face life: baseline smile, brow pulses, eye saccades ---
    const kSlow = 1 - Math.exp(-6 * dt);
    for (const m of face.smile) {
      const d = m.morphTargetDictionary, inf = m.morphTargetInfluences;
      inf[d.mouthSmile] += (0.1 - inf[d.mouthSmile]) * kSlow;
    }
    if (A.browT === null && A.t >= A.nextBrow) {
      A.browT = 0;
      A.nextBrow = A.t + (A.speaking ? 2 + Math.random() * 3 : 5 + Math.random() * 6);
    }
    if (A.browT !== null) {
      A.browT += dt;
      const ph = A.browT / 0.28; // up, hold, down ≈ 0.85s total
      const v = ph < 1 ? ph : ph < 2 ? 1 : ph < 3 ? 3 - ph : null;
      for (const m of face.brow) {
        const d = m.morphTargetDictionary, inf = m.morphTargetInfluences;
        inf[d.browInnerUp] = 0.22 * (v ?? 0);
      }
      if (v === null) A.browT = null;
    }
    if (face.eyes.length && A.t >= A.nextSacc) {
      A.nextSacc = A.t + 0.9 + Math.random() * 2.2;
      A.eyeY = (Math.random() - 0.5) * 0.14; // yaw ±0.07 rad
      A.eyeX = (Math.random() - 0.5) * 0.06;
    }
    for (const e of face.eyes) {
      e.bone.rotation.y += (e.baseY + A.eyeY - e.bone.rotation.y) * (1 - Math.exp(-24 * dt));
      e.bone.rotation.x += (e.baseX + A.eyeX - e.bone.rotation.x) * (1 - Math.exp(-24 * dt));
    }

    // --- blinking: quick double-ramp every 2–6s ---
    A.t += dt;
    if (A.blinkT === null && A.t >= A.nextBlink) {
      A.blinkT = 0;
      A.nextBlink = A.t + 2 + Math.random() * 4;
    }
    if (A.blinkT !== null) {
      A.blinkT += dt;
      const ph = A.blinkT / 0.09; // 90ms close, 90ms open
      let v;
      if (ph < 1) v = ph;
      else if (ph < 2) v = 2 - ph;
      else { v = 0; A.blinkT = null; }
      for (const m of face.blink) {
        const d = m.morphTargetDictionary, inf = m.morphTargetInfluences;
        inf[d.eyeBlinkLeft] = v;
        inf[d.eyeBlinkRight] = v;
      }
    }
  });

  return <group ref={group}><primitive object={scene} /></group>;
}

function GlowDisc({ T }) {
  const tex = useMemo(() => {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(128, 128, 8, 128, 128, 126);
    gr.addColorStop(0, T.disc[0]); gr.addColorStop(0.55, T.disc[1]);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }, [T]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
      <circleGeometry args={[1.6, 48]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </mesh>
  );
}

export default function CoachChar3D({ speaking, transcript, theme }) {
  const T = THEMES[theme] || THEMES.neon;
  const [glKey, setGlKey] = useState(0);
  const [camTarget, setCamTarget] = useState([0, 1.0, 0]);
  useEffect(() => {
    if (!LOOK_HAND) return;
    const id = setInterval(() => {
      if (window.__handPos) { setCamTarget(window.__handPos); clearInterval(id); }
    }, 400);
    return () => clearInterval(id);
  }, []);
  return (
    <Canvas key={glKey} camera={{ position: [1.35, 1.5, 2.6], fov: 42 }} dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }} style={{ position: "absolute", inset: 0 }}
      onCreated={({ gl, scene }) => {
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          console.warn("[CH28] WebGL context lost — remounting canvas");
          setTimeout(() => setGlKey((k) => k + 1), 300);
        });
        // procedural PBR environment (no network): clearcoat paint, lenses and
        // metal actually get reflections instead of reading as flat plastic
        const pmrem = new THREE.PMREMGenerator(gl);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environmentIntensity = 0.38;
      }}>
      <color attach="background" args={[T.bg]} />
      <fog attach="fog" args={[T.bg, 7, 13]} />
      <hemisphereLight args={["#ffffff", T.hemiGround, T.hemiI]} />
      <directionalLight position={[2.5, 4, 2.5]} intensity={2.4} />
      <directionalLight position={[-3, 2, 1.5]} intensity={0.9} color={T.fill2} />
      <pointLight position={[-2.5, 2.2, -2.4]} intensity={T.accentI} color={T.accent} distance={8} />
      {!FLAGS.has("nomodel") && <Char speaking={speaking} transcript={transcript} />}
      <GlowDisc T={T} />
      {!FLAGS.has("nocourt") && <CourtEnv theme={theme} />}
      {!FLAGS.has("noshadow") &&
        <ContactShadows position={[0, 0.01, 0]} opacity={0.6} scale={6} blur={2.4} far={2.2} resolution={512} frames={Infinity} />}
      {!FLAGS.has("nogrid") &&
        <Grid args={[14, 14]} cellSize={0.35} cellColor={T.gridCell} sectionSize={1.4}
          sectionColor={T.gridSec} fadeDistance={9} infiniteGrid position={[0, 0, 0]} />}
      {!LOOK_HAND &&
        <OrbitControls makeDefault enablePan={false} minDistance={0.3} maxDistance={6}
          target={camTarget} autoRotate autoRotateSpeed={0.5} enableDamping />}
    </Canvas>
  );
}

useGLTF.preload(MODEL_URL);
