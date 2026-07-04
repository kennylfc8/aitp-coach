// CH28 PRO — game-quality coach with a real animation state machine (40 Mixamo clips).
// Boot: Standing Greeting → Idle. Idle alternates with Breathing Idle + rare Look Around.
// Speaking: keyword gesture (clap/point/fist/...) → Talking loop → back to Idle.
// Right-hand fingers stay curled on the racquet (clip tracks for them are filtered out).
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid, ContactShadows, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";
import { getClipFor, buildBoneIndex, gestureFor } from "../coachAnims";

const CURL = { f1: 0.95, f2: 1.05, f3: 0.75, t1x: 0.5, t2z: -0.55, t3z: -0.3 };
const RQ_POS = [0.055, 0.08, 0];
const RQ_ROT = [-1.57, 0, 0];
const FLAGS = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();

function Char({ speaking, transcript }) {
  const { scene } = useGLTF("/Ch28w.glb");
  const group = useRef();
  const bones = useMemo(() => ({}), []);
  const A = useRef({ mixer: null, actions: new Map(), current: null, currentName: "",
    boneIndex: null, speaking: false, busy: false, booted: false }).current;

  // ---------- model prep (once) ----------
  useEffect(() => {
    scene.traverse((o) => {
      if (o.isMesh) {
        const meshName = (o.name || "").toLowerCase();
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
        o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false;
      }
      if (o.isBone) {
        const n = o.name.toLowerCase();
        const put = (k) => { if (!bones[k]) bones[k] = o; };
        if (n.endsWith("righthand")) put("rHand");
        for (const f of ["index", "middle", "ring", "pinky"])
          for (let i = 1; i <= 3; i++) if (n.endsWith("righthand" + f + i)) put(f + i);
        for (let i = 1; i <= 3; i++) if (n.endsWith("righthandthumb" + i)) put("thumb" + i);
      }
    });
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
      for (const f of ["index", "middle", "ring", "pinky"]) {
        rot(f + 1, 0, 0, -CURL.f1); rot(f + 2, 0, 0, -CURL.f2); rot(f + 3, 0, 0, -CURL.f3);
      }
      rot("thumb1", CURL.t1x, 0, 0); rot("thumb2", 0, 0, CURL.t2z); rot("thumb3", 0, 0, CURL.t3z);
    }
    // racquet parented to the right hand
    if (bones.rHand && !bones.rHand.getObjectByName("racq")) {
      const rq = new THREE.Group(); rq.name = "racq";
      const frame = new THREE.MeshStandardMaterial({ color: "#c8ff00", roughness: 0.4, metalness: 0.15, emissive: "#5d7a00", emissiveIntensity: 0.3 });
      const dark = new THREE.MeshStandardMaterial({ color: "#22262c", roughness: 0.5 });
      const h1 = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.2, 12), dark); h1.position.y = 0.08; rq.add(h1);
      const th = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.014, 12, 40), frame); th.position.y = 0.3; rq.add(th);
      const st = new THREE.Mesh(new THREE.CircleGeometry(0.114, 32),
        new THREE.MeshBasicMaterial({ color: "#eafff1", transparent: true, opacity: 0.22, side: THREE.DoubleSide }));
      st.position.y = 0.3; rq.add(st);
      rq.position.set(...RQ_POS); rq.rotation.set(...RQ_ROT);
      bones.rHand.add(rq);
    }
    scene.updateMatrixWorld(true);
  }, [scene, bones]);

  // ---------- animation machine ----------
  const ensure = async (name) => {
    if (A.actions.has(name)) return A.actions.get(name);
    const clip = await getClipFor(name, A.boneIndex);
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
    (async () => {
      A.busy = true;
      await playOnce("greet", 0.2);
      A.busy = false;
      if (!A.speaking) playLoop("idle");
    })();
    const sway = setInterval(() => {
      if (A.speaking || A.busy) return;
      if (A.currentName === "idle") playLoop("breathing", 0.6);
      else if (A.currentName === "breathing") playLoop("idle", 0.6);
    }, 32000);
    const look = setInterval(async () => {
      if (A.speaking || A.busy) return;
      if (A.currentName === "idle" || A.currentName === "breathing") {
        A.busy = true; await playOnce("look", 0.4); A.busy = false;
        if (!A.speaking) playLoop("idle", 0.4);
      }
    }, 77000);
    return () => { clearInterval(sway); clearInterval(look); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  // speaking: gesture → talking loop → idle
  useEffect(() => {
    if (!A.mixer) return;
    A.speaking = speaking;
    (async () => {
      if (speaking) {
        const g = gestureFor(transcript);
        A.busy = true;
        if (g) await playOnce(g, 0.25);
        A.busy = false;
        if (A.speaking) playLoop("talk", 0.3);
      } else if (!A.busy) {
        playLoop("idle", 0.5);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speaking]);

  useFrame((_, dt) => { if (A.mixer) A.mixer.update(dt); });

  return <group ref={group}><primitive object={scene} /></group>;
}

function GlowDisc() {
  const tex = useMemo(() => {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(128, 128, 8, 128, 128, 126);
    gr.addColorStop(0, "rgba(120,240,140,.45)"); gr.addColorStop(0.55, "rgba(60,160,90,.14)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }, []);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
      <circleGeometry args={[1.6, 48]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </mesh>
  );
}

export default function CoachChar3D({ speaking, transcript }) {
  const [glKey, setGlKey] = useState(0);
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
      <color attach="background" args={["#020a06"]} />
      <fog attach="fog" args={["#020a06", 7, 13]} />
      <hemisphereLight args={["#ffffff", "#1a241c", 1.5]} />
      <directionalLight position={[2.5, 4, 2.5]} intensity={2.4} />
      <directionalLight position={[-3, 2, 1.5]} intensity={0.9} color="#cfe0f0" />
      <pointLight position={[-2.5, 2.2, -2.4]} intensity={14} color="#c8ff00" distance={8} />
      {!FLAGS.has("nomodel") && <Char speaking={speaking} transcript={transcript} />}
      <GlowDisc />
      {!FLAGS.has("noshadow") &&
        <ContactShadows position={[0, 0.01, 0]} opacity={0.6} scale={6} blur={2.4} far={2.2} resolution={512} frames={Infinity} />}
      {!FLAGS.has("nogrid") &&
        <Grid args={[14, 14]} cellSize={0.35} cellColor="#12301d" sectionSize={1.4}
          sectionColor="#1f4a2c" fadeDistance={9} infiniteGrid position={[0, 0, 0]} />}
      <OrbitControls enablePan={false} minDistance={1.2} maxDistance={6}
        target={[0, 1.0, 0]} autoRotate autoRotateSpeed={0.5} enableDamping />
    </Canvas>
  );
}

useGLTF.preload("/Ch28w.glb");
