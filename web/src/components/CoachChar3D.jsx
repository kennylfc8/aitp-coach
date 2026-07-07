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
  // ring is tangent to the handle (grid-searched against the curled joints)
  const gripCenter = pI.clone().add(pP).multiplyScalar(0.5)
    .addScaledVector(normal, 0.028).addScaledVector(along, -0.009);
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
  // the hand holds NEAR THE BUTT, like a real grip: fist center ~4.5cm up the handle,
  // so the butt cap barely peeks past the heel of the palm
  const butt = gripCenter.clone().addScaledVector(handleDir, -0.045);
  const off = ["rqox", "rqoy", "rqoz"].map((k) => (parseFloat(FLAGS.get(k)) || 0) / 100);
  butt.addScaledVector(ortho, off[0]).addScaledVector(across, off[1]).addScaledVector(normal, off[2]);
  rq.position.copy(rHand.worldToLocal(butt));
}
const FLAGS = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
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
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0165, 0.018, 0.19, 8, 1, false, -Math.PI / 8), gripMat);
      grip.position.y = 0.105; rq.add(grip);
      // flared butt cap (wider than the handle, like a real racquet) + end sticker
      const capMat = new THREE.MeshStandardMaterial({ color: "#17191d", roughness: 0.5, flatShading: true });
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0195, 0.021, 0.016, 8, 1, false, -Math.PI / 8), capMat);
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
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0172, 0.018, 8, 1, false, -Math.PI / 8), limeMat);
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
      const beam = new THREE.Shape();      // cross-section: 23mm deep × 12mm in-plane
      beam.absellipse(0, 0, 0.006, 0.0115, 0, Math.PI * 2);
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

      // strings: 16×19 pattern, thin, slight sheen + lime stencil in the center
      const sc = document.createElement("canvas"); sc.width = sc.height = 512;
      const sg = sc.getContext("2d");
      sg.strokeStyle = "rgba(238,242,246,0.9)"; sg.lineWidth = 1.6;
      for (let i = 1; i < 16; i++) { const x = (i / 16) * 512;
        sg.beginPath(); sg.moveTo(x, 0); sg.lineTo(x, 512); sg.stroke(); }
      for (let i = 1; i < 19; i++) { const y = (i / 19) * 512;
        sg.beginPath(); sg.moveTo(0, y); sg.lineTo(512, y); sg.stroke(); }
      sg.strokeStyle = "rgba(168,228,0,0.5)"; sg.lineWidth = 10; sg.lineCap = "round";
      sg.beginPath(); sg.moveTo(196, 320); sg.lineTo(256, 190); sg.lineTo(316, 320); sg.stroke();
      sg.beginPath(); sg.moveTo(222, 272); sg.lineTo(290, 272); sg.stroke(); // stencil "A"
      const strTex = new THREE.CanvasTexture(sc);
      // string plane clipped by the superellipse (shape geometry, not a circle)
      const strShape = new THREE.Shape();
      const pts = [];
      for (let i = 0; i <= 64; i++) { const p = sePoint((i / 64) * Math.PI * 2); pts.push(new THREE.Vector2(p.x * 0.945, p.y * 0.945)); }
      strShape.setFromPoints(pts);
      const strGeo = new THREE.ShapeGeometry(strShape, 24);
      // map UVs to the shape bounds so the grid fills the head
      strGeo.computeBoundingBox();
      const bb = strGeo.boundingBox, uv = strGeo.attributes.uv, pos = strGeo.attributes.position;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (pos.getX(i) - bb.min.x) / (bb.max.x - bb.min.x),
          (pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y));
      }
      const strings = new THREE.Mesh(strGeo, new THREE.MeshBasicMaterial({
        map: strTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      strings.position.y = HOOP_Y; rq.add(strings);

      if (CHAR === "ch28") {
        rq.position.set(...RQ_POS); rq.rotation.set(...RQ_ROT);
      } else {
        fitRacquetToHand(scene, bones, rq);
      }
      bones.rHand.add(rq);
    }
    // sport-fit accessories (?fit=sport): real snapback model (backwards) + sport
    // wraparound shades. Outfit meshes (tank/shorts/sneakers) arrive with the
    // re-exported avatar — Avaturn culls body geometry under clothes.
    if (FLAGS.get("fit") === "sport" && bones.head && !bones.head.getObjectByName("cap")) {
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
      // snapback worn backwards: dome (fits the measured skull) + a STRAIGHT
      // rectangular visor with parallel sides pointing back — per the boss's spec
      const capHolder = new THREE.Group(); capHolder.name = "cap";
      capHolder.quaternion.copy(qAlign);
      capHolder.position.copy(upL.clone().multiplyScalar(0.128)).addScaledVector(backL, -0.014);
      bones.head.add(capHolder);
      const capMat = new THREE.MeshStandardMaterial({ color: "#101216", roughness: 0.85 });
      const limeMat = new THREE.MeshStandardMaterial({ color: "#c8ff00", roughness: 0.5, emissive: "#2c3d00", emissiveIntensity: 0.35 });
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.124, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
      dome.scale.y = 0.88; capHolder.add(dome);
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.007, 12), limeMat);
      btn.position.y = 0.098; capHolder.add(btn);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.104, 0.007, 0.15), capMat);
      visor.position.set(0, 0.012, -0.17); visor.rotation.x = -0.14; capHolder.add(visor);
      // sport shades: smooth wraparound shield + temples (procedural, gloss black)
      const shades = new THREE.Group(); shades.name = "shades";
      const lensMat = new THREE.MeshStandardMaterial({ color: "#06080d", metalness: 0.8, roughness: 0.08, emissive: "#101c28", emissiveIntensity: 0.45, side: THREE.DoubleSide });
      const shield = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 36, 10, Math.PI / 2 - 1.15, 2.3, Math.PI / 2 - 0.22, 0.36), lensMat);
      shades.add(shield);
      const armMat = new THREE.MeshStandardMaterial({ color: "#0c0e12", roughness: 0.4, metalness: 0.4 });
      for (const sx of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.007, 0.1), armMat);
        arm.position.set(sx * 0.075, 0.01, -0.045); shades.add(arm);
      }
      shades.quaternion.copy(qAlign);
      shades.position.copy(upL.clone().multiplyScalar(0.085)).addScaledVector(backL, -0.028);
      bones.head.add(shades);
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
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          console.warn("[CH28] WebGL context lost — remounting canvas");
          setTimeout(() => setGlKey((k) => k + 1), 300);
        });
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
