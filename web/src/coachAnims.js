// Coach animation library: lazy-loads Mixamo clips (converted to GLB, same CH28 rig),
// remaps track names onto the live skeleton, filters right-hand fingers (racquet grip stays).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export const CLIPS = {
  idle: "idle", breathing: "breathing_idle", happy_idle: "happy_idle", sad_idle: "sad_idle",
  look: "looking_around", talk: "talking", greet: "standing_greeting", wave: "waving",
  salute: "salute", bow: "quick_formal_bow", point: "pointing_gesture",
  nod: "head_nod_yes", no: "shaking_head_no", shrug: "shrugging",
  victory: "victory", excited: "excited", fist: "fist_pump", clap: "clapping",
  laugh: "laughing", yell: "yelling", defeated: "defeated",
  warmup: "warming_up", arm_stretch: "arm_stretching", neck_stretch: "neck_stretching",
  jacks: "jumping_jacks", squat: "air_squat", burpee: "burpee", pushup: "push_up",
  situps: "situps", plank: "plank", boxing: "boxing",
  walk: "walking", run: "running", jump: "jump",
  golf: "golf_drive", pitch: "baseball_pitching", throw: "throw_object",
  dance: "hip_hop_dancing", backflip: "backflip", drink: "drinking",
};

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const loader = new GLTFLoader();
const rawCache = new Map();   // file -> Promise<AnimationClip (source)>

function loadRaw(file) {
  if (!rawCache.has(file)) {
    rawCache.set(file, new Promise((res, rej) => {
      loader.load(`/anims/${file}.glb`, (g) => {
        const clip = g.animations && g.animations[0];
        clip ? res(clip) : rej(new Error("no animation in " + file));
      }, undefined, rej);
    }));
  }
  return rawCache.get(file);
}

// Build a clip whose tracks point at THIS skeleton's bone names.
export async function getClipFor(name, boneIndex /* Map<normName, actualName> */) {
  const file = CLIPS[name];
  if (!file) throw new Error("unknown clip " + name);
  const src = await loadRaw(file);
  const tracks = [];
  for (const tr of src.tracks) {
    const dot = tr.name.lastIndexOf(".");
    const bone = tr.name.slice(0, dot), prop = tr.name.slice(dot + 1);
    const key = norm(bone).replace(/^mixamorig/, "");
    if (/righthand(index|middle|ring|pinky|thumb)/.test(key)) continue; // grip owns these
    if (prop === "scale") continue;
    if (prop === "position" && !/hips$/.test(key)) continue; // bones move by rotation; hips bobs
    let dst = boneIndex.get(key);
    if (!dst) { // suffix fallback
      for (const [n, actual] of boneIndex) if (n.endsWith(key) || key.endsWith(n)) { dst = actual; break; }
    }
    if (!dst) continue;
    const t2 = tr.clone();
    t2.name = `${dst}.${prop}`;
    tracks.push(t2);
  }
  return new THREE.AnimationClip(name, src.duration, tracks);
}

export function buildBoneIndex(root) {
  const idx = new Map();
  root.traverse((o) => { if (o.isBone) idx.set(norm(o.name).replace(/^mixamorig/, ""), o.name); });
  return idx;
}

// keyword → gesture (scanned once per coach reply)
const GESTURE_RULES = [
  [/молодец|отличн|красав|great|nice|good job|well done|perfect/i, "clap"],
  [/погнали|вперёд|давай|let'?s go|come on|go go/i, "fist"],
  [/смотри|фокус|watch|look|focus|важно/i, "point"],
  [/\bнет\b|не так|стоп|don'?t|wrong|stop/i, "no"],
  [/именно|точно|exactly|right|yes\b|да\b/i, "nod"],
  [/возможно|зависит|maybe|depends|not sure/i, "shrug"],
  [/ха-?ха|смешно|joke|😄|😂|lol/i, "laugh"],
];

export function gestureFor(text) {
  if (!text) return null;
  for (const [re, g] of GESTURE_RULES) if (re.test(text)) return g;
  return null;
}
