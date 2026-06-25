// Renders ONE pose frame as a rotatable 3D skeleton (joints + bones).
// MediaPipe world landmarks are metres with origin at mid-hip; y points DOWN and z toward
// the camera, so we flip y/z to stand the figure up in Three's y-up world.
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Line, Grid } from "@react-three/drei";
import { POSE_CONNECTIONS } from "../pose";

const toVec = (j) => [j.x, -j.y, -j.z];

function Skeleton({ pose }) {
  if (!pose) return null;
  const pts = pose.joints.map(toVec);
  return (
    <group>
      {pts.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.022, 12, 12]} />
          <meshStandardMaterial color="#c8ff00" emissive="#3a4a00" />
        </mesh>
      ))}
      {POSE_CONNECTIONS.map((c, i) => {
        const a = pts[c.start];
        const b = pts[c.end];
        if (!a || !b) return null;
        return <Line key={i} points={[a, b]} color="#9fe000" lineWidth={3} />;
      })}
    </group>
  );
}

export default function PoseViewer({ pose }) {
  return (
    <Canvas camera={{ position: [0, 0.1, 2.6], fov: 50 }} dpr={[1, 2]}>
      <color attach="background" args={["#0b0f14"]} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[3, 5, 4]} intensity={1.1} />
      <Skeleton pose={pose} />
      <Grid
        args={[8, 8]}
        position={[0, -1, 0]}
        cellColor="#1d2630"
        sectionColor="#2a3a18"
        infiniteGrid
        fadeDistance={14}
      />
      <OrbitControls enablePan={false} minDistance={1} maxDistance={6} target={[0, 0, 0]} />
    </Canvas>
  );
}
