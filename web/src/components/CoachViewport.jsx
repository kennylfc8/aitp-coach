// Center stage: SUMI-E ink coach (our real mocap serve, brush-drawn) + status + transcript.
import InkCoach from "./InkCoach";

const BARS = Array.from({ length: 52 });

export default function CoachViewport({ transcript, speaking, recording }) {
  return (
    <div className="viewport">
      <span className="cor tl" /><span className="cor tr" /><span className="cor bl" /><span className="cor br" />

      <div className="vstatus">
        <span>
          &gt; render: <span className="grn">live</span> · style: <span className="lime">SUMI-E</span> · lipsync:{" "}
          <span className="lime">{speaking ? "on" : "idle"}</span>
        </span>
        <span className="agent">COACH.AGENT — v3.0 █</span>
      </div>

      <div className="stage paper">
        <InkCoach speaking={speaking} />
        <span className="pret tl">+</span>
        <span className="pret tr">+</span>
        <span className="pret bl">間 · SERVE.LOOP ▌</span>
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
