// Chat + voice brain, lifted out of the old Controls so the transcript (coach viewport)
// and the command line (bottom) can share one source of truth.
import { useState, useRef, useEffect } from "react";
import { playAudio, unlockAudio, audioContextState } from "./lipsync";

const API = "http://localhost:8000";
const SR = typeof window !== "undefined"
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : null;

const DEFAULT_TRANSCRIPT =
  "Good rally. On the backhand you're arming the ball — rotate from the hips earlier, " +
  "split-step, and drive through contact. Let's run 20 cross-court.";

function dlog(event, data = {}) {
  try { console.log("[dbg]", event, data); } catch {}
  try {
    fetch(`${API}/log`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, data }), keepalive: true });
  } catch {}
}

let lastWarmTs = 0;

export function useCoach() {
  const [command, setCommand] = useState("");
  const [transcript, setTranscript] = useState(DEFAULT_TRANSCRIPT);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [recording, setRecording] = useState(false);
  const recogRef = useRef(null);
  const sendRef = useRef(() => {});
  const sendingRef = useRef(false);

  // keep the Replicate TTS model warm
  useEffect(() => {
    const warm = () => {
      if (document.visibilityState && document.visibilityState !== "visible") return;
      if (sendingRef.current || Date.now() - lastWarmTs < 30000) return;
      lastWarmTs = Date.now();
      fetch(`${API}/warmup`, { method: "POST" }).then((r) => r.json())
        .then((d) => dlog("warmup", d)).catch((e) => dlog("warmup-err", { message: String(e) }));
    };
    warm();
    const id = setInterval(warm, 180000);
    return () => clearInterval(id);
  }, []);

  async function send(raw) {
    const msg = (raw ?? command).trim();
    if (!msg || busy) return;
    unlockAudio();
    sendingRef.current = true;
    setCommand("");
    setBusy(true);
    setTranscript("…");
    try {
      const r = await fetch(`${API}/chat`, { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: msg }) });
      const data = await r.json();
      setTranscript(data.reply);
      setSpeaking(true);
      const t = await fetch(`${API}/tts`, { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: data.reply }) });
      if (t.ok) { await playAudio(URL.createObjectURL(await t.blob())); dlog("audio-played", { ctx: audioContextState() }); }
    } catch (e) {
      dlog("send-error", { message: String((e && e.message) || e) });
      setTranscript("⚠️ Backend offline — is server.py running on :8000?");
    } finally {
      setBusy(false); setSpeaking(false); sendingRef.current = false;
    }
  }
  sendRef.current = send;

  useEffect(() => {
    if (!SR) return;
    const r = new SR();
    r.lang = "en-US"; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e) => sendRef.current(e.results[0][0].transcript);
    r.onerror = (e) => { dlog("sr-error", { error: e.error }); setRecording(false); };
    r.onend = () => setRecording(false);
    recogRef.current = r;
    return () => r.abort();
  }, []);

  async function toggleRec() {
    unlockAudio();
    if (!SR) { setTranscript("Voice input needs Chrome — type instead."); return; }
    if (recording) { recogRef.current.stop(); setRecording(false); return; }
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      }
    } catch (e) { dlog("getusermedia-err", { name: e.name }); setTranscript("No mic access: " + e.name); return; }
    setRecording(true);
    try { recogRef.current.start(); } catch (e) { setRecording(false); dlog("sr-start-throw", { m: e.message }); }
  }

  return { command, setCommand, transcript, busy, speaking, recording, send, toggleRec };
}
