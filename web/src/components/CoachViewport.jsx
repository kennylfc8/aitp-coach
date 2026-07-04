// Center stage: TOON ATHLETE — stylized game-style player with readable anatomy
// (shoulders/elbows/knees), driven by our real mocap serve. R3F, lazy chunk.
import { lazy, Suspense } from "react";

const CoachChar3D = lazy(() => import("./CoachChar3D"));
const BARS = Array.from({ length: 52 });

export default function CoachViewport({ transcript, speaking, recording }) {
  return (
    <div className="viewport">
      <span className="cor tl" /><span className="cor tr" /><span className="cor bl" /><span className="cor br" />

      <div className="vstatus">
        <span>
          &gt; render: <span className="grn">live</span> · coach: <span className="lime">CH28.PRO</span> · rig:{" "}
          <span className="white">full+fingers</span> · lipsync: <span className="lime">{speaking ? "on" : "idle"}</span>
        </span>
        <span className="agent">COACH.AGENT — v3.1 █</span>
      </div>

      <div className="stage">
        <Suspense fallback={<div className="dim" style={{ fontSize: 12 }}>booting coach…</div>}>
          <CoachChar3D speaking={speaking} transcript={transcript} />
        </Suspense>
        <span className="reticle tl">+</span>
        <span className="reticle tr">+</span>
        <span className="reticle bl">SERVE.LOOP · drag to orbit ▌</span>
      </div>

      <div className="transcript">
        <div className="msg">
          <span className="who">&gt; coach:</span> {transcript}
          <span className="curs" />
        </div>
        <div className="audio">
          <span className="lbl">AUDIO ▌</span>
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
