// DEMO.LAB — technique player: pick a move, pause, slow-mo, scrub, frame-step,
// orbit the frozen coach with the mouse. Pilot runs on the Mixamo base clips;
// bought tennis mocap drops straight into DEMO_MOVES.
import { useEffect, useRef, useState } from "react";
import { demo, demoCmd, DEMO_MOVES, GRIPS } from "../demoBus";

const SPEEDS = [0.1, 0.25, 0.5, 1];

export default function DemoLab() {
  const [, tick] = useState(0);
  const dragging = useRef(false);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, []);

  const btn = { padding: "2px 8px", fontSize: 11 };
  const frac = demo.dur > 0 ? demo.t / demo.dur : 0;

  return (
    <div className="mod">
      <span className="cor tl" /><span className="cor br" />
      <div className="mhead">
        Demo Lab <span className="chip">{demo.active ? "LIVE" : "PILOT"}</span>
      </div>

      {/* GRIP.CAM — camera flies to the racquet fist; works idle or mid-demo */}
      <div className={"srow" + (demo.gripCam ? " on" : "")} style={{ cursor: "pointer" }}
        onClick={() => demoCmd("gripcam", !demo.gripCam)}>
        <span className="num">{demo.gripCam ? "✕" : "◉"}</span>
        <span className="nm">{demo.gripCam ? "GRIP.CAM — вернуть камеру" : "GRIP.CAM — показать хват"}</span>
        <span className="dur">zoom</span>
      </div>

      {/* live grip switcher: flip between real tennis grips while inspecting */}
      {demo.gripCam && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0 8px" }}>
          {Object.entries(GRIPS).map(([key, g]) => (
            <button key={key} className={"tab" + (demo.grip === key ? " on" : "")}
              style={{ padding: "2px 8px", fontSize: 11 }} title={g.hint}
              onClick={() => demoCmd("grip", key)}>
              {g.label}
            </button>
          ))}
          <span className="dim" style={{ fontSize: 10, alignSelf: "center" }}>
            {GRIPS[demo.grip]?.hint}
          </span>
        </div>
      )}

      {DEMO_MOVES.map(([label, key]) => (
        <div key={key}
          className={"srow" + (demo.active === key ? " on" : "")}
          style={{ cursor: "pointer" }}
          onClick={() => demoCmd(demo.active === key ? "exit" : "start", key)}>
          <span className="num">{demo.active === key ? "▶" : "·"}</span>
          <span className="nm">{label}</span>
        </div>
      ))}

      {demo.active && (
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
          <input type="range" min="0" max="1000" value={Math.round(frac * 1000)}
            style={{ width: "100%", accentColor: "#c8ff00" }}
            onPointerDown={() => { dragging.current = true; }}
            onPointerUp={() => { dragging.current = false; }}
            onChange={(e) => demoCmd("scrub", e.target.value / 1000)} />
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <button className="tab" style={btn}
              onClick={() => demoCmd(demo.paused ? "play" : "pause")}>
              {demo.paused ? "▶ PLAY" : "❚❚ PAUSE"}
            </button>
            <button className="tab" style={btn} onClick={() => demoCmd("step", -1)}>−1f</button>
            <button className="tab" style={btn} onClick={() => demoCmd("step", 1)}>+1f</button>
            {SPEEDS.map((s) => (
              <button key={s} className={"tab" + (demo.speed === s ? " on" : "")} style={btn}
                onClick={() => demoCmd("speed", s)}>{s}×</button>
            ))}
            <span className="dim" style={{ fontSize: 11, marginLeft: "auto" }}>
              {demo.t.toFixed(2)}s / {demo.dur.toFixed(2)}s
            </span>
            <button className="tab" style={btn} onClick={() => demoCmd("exit")}>✕</button>
          </div>
          <div className="dim" style={{ fontSize: 10 }}>drag the 3D view to orbit while paused</div>
        </div>
      )}
    </div>
  );
}
