import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { lipsyncManager, isConnected } from "../lipsync";
import { VISEME_OPENNESS } from "../visemes";

const lerp = (a, b, t) => a + (b - a) * t;

// Placeholder 3D coach (procedural). Swap for an Avaturn GLB later — see web/README.md:
// the same `lipsyncManager.viseme` drives morph targets `viseme_<key>` on a real model.
export default function Avatar() {
  const group = useRef();
  const mouth = useRef();
  const open = useRef(0);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (group.current) {
      group.current.position.y = Math.sin(t * 1.5) * 0.03;       // idle breathing
      group.current.rotation.y = Math.sin(t * 0.5) * 0.12;       // gentle sway
    }

    let target = 0;
    if (isConnected()) {
      lipsyncManager.processAudio();
      target = VISEME_OPENNESS[lipsyncManager.viseme] ?? 0;
    }
    open.current = lerp(open.current, target, 1 - Math.pow(0.0001, delta)); // smooth

    if (mouth.current) {
      mouth.current.scale.y = 0.12 + open.current * 1.0;
      mouth.current.position.y = -0.42 - open.current * 0.06;
    }
  });

  return (
    <group ref={group}>
      <mesh castShadow>
        <sphereGeometry args={[1, 48, 48]} />
        <meshStandardMaterial color="#e7b48c" roughness={0.75} />
      </mesh>
      {/* eyes */}
      <mesh position={[-0.34, 0.22, 0.85]}>
        <sphereGeometry args={[0.12, 24, 24]} />
        <meshStandardMaterial color="#15181d" />
      </mesh>
      <mesh position={[0.34, 0.22, 0.85]}>
        <sphereGeometry args={[0.12, 24, 24]} />
        <meshStandardMaterial color="#15181d" />
      </mesh>
      {/* mouth — driven by lip-sync */}
      <mesh ref={mouth} position={[0, -0.42, 0.9]}>
        <boxGeometry args={[0.5, 0.18, 0.1]} />
        <meshStandardMaterial color="#7a1f1f" roughness={0.5} />
      </mesh>
      {/* tennis headband */}
      <mesh position={[0, 0.6, 0]}>
        <torusGeometry args={[0.93, 0.1, 16, 48]} />
        <meshStandardMaterial color="#c8ff00" roughness={0.6} />
      </mesh>
    </group>
  );
}
