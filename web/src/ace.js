// ACE — the mascot coach: our athlete body with a giant fuzzy tennis ball for a
// head. Procedural (no new assets): felt sphere + fuzz shell, the classic wavy
// seam, cartoon eyes that track the camera, and a sprite mouth driven by the
// same visemes as the realistic face. Enabled with ?char=ace.
//
// Cartoon motion layer (updateAceFace): squash & stretch along the head's
// velocity, a damped spring that makes the ball wobble after sudden stops
// (secondary motion), a speech nod on open visemes. Node chain under the bone:
//   head (seat on the neck) -> jig (spring offset) -> sA (R·S) -> sB (R⁻¹) -> parts
// so the stretch is applied along an arbitrary axis without rotating the face.
import * as THREE from "three";

const R = 0.15;                     // head radius (m) — ~1.5x a skull, mascot scale
const FELT = "#d4ea3a", SEAM = "#f2f4e4";
const MOUTH_Y = -0.062, MOUTH_W = 0.11, MOUTH_H = 0.07;

// mouth sprite sheet: one canvas, 8 cells (sil, aa, E, O, U, FF, PP, smile)
const MOUTHS = ["viseme_sil", "viseme_aa", "viseme_E", "viseme_O", "viseme_U", "viseme_FF", "viseme_PP", "smile"];
function mouthSheet() {
  const w = 256, h = 160, c = document.createElement("canvas");
  c.width = w * MOUTHS.length; c.height = h;
  const g = c.getContext("2d");
  const draw = (i, fn) => { g.save(); g.translate(i * w + w / 2, h / 2); fn(g); g.restore(); };
  const lips = (g, rx, ry, open, teeth = true) => {
    g.fillStyle = "#3a1414"; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.fill();
    if (open > 0.3) { g.fillStyle = "#b8324a"; g.beginPath(); g.ellipse(0, ry * 0.3, rx * 0.55, ry * 0.42, 0, 0, Math.PI * 2); g.fill(); }
    if (teeth && open > 0.15) { g.fillStyle = "#fbfbf6"; g.fillRect(-rx * 0.7, -ry * 0.9, rx * 1.4, ry * 0.42); }
    g.lineWidth = 9; g.strokeStyle = "#2a1010"; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.stroke();
  };
  draw(0, g => { g.lineWidth = 11; g.strokeStyle = "#2a1010"; g.lineCap = "round";
    g.beginPath(); g.moveTo(-70, 8); g.quadraticCurveTo(0, 34, 70, 8); g.stroke(); });          // sil: smirk
  draw(1, g => lips(g, 78, 58, 1));                                                              // aa
  draw(2, g => lips(g, 92, 34, 0.5));                                                            // E
  draw(3, g => lips(g, 46, 62, 0.8, false));                                                     // O
  draw(4, g => lips(g, 34, 40, 0.6, false));                                                     // U
  draw(5, g => { lips(g, 80, 26, 0.2); });                                                       // FF
  draw(6, g => { g.lineWidth = 12; g.strokeStyle = "#2a1010"; g.lineCap = "round";
    g.beginPath(); g.moveTo(-60, 0); g.lineTo(60, 0); g.stroke(); });                            // PP
  draw(7, g => { g.lineWidth = 11; g.strokeStyle = "#2a1010"; g.lineCap = "round";
    g.beginPath(); g.moveTo(-90, -6); g.quadraticCurveTo(0, 70, 90, -6); g.stroke();
    g.fillStyle = "#fbfbf6"; g.beginPath(); g.moveTo(-70, 2); g.quadraticCurveTo(0, 50, 70, 2); g.closePath(); g.fill(); }); // smile+teeth
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.repeat.set(1 / MOUTHS.length, 1);
  return tex;
}

// a patch of sphere just outside the felt, facing +z, UVs 0..1 over the patch
function spherePatch(radius, cy, width, height) {
  const phiL = width / radius, thL = height / radius;
  const thC = Math.acos(THREE.MathUtils.clamp(cy / radius, -1, 1));
  return new THREE.SphereGeometry(radius, 24, 12, Math.PI / 2 - phiL / 2, phiL, thC - thL / 2, thL);
}

export function buildAceHead(THREE_, headBone, upL, fwdL) {
  const head = new THREE.Group(); head.name = "aceHead";
  const jig = new THREE.Group(), sA = new THREE.Group(), sB = new THREE.Group(), parts = new THREE.Group();
  head.add(jig); jig.add(sA); sA.add(sB); sB.add(parts);
  // felt ball + fuzz shell (fresnel-ish rim via a slightly larger, transparent back-faced sphere)
  const felt = new THREE.MeshStandardMaterial({ color: FELT, roughness: 1, emissive: "#4d5c0e", emissiveIntensity: 0.2 });
  const fuzz = new THREE.MeshStandardMaterial({ color: "#e9f58a", transparent: true, opacity: 0.35, roughness: 1,
    side: THREE.BackSide, depthWrite: false });
  parts.add(new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32), felt));
  parts.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.035, 48, 32), fuzz));
  // seam: equator modulated by cos2t, rotated so it runs over the crown like a real ball
  const pts = [];
  for (let i = 0; i < 128; i++) {
    const t = i / 128 * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(t), Math.sin(t), 0.62 * Math.cos(2 * t)).normalize().multiplyScalar(R + 0.001));
  }
  const seam = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 192, 0.0055, 8, true),
    new THREE.MeshStandardMaterial({ color: SEAM, roughness: 0.85 }));
  seam.rotation.set(0.9, 0.3, 0.5); parts.add(seam);
  // eyes: white sclera + dark iris with highlight, set forward on the ball
  const eyes = [];
  for (const sx of [-1, 1]) {
    const e = new THREE.Group();
    const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.036, 24, 16), new THREE.MeshStandardMaterial({ color: "#fbfbf8", roughness: 0.3 }));
    sclera.scale.set(1, 1.25, 0.55); e.add(sclera);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.017, 20, 14), new THREE.MeshStandardMaterial({ color: "#1b1b1f", roughness: 0.25 }));
    iris.position.z = 0.019; iris.name = "iris"; e.add(iris);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 10, 8), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
    glint.position.set(0.006, 0.008, 0.034); e.add(glint);
    // brow: a felt-dark arc that tilts with mood
    const brow = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 8, 24, Math.PI * 0.7), new THREE.MeshStandardMaterial({ color: "#2a1010" }));
    brow.position.set(0, 0.052, 0.006); brow.rotation.z = Math.PI * 0.15 + sx * 0.25; brow.name = "brow"; e.add(brow);
    e.position.set(sx * 0.055, 0.012, R * 0.93); e.lookAt(sx * 0.3, 0.1, 2); eyes.push(e); parts.add(e);
  }
  // felt collar: a short cone under the ball that swallows the neck stump
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.42, R * 0.62, 0.07, 32, 1, true), felt);
  collar.position.y = -R * 0.78; parts.add(collar);
  // mouth: sprite wrapped onto the ball below the eyes (reads from 3/4 and profile too)
  const sheet = mouthSheet();
  const mouth = new THREE.Mesh(spherePatch(R + 0.0015, MOUTH_Y, MOUTH_W, MOUTH_H),
    new THREE.MeshBasicMaterial({ map: sheet, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  mouth.name = "mouth"; parts.add(mouth);
  // sit the ball on the neck: centre above the head bone along the rig's up axis, slightly forward
  head.position.copy(upL.clone().multiplyScalar(0.045)).addScaledVector(fwdL, 0.012);
  head.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3().crossVectors(upL, fwdL).normalize(), upL, fwdL));
  headBone.add(head);
  return { head, jig, sA, sB, parts, eyes, mouth, sheet,
    state: { squash: 0, mood: 0, stretch: 0, prevPos: null, prevVel: new THREE.Vector3(), jigPos: new THREE.Vector3(), jigVel: new THREE.Vector3(), jigMax: 0, stretchMax: 0 } };
}

const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _a = new THREE.Vector3(), _q = new THREE.Quaternion(), _t = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// per-frame: viseme -> mouth cell, camera-tracking irises, blink, speech squash,
// velocity stretch + spring wobble from the bone's motion
export function updateAceFace(ace, { viseme, speaking, camera, dt, t, blink }) {
  const S = ace.state;
  const idx = Math.max(0, MOUTHS.indexOf(speaking ? viseme : (Math.sin(t * 0.7) > 0.6 ? "smile" : "viseme_sil")));
  ace.sheet.offset.x = idx / MOUTHS.length;
  for (const e of ace.eyes) {
    const iris = e.getObjectByName("iris");
    e.worldToLocal(_t.copy(camera.position));
    iris.position.x += (THREE.MathUtils.clamp(_t.x * 0.02, -0.012, 0.012) - iris.position.x) * (1 - Math.exp(-10 * dt));
    iris.position.y += (THREE.MathUtils.clamp(_t.y * 0.02, -0.01, 0.01) - iris.position.y) * (1 - Math.exp(-10 * dt));
    e.scale.y += ((blink ? 0.08 : 1) - e.scale.y) * (1 - Math.exp(-40 * dt));
    // brows lift while talking — a touch of "listen to me"
    const brow = e.getObjectByName("brow");
    brow.position.y += ((speaking ? 0.058 : 0.052) - brow.position.y) * (1 - Math.exp(-8 * dt));
  }
  // speech squash + nod: the ball squashes and dips on open visemes — cartoon emphasis
  const open = speaking && /aa|O|E/.test(viseme) ? 1 : 0;
  S.squash += (open * 0.06 - S.squash) * (1 - Math.exp(-18 * dt));
  ace.parts.rotation.x = S.squash * 1.2;

  // --- motion layer from the bone's world motion (works for any animation clip) ---
  if (!(dt > 0) || dt > 0.1) { S.prevPos = null; return; }
  ace.head.getWorldPosition(_p);
  ace.head.getWorldQuaternion(_q).invert();            // world -> head local
  if (!S.prevPos) { S.prevPos = _p.clone(); S.prevVel.set(0, 0, 0); }
  _v.copy(_p).sub(S.prevPos).divideScalar(dt);          // m/s
  _a.copy(_v).sub(S.prevVel).divideScalar(dt);          // m/s²
  S.prevPos.copy(_p); S.prevVel.copy(_v);
  // squash & stretch along velocity: k grows above ~0.35 m/s, capped at 28 %
  const speed = _v.length();
  if (speed > 12) { S.prevVel.set(0, 0, 0); return; }   // scrub/teleport: not motion, no stretch
  const kGoal = THREE.MathUtils.clamp((speed - 0.35) / 1.6, 0, 0.28);
  S.stretch += (kGoal - S.stretch) * (1 - Math.exp(-(kGoal > S.stretch ? 30 : 10) * dt));
  S.stretchMax = Math.max(S.stretchMax, S.stretch);
  if (speed > 0.05) {
    _t.copy(_v).applyQuaternion(_q).normalize();        // velocity dir in head local
    ace.sA.quaternion.setFromUnitVectors(UP, _t);
    ace.sB.quaternion.copy(ace.sA.quaternion).invert();
  }
  const k = S.stretch;
  ace.sA.scale.set(1 - k * 0.45 + S.squash * 0.5, 1 + k - S.squash, 1 - k * 0.45 + S.squash * 0.5);
  // secondary motion: damped spring driven by -acceleration (the ball keeps going when the neck stops)
  _a.applyQuaternion(_q).multiplyScalar(-0.3);         // force in head local
  const K = 180, C = 11, sub = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / sub;
  for (let i = 0; i < sub; i++) {
    S.jigVel.addScaledVector(_t.copy(_a).addScaledVector(S.jigPos, -K).addScaledVector(S.jigVel, -C), h);
    S.jigPos.addScaledVector(S.jigVel, h);
  }
  const m = S.jigPos.length(); if (m > 0.025) S.jigPos.multiplyScalar(0.025 / m);
  S.jigMax = Math.max(S.jigMax, S.jigPos.length());
  ace.jig.position.copy(S.jigPos);
}
