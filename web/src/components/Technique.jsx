// 3D technique analysis: upload slow-mo (240fps) stroke -> in-browser pose -> rotatable 3D
// skeleton (Level A) + biomechanics metrics & Claude breakdown (Level B 1-3). All client-side
// except the Claude call; the video itself never leaves the browser.
import { useEffect, useRef, useState } from "react";
import PoseViewer from "./PoseViewer";
import { processVideo } from "../pose";
import { computeMetrics, metricRows } from "../metrics";

const API = "http://localhost:8000";

export default function Technique() {
  const [frames, setFrames] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | processing | ready | error
  const [progress, setProgress] = useState(0);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(0.5);

  const [hand, setHand] = useState("right");
  const [stroke, setStroke] = useState("forehand");
  const [metrics, setMetrics] = useState(null);
  const [analysis, setAnalysis] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const fileName = useRef("");

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    fileName.current = file.name;
    setStatus("processing");
    setProgress(0);
    setFrames(null);
    setPlaying(false);
    setMetrics(null);
    setAnalysis("");
    try {
      const fr = await processVideo(file, { onProgress: setProgress, fps: 30, maxFrames: 400 });
      if (!fr.length) {
        setStatus("error");
        return;
      }
      setFrames(fr);
      setIdx(0);
      setStatus("ready");
      setPlaying(true);
    } catch (err) {
      console.error("[technique]", err);
      setStatus("error");
    }
  }

  async function analyze() {
    if (!frames) return;
    const m = computeMetrics(frames, hand);
    setMetrics(m);
    setAnalyzing(true);
    setAnalysis("");
    try {
      const r = await fetch(`${API}/analyze-technique`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stroke, hand, metrics: m }),
      });
      const d = await r.json();
      setAnalysis(d.analysis || "—");
      if (m && Number.isInteger(m.contactIndex)) {
        setPlaying(false);
        setIdx(m.contactIndex); // park the 3D view on the detected contact frame
      }
    } catch {
      setAnalysis("⚠️ Не удалось получить разбор. Запущен ли сервер на :8000?");
    } finally {
      setAnalyzing(false);
    }
  }

  // Playback: advance frames on an interval; re-created when speed/frames change.
  useEffect(() => {
    if (!playing || !frames) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % frames.length), (1000 / 30) / speed);
    return () => clearInterval(id);
  }, [playing, frames, speed]);

  const pose = frames ? frames[idx] : null;
  const rows = metricRows(metrics);

  return (
    <div className="tech">
      <div className="tech-body">
        <div className="tech-stage">
          {pose ? (
            <PoseViewer pose={pose} />
          ) : (
            <div className="tech-empty">
              {status === "processing" ? (
                <>
                  <div className="tech-spinner">Анализирую движение… {Math.round(progress * 100)}%</div>
                  <div className="tech-progress"><div style={{ width: `${progress * 100}%` }} /></div>
                  <p className="tech-hint">Первый раз грузится модель (~10 МБ) — потом быстрее.</p>
                </>
              ) : status === "error" ? (
                <p className="tech-hint">
                  Не удалось распознать движение 😕<br />
                  Сними <b>сбоку</b>, всё тело в кадре, хорошее освещение, <b>240 fps</b>, один удар на ролик.
                </p>
              ) : (
                <>
                  <div className="tech-cta">🎾🎥 Загрузи слоу-мо своего удара</div>
                  <p className="tech-hint">
                    240 fps, сбоку, всё тело в кадре. Построю <b>3D-скелет</b> (крутится мышкой) и
                    разберу биомеханику. Видео никуда не загружается — всё в браузере.
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        {frames && (
          <aside className="tech-panel">
            <div className="tech-selectors">
              <select value={hand} onChange={(e) => setHand(e.target.value)}>
                <option value="right">Правша</option>
                <option value="left">Левша</option>
              </select>
              <select value={stroke} onChange={(e) => setStroke(e.target.value)}>
                <option value="serve">Подача</option>
                <option value="forehand">Форхенд</option>
                <option value="backhand">Бэкхенд</option>
              </select>
            </div>

            <button className="tech-analyze" onClick={analyze} disabled={analyzing}>
              {analyzing ? "Разбираю…" : "🧠 Разобрать технику"}
            </button>

            {rows.length > 0 && (
              <div className="tech-metrics">
                {rows.map((r, i) => (
                  <div className="tech-metric" key={i}>
                    <span className="mk">{r.k}</span>
                    <span className="mv">{r.v}</span>
                    <span className="mh">{r.ideal}</span>
                  </div>
                ))}
              </div>
            )}

            {analysis && <div className="tech-analysis">{analysis}</div>}
          </aside>
        )}
      </div>

      <div className="tech-bar">
        <label className="tech-upload">
          📹 {frames ? "Другое видео" : "Загрузить видео"}
          <input type="file" accept="video/*" onChange={onFile} hidden />
        </label>

        {frames && (
          <>
            <button className="tech-btn" onClick={() => setPlaying((p) => !p)}>
              {playing ? "⏸" : "▶"}
            </button>
            <input
              className="tech-range"
              type="range"
              min={0}
              max={frames.length - 1}
              value={idx}
              onChange={(e) => { setPlaying(false); setIdx(+e.target.value); }}
            />
            <span className="tech-count">{idx + 1}/{frames.length}</span>
            <select className="tech-speed" value={speed} onChange={(e) => setSpeed(+e.target.value)}>
              <option value={0.15}>0.15×</option>
              <option value={0.25}>0.25×</option>
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
            </select>
          </>
        )}
      </div>
    </div>
  );
}
