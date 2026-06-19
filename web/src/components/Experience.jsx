import { ContactShadows, OrbitControls } from "@react-three/drei";
import Avatar from "./Avatar";

export default function Experience() {
  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight position={[3, 5, 4]} intensity={1.5} castShadow />
      <directionalLight position={[-4, 2, -2]} intensity={0.4} color="#8ab4ff" />

      <group position={[0, -0.15, 0]}>
        <Avatar />
        <ContactShadows position={[0, -1.45, 0]} opacity={0.45} scale={6} blur={2.6} far={3} />
      </group>

      <OrbitControls
        enablePan={false}
        minPolarAngle={Math.PI / 3}
        maxPolarAngle={Math.PI / 1.8}
        minDistance={2.6}
        maxDistance={6}
      />
    </>
  );
}
