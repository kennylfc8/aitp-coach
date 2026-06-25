// 3D technique analysis (MVP): upload a slow-mo (240fps) stroke -> in-browser pose estimation
// -> rotatable 3D skeleton with a timeline + slow-mo playback. All client-side, no upload anywhere.
import { useEffect, useRef, useState } from "react";
import PoseViewer from "./PoseViewer";
import { processVideo } from "../pose";

export default function Technique() {
  const [frames, setFrames] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | processing | ready | error
  const [progress, setProgress] = useState(0);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(0.5);
  const fileName = useRef("");

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    fileName.current = file.name;
    setStatus("processing");
    setProgress(0);
    setFrames(null);
    setPlaying(false);
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

  // Playback: advance frames on an interval; re-created when speed/frames change.
  useEffect(() => {
    if (!playing || !frames) return;
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % frames.length);
    }, (1000 / 30) / speed);
    return () => clearInterval(id);
  }, [playing, frames, speed]);

  const pose = frames ? frames[idx] : null;

  return (
    <div className="tech">
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
                  240 fps, сбоку, всё тело в кадре. Построю <b>3D-скелет</b>, который можно
                  крутить мышкой и листать покадрово. Видео никуда не загружается — всё в браузере.
                </p>
              </>
            )}
          </div>
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
