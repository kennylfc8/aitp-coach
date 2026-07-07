// Stylized court corner: glowing baseline/service lines under the coach and a
// net silhouette deep behind him — kills the "floating in a void" look while
// keeping the terminal aesthetic (lime on near-black, fog does the fading).
import { useMemo } from "react";
import * as THREE from "three";

// Scene mood presets, switchable via ?theme=neon|clay|blue.
// neon — terminal lime night (default); clay — Roland-Garros sunset terracotta;
// blue — US-Open hard court under floodlights.
export const THEMES = {
  neon: {
    bg: "#020a06", hemiGround: "#1a241c", hemiI: 1.5, accent: "#c8ff00", accentI: 14,
    fill2: "#cfe0f0", court: "rgba(16,62,40,0.55)", line: "rgba(216,255,232,0.9)",
    glow: "rgba(200,255,0,0.9)", gridCell: "#12301d", gridSec: "#1f4a2c",
    rim: "#c8ff00", rimI: 10, back: "#9fd4ff", backI: 0.7,
    disc: ["rgba(120,240,140,.45)", "rgba(60,160,90,.14)"],
  },
  clay: {
    bg: "#170b06", hemiGround: "#2a1a10", hemiI: 1.35, accent: "#ff9a3d", accentI: 12,
    fill2: "#ffd9b8", court: "rgba(158,74,40,0.6)", line: "rgba(255,243,228,0.95)",
    glow: "rgba(255,150,60,0.8)", gridCell: "#2a170c", gridSec: "#41240f",
    rim: "#ff9a3d", rimI: 11, back: "#ffc890", backI: 0.8,
    disc: ["rgba(255,170,90,.4)", "rgba(180,90,40,.14)"],
  },
  blue: {
    bg: "#030711", hemiGround: "#101a2e", hemiI: 1.5, accent: "#3f9fff", accentI: 13,
    fill2: "#cfe4ff", court: "rgba(24,64,132,0.55)", line: "rgba(225,242,255,0.92)",
    glow: "rgba(90,170,255,0.9)", gridCell: "#0d1830", gridSec: "#17274b",
    rim: "#4da6ff", rimI: 11, back: "#9fd4ff", backI: 0.8,
    disc: ["rgba(110,180,255,.42)", "rgba(50,110,200,.15)"],
  },
};
function courtLinesTexture(THEME) {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const g = c.getContext("2d");
  g.clearRect(0, 0, 1024, 1024);
  // faint court fill so the lines sit on "surface", not on void
  g.fillStyle = THEME.court;
  g.fillRect(112, 0, 800, 1024);
  const line = (x0, y0, x1, y1, w, glow) => {
    g.strokeStyle = THEME.line;
    g.lineWidth = w;
    g.shadowColor = THEME.glow;
    g.shadowBlur = glow;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  };
  // texture maps to a 10x10m plane; coach stands near the baseline (v≈0.82)
  // court runs AWAY from the camera: baseline -> service line -> net edge
  const L = 112, R = 912, BASE = 840, SERV = 430, MID = (L + R) / 2;
  line(L, BASE, R, BASE, 10, 26);          // baseline
  line(L, 40, L, BASE, 7, 18);             // left sideline (to the far edge)
  line(R, 40, R, BASE, 7, 18);             // right sideline
  line(L, SERV, R, SERV, 6, 16);           // service line
  line(MID, SERV, MID, 40, 6, 14);         // center service line (to the net)
  line(MID, BASE, MID, BASE - 26, 8, 18);  // center mark
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  return tex;
}

function netTexture() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 128;
  const g = c.getContext("2d");
  g.strokeStyle = "rgba(180, 230, 200, 0.5)";
  g.lineWidth = 1;
  for (let x = 0; x <= 512; x += 10) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
  for (let y = 0; y <= 128; y += 10) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  // white tape on top
  g.fillStyle = "rgba(225, 245, 235, 0.95)";
  g.fillRect(0, 0, 512, 12);
  return new THREE.CanvasTexture(c);
}

export default function CourtEnv({ theme }) {
  const THEME = THEMES[theme] || THEMES.neon;
  const lines = useMemo(() => courtLinesTexture(THEME), [theme]);
  const net = useMemo(netTexture, []);
  const postMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#182420", roughness: 0.6, metalness: 0.4 }), []);
  return (
    <group>
      {/* court lines: coach stands just behind the baseline, court recedes back */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, -3.1]}>
        <planeGeometry args={[10, 10]} />
        <meshBasicMaterial map={lines} transparent depthWrite={false} />
      </mesh>
      {/* net silhouette at the far end */}
      <group position={[0, 0, -7.2]}>
        <mesh position={[0, 0.5, 0]}>
          <planeGeometry args={[8.3, 0.95]} />
          <meshBasicMaterial map={net} transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        {[-4.2, 4.2].map((x) => (
          <mesh key={x} position={[x, 0.55, 0]} material={postMat}>
            <cylinderGeometry args={[0.035, 0.045, 1.1, 10]} />
          </mesh>
        ))}
      </group>
      {/* rim light: accent edge on the coach's silhouette from behind-left */}
      <pointLight position={[-1.6, 2.0, -2.6]} intensity={THEME.rimI} color={THEME.rim} distance={7} />
      <directionalLight position={[0, 2.5, -4]} intensity={THEME.backI} color={THEME.back} />
    </group>
  );
}
