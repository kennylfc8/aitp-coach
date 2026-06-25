// Step 5: real data from the coaching engine via the proxy (GET /player).
// Deterministic payload (no LLM) → instant. Falls back to a skeleton while loading.
import { useEffect, useState } from "react";

const API = "http://localhost:8000";

export default function Dashboard() {
  const [d, setD] = useState(null);

  useEffect(() => {
    fetch(`${API}/player`)
      .then((r) => r.json())
      .then(setD)
      .catch(() => {});
  }, []);

  if (!d) {
    return (
      <aside className="panel">
        <div className="panel-head">
          <div className="utr">UTR …</div>
          <div className="sub">загружаю профиль…</div>
        </div>
      </aside>
    );
  }

  const weeks = d.utr.weeks_left != null ? `${d.utr.weeks_left} нед · ` : "";

  return (
    <aside className="panel">
      <div className="panel-head">
        <div className="utr">UTR {d.utr.value ?? "—"}</div>
        <div className="sub">
          цель {d.utr.target ?? "—"} · {weeks}🔥 {d.streak} дн
        </div>
      </div>

      <section>
        <h3>План на сегодня</h3>
        <ul className="drills">
          {d.today_plan.map((x, i) => (
            <li key={i}><span>{x.title}</span><em>{x.minutes} мин</em></li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Слабые зоны</h3>
        <div className="tags">
          {d.weaknesses.length
            ? d.weaknesses.map((w, i) => <span className="tag" key={i}>{w.label}</span>)
            : <span className="sub">—</span>}
        </div>
      </section>

      <section>
        <h3>Прогресс</h3>
        <div className="bars">
          {d.skills.map((b, i) => (
            <div className="bar" key={i}>
              <span>{b.label}</span>
              <div className="track"><div className="fill" style={{ width: `${b.v * 100}%` }} /></div>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}
