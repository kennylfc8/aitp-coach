// Terminal Pro right panel: PLAYER.RATING / TODAY.SESSION / DEMO.LAB / WEAK.ZONES / SKILL.MATRIX.
// Real data from GET /player (deterministic, no LLM). ASCII meters per the handoff spec.
import { useEffect, useState } from "react";
import DemoLab from "./DemoLab";

const API = "http://localhost:8000";

function Meter({ frac, total = 16, red }) {
  const f = Math.round(Math.max(0, Math.min(1, frac || 0)) * total);
  return (
    <span className="meter">
      <span className={"f" + (red ? " red" : "")}>{"█".repeat(f)}</span>
      <span className="e">{"░".repeat(total - f)}</span>
    </span>
  );
}

export default function Dashboard({ data }) {
  const [fetched, setFetched] = useState(null);
  useEffect(() => {
    if (!data) fetch(`${API}/player`).then((r) => r.json()).then(setFetched).catch(() => {});
  }, [data]);
  const d = data || fetched;

  if (!d) {
    return (
      <aside className="panel">
        <div className="mod"><div className="mhead">&gt; PLAYER.RATING</div><div className="dim">loading…</div></div>
      </aside>
    );
  }

  const total = d.today_plan.reduce((s, x) => s + x.minutes, 0);

  return (
    <aside className="panel">
      {/* PLAYER.RATING */}
      <div className="mod">
        <span className="cor tl" /><span className="cor br" />
        <div className="mhead">&gt; PLAYER.RATING</div>
        <div className="rating">
          <span className="dim" style={{ paddingBottom: 6 }}>NTRP</span>
          <span className="now">{(d.utr.value ?? 0).toFixed(1)}</span>
          <span className="arr">──▸</span>
          <span className="tgt">{(d.utr.target ?? 0).toFixed(1)}</span>
        </div>
        <div className="rgrid">
          <div>
            <div className="k">CONFIDENCE</div>
            <Meter frac={(d.utr.confidence ?? 0) / 100} />
            <span className="v" style={{ marginLeft: 6 }}>{d.utr.confidence}%</span>
          </div>
          <div><div className="k">DEADLINE</div><span className="v">{d.utr.weeks_left ?? "—"}</span> <span className="dim">weeks</span></div>
          <div><div className="k">FOCUS</div><span className="v red">{(d.utr.focus || "").toLowerCase()}</span></div>
        </div>
      </div>

      {/* TODAY.SESSION */}
      <div className="mod session">
        <span className="cor tl" /><span className="cor br" />
        <div className="mhead">&gt; TODAY.SESSION <span className="chip">{total}m</span></div>
        {d.today_plan.map((x, i) => (
          <div className={"srow" + (i === 0 ? " on" : "")} key={i}>
            <span className="num">{String(i + 1).padStart(2, "0")}</span>
            <span className="nm">{x.title}</span>
            <span className="dur">{x.minutes}m</span>
          </div>
        ))}
      </div>

      {/* DEMO.LAB — technique player */}
      <DemoLab />

      {/* WEAK.ZONES */}
      <div className="mod weak">
        <span className="cor tl" /><span className="cor br" />
        <div className="mhead">&gt; WEAK.ZONES</div>
        <div className="wtags">
          {d.weaknesses.map((w, i) => <span className="wtag" key={i}>! {w.label}</span>)}
        </div>
      </div>

      {/* SKILL.MATRIX */}
      <div className="mod">
        <span className="cor tl" /><span className="cor br" />
        <div className="mhead">&gt; SKILL.MATRIX</div>
        {d.skills.map((s, i) => {
          const red = s.raw < 5;
          return (
            <div className="skill" key={i}>
              <span className={"nm" + (red ? " red" : "")}>{s.label}</span>
              <span className="m"><Meter frac={s.v} red={red} /></span>
              <span className={"val" + (red ? " red" : "")}>{s.raw.toFixed(1)}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
