// Center stage: the 3D coach (Avaturn T2 — live face: lipsync + blink; ?char=ch28 legacy).
// R3F, lazy chunk.
import { lazy, Suspense } from "react";

const CoachChar3D = lazy(() => import("./CoachChar3D"));
const BARS = Array.from({ length: 52 });
const IS_CH28 = typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("char") === "ch28";
const COACH_TAG = IS_CH28 ? "CH28.PRO" : "AVATURN.T2";
const RIG_TAG = IS_CH28 ? "body+fingers" : "body+fingers+face";

export default function CoachViewport({ transcript, speaking, recording, theme }) {
  return (
    <div className="viewport">
      <span className="cor tl" /><span className="cor tr" /><span className="cor bl" /><span className="cor br" />

      <div className="vstatus">
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="recdot" /> <span className="white">Live</span>
          <span className="agent">· {COACH_TAG} · {RIG_TAG}</span>
          {speaking && <span className="lime">speaking</span>}
        </span>
        <span className="agent">Coach Agent v3.1</span>
      </div>

      <div className="stage">
        <Suspense fallback={<div className="dim" style={{ fontSize: 12 }}>booting coach…</div>}>
          <CoachChar3D speaking={speaking} transcript={transcript} theme={theme} />
        </Suspense>
        <span className="reticle bl">drag to orbit</span>
      </div>

      <div className="transcript">
        <div className="msg">
          <span className="who">Coach</span> {transcript}
          <span className="curs" />
        </div>
        <div className="audio">
          <span className="lbl">AUDIO</span>
          <div className={"wave" + (recording || speaking ? " live" : "")}>
            {BARS.map((_, i) => (
              <i key={i} style={{
                animationDelay: `${(i % 13) * 0.07}s`,
                animationDuration: `${0.6 + (i % 7) * 0.1}s`,
                opacity: recording ? 1 : undefined,
              }} />
            ))}
          </div>
          <span className="tcode">00:14 / 00:22</span>
        </div>
      </div>
    </div>
  );
}
