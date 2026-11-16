import { useEffect, useMemo, useRef, useState } from 'react';
import PoseViewer from './PoseViewer';
import { processVideo } from '../pose';
import { assignTracks, selectTrack } from '../poseTracking';
import { filterFrames, commonMask, jitter, reliableJoint, finiteJoint } from '../poseFilter';
import { frameAtTime } from '../poseSampling';
import { computeMetrics, metricRows } from '../metrics';
const API = 'http://localhost:8000';
const fmt = (n, digits = 1) => Number.isFinite(n) ? n.toFixed(digits) : '—';

export default function Technique() {
  const [capture, setCapture] = useState(null);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(0.5);
  const [fps, setFps] = useState(30);
  const [mode, setMode] = useState('smoothed');
  const [hand, setHand] = useState('right');
  const [stroke, setStroke] = useState('serve');
  const [analysis, setAnalysis] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const file = useRef(null), job = useRef(0), request = useRef(0);
  const processingController = useRef(null), analysisController = useRef(null);
  const playhead = useRef(0);
  const raw = useMemo(() => capture ? selectTrack(capture, selected) : [], [capture, selected]);
  const filtered = useMemo(() => filterFrames(raw), [raw]);
  const frames = mode === 'raw' ? raw : filtered.smoothed;
  const metrics = useMemo(() => computeMetrics(filtered.smoothed, hand, stroke), [filtered.smoothed, hand, stroke]);
  const rawMetrics = useMemo(() => computeMetrics(raw, hand, stroke), [raw, hand, stroke]);
  const comparison = useMemo(() => {
    const mask = commonMask([raw, filtered.smoothed]);
    return [jitter(raw, mask), jitter(filtered.smoothed, mask)];
  }, [raw, filtered.smoothed]);

  function invalidateAnalysis() {
    request.current++; analysisController.current?.abort();
    setAnalysis(''); setAnalyzing(false);
  }
  function choose(setter, value) { invalidateAnalysis(); setter(value); }
  async function start(nextFile, sampling = fps) {
    file.current = nextFile;
    const id = ++job.current;
    processingController.current?.abort();
    const controller = new AbortController(); processingController.current = controller;
    invalidateAnalysis(); setCapture(null); setSelected(null); setPlaying(false); setIdx(0); playhead.current = 0;
    setStatus('processing'); setError(''); setProgress(0);
    try {
      const result = await processVideo(nextFile, { fps: sampling, signal: controller.signal,
        onProgress: value => { if (job.current === id) setProgress(value); } });
      if (job.current !== id) return;
      const tracked = assignTracks(result);
      playhead.current = tracked.samples[0]?.t ?? 0;
      setCapture(tracked); setSelected(tracked.selectedId); setStatus('ready');
    } catch (err) {
      if (job.current !== id) return;
      setStatus(err.name === 'AbortError' ? 'cancelled' : 'error'); setError(err.name === 'AbortError' ? '' : err.message);
    }
  }
  function cancel() {
    job.current++; processingController.current?.abort(); invalidateAnalysis(); setStatus('cancelled');
  }
  useEffect(() => () => {
    job.current++; request.current++;
    processingController.current?.abort(); analysisController.current?.abort();
  }, []);

  async function analyze() {
    if (!metrics?.canAnalyze) return;
    const id = ++request.current, controller = new AbortController();
    analysisController.current?.abort(); analysisController.current = controller;
    setAnalyzing(true); setAnalysis('');
    try {
      const response = await fetch(`${API}/analyze-technique`, { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stroke, hand, metrics }) });
      if (!response.ok) throw new Error('Analysis failed');
      const data = await response.json();
      if (request.current !== id) return;
      setAnalysis(data.analysis || '—');
      if (Number.isInteger(metrics.contactIndex) && frames[metrics.contactIndex]) {
        setPlaying(false); setIdx(metrics.contactIndex); playhead.current = frames[metrics.contactIndex].t;
      }
    } catch (err) {
      if (request.current === id && err.name !== 'AbortError') setAnalysis('Не удалось получить разбор. Проверь подключение к серверу.');
    } finally { if (request.current === id) setAnalyzing(false); }
  }

  useEffect(() => {
    if (!playing || !frames.length) return;
    let raf, previous = performance.now();
    const tick = now => {
      playhead.current += (now - previous) / 1000 * speed; previous = now;
      const end = capture.meta.duration;
      if (playhead.current >= end) { playhead.current = frames.at(-1).t; setIdx(frames.length - 1); setPlaying(false); return; }
      setIdx(frameAtTime(frames, playhead.current));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, frames, speed, capture]);

  const pose = frames[idx];
  const hasPose = pose?.joints?.some((p, j) => finiteJoint(p) && (pose.provenance?.[j] === 'interpolated' || reliableJoint(p)));
  const track = capture?.tracks.find(t => t.id === selected);
  return <div className="tech">
    <div className="tech-body">
      <div className="tech-stage">
        <PoseViewer pose={pose} />
        {(!hasPose || status === 'processing') && <div className="tech-overlay" role="status">
          {status === 'processing' ? <><p>Анализирую движение… {Math.round(progress * 100)}%</p>
            <progress value={progress} max={1} /><p>Первый раз загружается heavy-модель (~30 МБ).</p></>
            : status === 'error' ? <p>{error}</p>
            : status === 'cancelled' ? <p>Обработка отменена. Можно выбрать другое видео.</p>
            : capture ? <p>Нет достоверной позы</p>
            : <p>Загрузи видео удара: всё тело в кадре, сбоку, хорошее освещение.<br />Видео обрабатывается локально в браузере.</p>}
        </div>}
      </div>
      {capture && <aside className="tech-panel">
        <div className="tech-selectors">
          <select aria-label="Ударная рука" value={hand} onChange={e => choose(setHand, e.target.value)}><option value="right">Правша</option><option value="left">Левша</option></select>
          <select aria-label="Удар" value={stroke} onChange={e => choose(setStroke, e.target.value)}><option value="serve">Подача</option><option value="forehand">Форхенд</option><option value="backhand">Бэкхенд</option></select>
          <select aria-label="Игрок" value={selected ?? ''} onChange={e => choose(setSelected, +e.target.value)} disabled={!capture.tracks.length}>
            {!capture.tracks.length && <option value="">Игрок не найден</option>}
            {capture.tracks.map(t => <option key={t.id} value={t.id}>Игрок {t.id} · {Math.round(t.coverage * 100)}% времени</option>)}
          </select>
          <select aria-label="Вид скелета" value={mode} onChange={e => choose(setMode, e.target.value)}><option value="smoothed">Сглаженный</option><option value="raw">Сырой</option></select>
        </div>
        <p className="tech-hint">Метрики по сглаженным данным. Контакт — оценка по кисти.</p>
        {track?.coverage < 0.3 && <p className="tech-hint">Низкое покрытие выбранного игрока.</p>}
        <div className="tech-metrics">{metricRows(metrics).map(r => <div className="tech-metric" key={r.k}><span className="mk">{r.k}</span><span className="mv">{r.v}</span><span className="mh">{r.ideal}</span></div>)}</div>
        <p className="tech-hint">Сырой → сглаженный:<br />Jitter {fmt(comparison[0].rmsAcceleration)} → {fmt(comparison[1].rmsAcceleration)} м/медиа-с²<br />
          Контакт {fmt(rawMetrics?.contactT, 2)} → {fmt(metrics?.contactT, 2)} с<br />Плечи {fmt(rawMetrics?.shoulderTurnDeg, 0)} → {fmt(metrics?.shoulderTurnDeg, 0)}°</p>
        <p className="tech-hint">{fmt(capture.meta.effectiveFps)} {capture.meta.uniqueDecoded == null ? 'запросов/с' : 'уник. семплов/с'} · {fmt(capture.meta.duration)} с<br />
          {capture.meta.timing === 'decoded' ? 'Время по декодированным кадрам' : 'Приблизительное время; частота исходника неизвестна'}
          {capture.meta.adaptive && ' · детализация снижена по времени обработки'}<br />
          Восстановлено суставов: {filtered.stats.interpolated}; выбросов: {filtered.stats.outliers}; пропусков: {filtered.stats.missing}.<br />
          Скорости по времени видео; коэффициент slow-mo неизвестен.</p>
        {!metrics?.canAnalyze && <p className="tech-hint">Недостаточно надёжных данных для контакта и ударной руки.</p>}
        <button className="tech-analyze" onClick={analyze} disabled={analyzing || !metrics?.canAnalyze}>{analyzing ? 'Разбираю…' : 'Разобрать технику'}</button>
        {analysis && <div className="tech-analysis">{analysis}</div>}
      </aside>}
    </div>
    <div className="tech-bar">
      <label className="tech-upload">Загрузить видео<input aria-label="Видео удара" type="file" accept="video/*" hidden onChange={e => { const next = e.target.files?.[0]; e.target.value = ''; if (next) start(next); }} /></label>
      <select aria-label="Детализация" value={fps} onChange={e => { const next = +e.target.value; setFps(next); if (file.current) start(file.current, next); }}><option value={30}>30 семплов/с</option><option value={60}>60 семплов/с</option></select>
      {status === 'processing' && <button className="tech-btn" onClick={cancel}>Отмена</button>}
      {!!frames.length && <>
        <button className="tech-btn" aria-label={playing ? 'Пауза' : 'Воспроизвести'} onClick={() => { if (idx === frames.length - 1) { playhead.current = frames[0].t; setIdx(0); } setPlaying(p => !p); }}>{playing ? '⏸' : '▶'}</button>
        <input aria-label="Время видео" className="tech-range" type="range" min={frames[0].t} max={frames.at(-1).t} step={0.001} value={pose?.t ?? 0} onChange={e => { setPlaying(false); playhead.current = +e.target.value; setIdx(frameAtTime(frames, +e.target.value)); }} />
        <span className="tech-count">{fmt(pose?.t, 2)} с · {idx + 1}/{frames.length}</span>
        <select aria-label="Скорость" className="tech-speed" value={speed} onChange={e => setSpeed(+e.target.value)}>{[0.15, 0.25, 0.5, 1].map(s => <option key={s} value={s}>{s}×</option>)}</select>
      </>}
    </div>
  </div>;
}
