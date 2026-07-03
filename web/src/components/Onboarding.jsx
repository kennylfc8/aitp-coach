import { useState } from "react";
import { LEVELS, MODES, STROKES, buildProfile, computeNtrp, computeConf } from "../onboarding";

export default function Onboarding({ onDone }) {
  const [i, setI] = useState(0);
  const [name, setName] = useState("");
  const [mode, setMode] = useState("standard");
  const [level, setLevel] = useState("3.5");
  const [ratings, setRatings] = useState({});      // key -> number (rated) | undefined (skip)
  const [target, setTarget] = useState(null);
  const [weeks, setWeeks] = useState(12);

  // QUICK self-picks a level; DETERMINE/DETAILED compute NTRP from strokes (no level step).
  const steps = mode === "quick"
    ? ["name", "mode", "level", "goal"]
    : ["name", "mode", "strokes", "goal"];
  const idx = Math.min(i, steps.length - 1);
  const cur = steps[idx];
  const shown = mode === "deep" ? STROKES : STROKES.filter((s) => s.core);

  const ntrp = computeNtrp({ mode, level, ratings });
  const conf = computeConf({ mode, ratings });
  const ratedCount = STROKES.filter((s) => typeof ratings[s.key] === "number").length;
  const tgt = target ?? Math.min(7, ntrp + 0.5);
  const setRate = (k, v) => setRatings((r) => ({ ...r, [k]: v }));
  const finish = () => onDone(buildProfile({ name, mode, level, ratings, target: tgt, weeks }));

  return (
    <div className="onb">
      <div className="onb-box">
        <span className="cor tl" /><span className="cor tr" /><span className="cor bl" /><span className="cor br" />
        <div className="onb-head">
          <span className="brand"><span className="bar">▌</span>ACE<span className="sl">//</span>COACH</span>
          <span className="onb-prog">INIT · STEP {idx + 1}/{steps.length}</span>
        </div>

        {cur === "name" && (
          <div className="onb-step">
            <div className="onb-q">&gt; IDENTIFY_PLAYER</div>
            <p className="onb-hint">Твой позывной. Настроим под тебя терминал.</p>
            <input className="onb-input" autoFocus value={name} placeholder="enter name…"
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && setI(i + 1)} />
          </div>
        )}

        {cur === "mode" && (
          <div className="onb-step">
            <div className="onb-q">&gt; ASSESSMENT_DEPTH</div>
            <p className="onb-hint">Насколько точно меряем NTRP? Чем глубже — тем выше уверенность.</p>
            <div className="onb-levels">
              {MODES.map((m) => (
                <button key={m.key} className={"onb-level" + (mode === m.key ? " on" : "")} onClick={() => setMode(m.key)}>
                  <span className="lt"><b>{m.label}</b><span className="ntrp">{m.qs} · conf ~{m.conf}%</span></span>
                  <span className="d">{m.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {cur === "level" && (
          <div className="onb-step">
            <div className="onb-q">&gt; SELF-RATE: LEVEL</div>
            <p className="onb-hint">Выбери описание, которое ближе всего к тебе (официальный NTRP).</p>
            <div className="onb-levels onb-scroll">
              {LEVELS.map((l) => (
                <button key={l.key} className={"onb-level" + (level === l.key ? " on" : "")} onClick={() => setLevel(l.key)}>
                  <span className="lt"><b>NTRP {l.key}</b></span>
                  <span className="d">{l.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {cur === "strokes" && (
          <div className="onb-step">
            <div className="onb-q">&gt; SELF-RATE: STROKES</div>
            <p className="onb-hint">
              Отметь удары, которые знаешь, и оцени 1–10. Не уверен — оставь скип.
              Считаем по <b>слабому звену</b> (NTRP ≈ твой слабейший удар).
            </p>
            <div className="onb-live">РАСЧЁТНЫЙ NTRP: <b>{ratedCount ? ntrp.toFixed(1) : "—"}</b><span> · оценено {ratedCount} · conf ~{conf}%</span></div>
            <div className="onb-strokes onb-scroll">
              {shown.map((s) => {
                const rated = typeof ratings[s.key] === "number";
                return (
                  <div className={"onb-stroke" + (rated ? " on" : "")} key={s.key}>
                    <label className="chk">
                      <input type="checkbox" checked={rated}
                        onChange={(e) => setRate(s.key, e.target.checked ? 6 : undefined)} />
                      <span className="nm">{s.label}</span>
                    </label>
                    {rated ? (
                      <>
                        <input type="range" min="1" max="10" value={ratings[s.key]}
                          onChange={(e) => setRate(s.key, +e.target.value)} />
                        <span className="v">{ratings[s.key]}</span>
                      </>
                    ) : <span className="skip">скип</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {cur === "goal" && (
          <div className="onb-step">
            <div className="onb-q">&gt; SET_GOAL</div>
            <p className="onb-hint">
              Расчётный NTRP <b className="lime">{ntrp.toFixed(1)}</b> · уверенность ~{conf}%
              {ratedCount ? ` · оценено ударов: ${ratedCount}` : ""}. Поставь цель (любую) и срок.
            </p>
            <div className="onb-goal">
              <div className="onb-ntrp">NTRP <b>{ntrp.toFixed(1)}</b> ──▸ <span className="tgt">{tgt.toFixed(1)}</span></div>
              <div className="onb-weeks">
                <span style={{ width: 70 }}>TARGET</span>
                <input type="range" min="1.5" max="7" step="0.5" value={tgt} onChange={(e) => setTarget(+e.target.value)} />
                <b>{tgt.toFixed(1)} NTRP</b>
              </div>
              <div className="onb-weeks">
                <span style={{ width: 70 }}>DEADLINE</span>
                <input type="range" min="4" max="52" step="2" value={weeks} onChange={(e) => setWeeks(+e.target.value)} />
                <b>{weeks} weeks</b>
              </div>
            </div>
          </div>
        )}

        <div className="onb-nav">
          {i > 0 ? <button className="onb-btn ghost" onClick={() => setI(i - 1)}>‹ BACK</button> : <span />}
          {idx < steps.length - 1
            ? <button className="onb-btn" onClick={() => setI(i + 1)} disabled={cur === "name" && !name.trim()}>NEXT ›</button>
            : <button className="onb-btn go" onClick={finish}>▸ ENTER TERMINAL</button>}
        </div>
      </div>
    </div>
  );
}
