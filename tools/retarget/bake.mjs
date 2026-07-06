// Bake a foreign-rig animation clip onto the Avaturn coach skeleton.
//
//   node bake.mjs <source.gltf|.glb> --list
//   node bake.mjs <source.gltf|.glb> <clipName> <out.glb> [--map=quaternius]
//
// Output GLB contains the Avaturn bone tree + one clip whose tracks are named
// "<AvaturnBone>.<prop>" — exactly what web/src/coachAnims.js getClipFor expects.
// Hips position values are pre-divided by the runtime hips-scale correction
// (restY/0.96) so the runtime multiply lands at 1:1.
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { retargetClip } from "three/examples/jsm/utils/SkeletonUtils.js";

const AVATURN_GLB = new URL("../../web/public/AvaturnCoach.glb", import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, "$1"); // strip leading slash on win32 file URLs
const SRC_HIPS_REST = 0.96; // runtime convention, see coachAnims.js

// ---------- minimal glTF reading (nodes + animations; meshes/skins ignored) ----------

function readGltf(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) === 0x46546c67) { // GLB
    const jsonLen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
    const bins = [];
    let off = 20 + jsonLen;
    while (off < buf.length) {
      const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
      if (type === 0x004e4942) bins.push(buf.slice(off + 8, off + 8 + len));
      off += 8 + len;
    }
    return { json, bins };
  }
  const json = JSON.parse(buf.toString("utf8"));
  const bins = (json.buffers || []).map((b) =>
    fs.readFileSync(path.resolve(path.dirname(file), decodeURIComponent(b.uri))));
  return { json, bins };
}

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function accessor({ json, bins }, idx) {
  const a = json.accessors[idx];
  const bv = json.bufferViews[a.bufferView];
  const bin = bins[bv.buffer];
  const T = COMP[a.componentType], n = SIZE[a.type];
  const byteOff = (bv.byteOffset || 0) + (a.byteOffset || 0);
  return new T(bin.buffer, bin.byteOffset + byteOff, a.count * n);
}

const sane = (s) => s.replace(/[.\s]/g, "_"); // PropertyBinding chokes on dots in node names

function buildBoneTree({ json }) {
  const bones = json.nodes.map((n) => {
    const b = new THREE.Bone();
    b.name = sane(n.name || "node");
    if (n.translation) b.position.fromArray(n.translation);
    if (n.rotation) b.quaternion.fromArray(n.rotation);
    if (n.scale) b.scale.fromArray(n.scale);
    return b;
  });
  json.nodes.forEach((n, i) => (n.children || []).forEach((c) => bones[i].add(bones[c])));
  const roots = json.scenes[json.scene || 0].nodes.map((i) => bones[i]);
  const helper = new THREE.Object3D();
  roots.forEach((r) => helper.add(r));
  helper.updateMatrixWorld(true);
  helper.skeleton = new THREE.Skeleton(bones); // bind = rest TRS from the file
  return { helper, bones };
}

function buildClip(gltf, animIdx, bones) {
  const a = gltf.json.animations[animIdx];
  const tracks = [];
  for (const ch of a.channels) {
    const s = a.samplers[ch.sampler];
    if (ch.target.node === undefined) continue;
    const bone = bones[ch.target.node];
    const times = accessor(gltf, s.input);
    const vals = accessor(gltf, s.output);
    const interp = s.interpolation === "STEP" ? THREE.InterpolateDiscrete : THREE.InterpolateLinear;
    let tr;
    if (ch.target.path === "rotation")
      tr = new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, vals);
    else if (ch.target.path === "translation")
      tr = new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, vals);
    else if (ch.target.path === "scale")
      tr = new THREE.VectorKeyframeTrack(`${bone.name}.scale`, times, vals);
    else continue;
    tr.setInterpolation(interp);
    tracks.push(tr);
  }
  return new THREE.AnimationClip(a.name, -1, tracks);
}

// ---------- bone-name maps (target Avaturn name -> source name, sanitized) ----------

function quaterniusMap() {
  const m = {
    Hips: "DEF-hips", Spine: "DEF-spine_001", Spine1: "DEF-spine_002", Spine2: "DEF-spine_003",
    Neck: "DEF-neck", Head: "DEF-head",
  };
  for (const [T, S] of [["Left", "L"], ["Right", "R"]]) {
    m[`${T}Shoulder`] = `DEF-shoulder_${S}`;
    m[`${T}Arm`] = `DEF-upper_arm_${S}`;
    m[`${T}ForeArm`] = `DEF-forearm_${S}`;
    m[`${T}Hand`] = `DEF-hand_${S}`;
    m[`${T}UpLeg`] = `DEF-thigh_${S}`;
    m[`${T}Leg`] = `DEF-shin_${S}`;
    m[`${T}Foot`] = `DEF-foot_${S}`;
    m[`${T}ToeBase`] = `DEF-toe_${S}`;
    for (const [f, src] of [["Thumb", "thumb"], ["Index", "f_index"], ["Middle", "f_middle"], ["Ring", "f_ring"], ["Pinky", "f_pinky"]])
      for (let i = 1; i <= 3; i++) m[`${T}Hand${f}${i}`] = `DEF-${src}_0${i}_${S}`;
  }
  return m;
}
const MAPS = { quaternius: quaterniusMap };

// ---------- minimal GLB writing (bone nodes + one animation) ----------

function writeGlb(outFile, targetGltfJson, clip) {
  // rebuild just the Armature/bone subtree of the Avaturn file, re-indexed
  const src = targetGltfJson;
  const keep = [];
  const seen = new Map();
  const visit = (i) => {
    if (seen.has(i)) return seen.get(i);
    const n = src.nodes[i];
    if (n.mesh !== undefined || n.camera !== undefined) return -1;
    const idx = keep.length;
    seen.set(i, idx);
    const copy = { name: n.name };
    for (const k of ["translation", "rotation", "scale"]) if (n[k]) copy[k] = n[k];
    keep.push(copy);
    const kids = (n.children || []).map(visit).filter((x) => x >= 0);
    if (kids.length) copy.children = kids;
    return idx;
  };
  const rootIdx = src.scenes[src.scene || 0].nodes.map(visit).filter((x) => x >= 0);
  const nodeIdx = new Map(keep.map((n, i) => [n.name, i]));

  const binParts = [];
  const bufferViews = [], accessors = [];
  let byteOff = 0;
  const pushData = (f32, type) => {
    const buf = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
    binParts.push(buf);
    bufferViews.push({ buffer: 0, byteOffset: byteOff, byteLength: buf.length });
    byteOff += buf.length;
    const pad = (4 - (byteOff % 4)) % 4;
    if (pad) { binParts.push(Buffer.alloc(pad)); byteOff += pad; }
    const acc = { bufferView: bufferViews.length - 1, componentType: 5126, count: f32.length / SIZE[type], type };
    if (type === "SCALAR") { acc.min = [f32[0]]; acc.max = [f32[f32.length - 1]]; }
    accessors.push(acc);
    return accessors.length - 1;
  };

  const samplers = [], channels = [];
  for (const tr of clip.tracks) {
    const dot = tr.name.lastIndexOf(".");
    const bone = tr.name.slice(0, dot), prop = tr.name.slice(dot + 1);
    const node = nodeIdx.get(bone);
    if (node === undefined) continue;
    const path = prop === "quaternion" ? "rotation" : prop === "position" ? "translation" : null;
    if (!path) continue;
    const input = pushData(new Float32Array(tr.times), "SCALAR");
    const output = pushData(new Float32Array(tr.values), path === "rotation" ? "VEC4" : "VEC3");
    samplers.push({ input, output, interpolation: "LINEAR" });
    channels.push({ sampler: samplers.length - 1, target: { node, path } });
  }

  const bin = Buffer.concat(binParts);
  const json = {
    asset: { version: "2.0", generator: "aitp-coach bake.mjs" },
    scene: 0, scenes: [{ nodes: rootIdx }], nodes: keep,
    buffers: [{ byteLength: bin.length }],
    bufferViews, accessors,
    animations: [{ name: clip.name, samplers, channels }],
  };
  let jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  const jpad = (4 - (jsonBuf.length % 4)) % 4;
  if (jpad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jpad, 0x20)]);
  const bpad = (4 - (bin.length % 4)) % 4;
  const binBuf = bpad ? Buffer.concat([bin, Buffer.alloc(bpad)]) : bin;
  const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const head = Buffer.alloc(12 + 8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  head.writeUInt32LE(jsonBuf.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(binBuf.length, 0); binHead.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(outFile, Buffer.concat([head, jsonBuf, binHead, binBuf]));
  return { bytes: total, tracks: channels.length };
}

// ---------- main ----------

const args = process.argv.slice(2);
if (!args.length) {
  console.log("usage: node bake.mjs <src.gltf|glb> --list | <src> <clip> <out.glb> [--map=quaternius]");
  process.exit(1);
}
const srcFile = args[0];
const src = readGltf(srcFile);

if (args.includes("--list")) {
  console.log(src.json.animations.map((a) => a.name).join("\n"));
  process.exit(0);
}

const clipName = args[1], outFile = args[2];
const mapName = (args.find((a) => a.startsWith("--map=")) || "--map=quaternius").slice(6);
const names = MAPS[mapName]();
for (const k of Object.keys(names)) names[k] = sane(names[k]);

const animIdx = src.json.animations.findIndex((a) => a.name === clipName);
if (animIdx < 0) { console.error("clip not found:", clipName); process.exit(1); }

const S = buildBoneTree(src);
const tgtGltf = readGltf(AVATURN_GLB);
const T = buildBoneTree(tgtGltf);

const byName = (bones, n) => bones.find((b) => b.name === n);
const srcHips = byName(S.bones, names.Hips), tgtHips = byName(T.bones, "Hips");
const srcRest = srcHips.getWorldPosition(new THREE.Vector3()).y;
const tgtRest = tgtHips.getWorldPosition(new THREE.Vector3()).y;
console.log(`hips rest: source=${srcRest.toFixed(3)} target=${tgtRest.toFixed(3)} scale=${(tgtRest / srcRest).toFixed(4)}`);

// verify the map before retargeting
const missing = Object.entries(names).filter(([t, s]) => !byName(S.bones, s));
if (missing.length) console.warn("unmapped source bones:", missing.map(([t, s]) => `${t}->${s}`).join(", "));

// bind-pose compensation: retarget() copies source WORLD rotations verbatim, but
// Rigify and Mixamo binds differ per bone by a constant. localOffsets[target] =
// srcBindWorld⁻¹ · tgtBindWorld makes the target reproduce the source's DELTA
// from bind instead of its absolute orientation. Both trees are at rest here.
const localOffsets = {};
for (const [tName, sName] of Object.entries(names)) {
  const tb = byName(T.bones, tName), sb = byName(S.bones, sName);
  if (!tb || !sb) continue;
  const qs = sb.getWorldQuaternion(new THREE.Quaternion());
  const qt = tb.getWorldQuaternion(new THREE.Quaternion());
  localOffsets[tName] = new THREE.Matrix4()
    .makeRotationFromQuaternion(qs.invert().multiply(qt));
}

const clip = buildClip(src, animIdx, S.bones);
const out = retargetClip(T.helper, S.helper, clip, {
  names, hip: names.Hips, scale: tgtRest / srcRest, fps: 30, useFirstFramePosition: false,
  localOffsets,
});

// ".bones[X].prop" -> "X.prop"; pre-divide hips positions by the runtime correction
const runtimeScale = tgtRest / SRC_HIPS_REST;
for (const tr of out.tracks) {
  tr.name = tr.name.replace(/^\.bones\[(.+?)\]\./, "$1.");
  if (/^Hips\.position$/.test(tr.name) && Math.abs(runtimeScale - 1) > 0.02)
    tr.values = Float32Array.from(tr.values, (v) => v / runtimeScale);
}

const stats = writeGlb(outFile, tgtGltf.json, out);
console.log(`baked "${clipName}" -> ${outFile}: ${out.duration.toFixed(2)}s, ${stats.tracks} tracks, ${(stats.bytes / 1024).toFixed(0)} KB`);
