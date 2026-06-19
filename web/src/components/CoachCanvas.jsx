import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import Experience from "./Experience";

export default function CoachCanvas() {
  return (
    <Canvas shadows camera={{ position: [0, 0.3, 4], fov: 42 }}>
      <Suspense fallback={null}>
        <Experience />
      </Suspense>
    </Canvas>
  );
}
