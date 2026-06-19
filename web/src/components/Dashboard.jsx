// Mock tennis panel (step 1). Step 5 wires real data from the coaching engine.
const drills = [
  { t: "Разножка + подход к мячу", m: "15 мин" },
  { t: "Бэкхенд кросс (корзина)", m: "20 мин" },
  { t: "Подача: подброс + кик", m: "20 мин" },
  { t: "Игровые очки", m: "15 мин" },
];

const bars = [
  { label: "Форхенд", v: 0.8 },
  { label: "Бэкхенд", v: 0.5 },
  { label: "Подача", v: 0.55 },
  { label: "Движение", v: 0.7 },
];

export default function Dashboard() {
  return (
    <aside className="panel">
      <div className="panel-head">
        <div className="utr">UTR 6.7</div>
        <div className="sub">цель 7.5 · 12 нед · 🔥 14 дней</div>
      </div>

      <section>
        <h3>План на сегодня</h3>
        <ul className="drills">
          {drills.map((d, i) => (
            <li key={i}><span>{d.t}</span><em>{d.m}</em></li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Слабые зоны</h3>
        <div className="tags">
          <span className="tag">Бэкхенд</span>
          <span className="tag">Стабильность</span>
          <span className="tag">Подача %</span>
        </div>
      </section>

      <section>
        <h3>Прогресс</h3>
        <div className="bars">
          {bars.map((b, i) => (
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
