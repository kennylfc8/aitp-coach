import { useState, useRef, useEffect } from "react";
import { playAudio, unlockAudio, audioContextState } from "../lipsync";

// Step 3 + 4: type OR speak -> /chat (Claude) -> reply -> /tts -> play -> lip-sync.
// Voice input = browser Web Speech API (no server STT needed for MVP).
const API = "http://localhost:8000";
const SR = typeof window !== "undefined"
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : null;

// Debug: ship browser events to the backend so the dev can see exactly what happens.
function dlog(event, data = {}) {
  try { console.log("[dbg]", event, data); } catch {}
  try {
    fetch(`${API}/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, data }),
      keepalive: true,
    });
  } catch {}
}

// Throttle warmups across all callers (also collapses React StrictMode's double mount).
let lastWarmTs = 0;

export default function Controls() {
  const [text, setText] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const recogRef = useRef(null);
  const sendRef = useRef(() => {});
  const sendingRef = useRef(false); // true while a real /tts is in flight — warmup must not collide

  // Keep the Replicate TTS model warm (cold start ≈ 40s, warm ≈ 4s). Ping on load + every 60s.
  useEffect(() => {
    const warm = () => {
      if (document.visibilityState && document.visibilityState !== "visible") return;
      if (sendingRef.current) return;              // never collide with a real request (burst-1!)
      if (Date.now() - lastWarmTs < 30000) return; // throttle + collapse StrictMode double-mount
      lastWarmTs = Date.now();
      const t0 = performance.now();
      fetch(`${API}/warmup`, { method: "POST" })
        .then((r) => r.json())
        .then((d) => dlog("warmup", { ...d, rtt: Math.round(performance.now() - t0) }))
        .catch((e) => dlog("warmup-err", { message: String(e) }));
    };
    warm();
    const id = setInterval(warm, 180000); // every 3 min — each ping is a real Replicate run, don't hammer
    return () => clearInterval(id);
  }, []);

  async function sendMessage(raw) {
    const msg = (raw || "").trim();
    dlog("send", { msg, busy });
    if (!msg || busy) {
      dlog("send-skip", { reason: !msg ? "empty" : "busy" });
      return;
    }
    unlockAudio(); // resume Web Audio while we still have the user gesture
    sendingRef.current = true; // block warmup pings from colliding (Replicate burst-1)
    setText("");
    setBusy(true);
    setReply("…");
    try {
      const r = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: msg }),
      });
      dlog("chat-resp", { status: r.status });
      const data = await r.json();
      dlog("chat-reply", { reply: (data.reply || "").slice(0, 100) });
      setReply(data.reply);

      setSpeaking(true);
      const t = await fetch(`${API}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: data.reply }),
      });
      dlog("tts-resp", { status: t.status, ok: t.ok, type: t.headers.get("content-type") });
      if (t.ok) {
        await playAudio(URL.createObjectURL(await t.blob()));
        dlog("audio-played", { ctx: audioContextState() });
      }
    } catch (e) {
      dlog("send-error", { message: String((e && e.message) || e) });
      setReply("⚠️ Бэкенд не отвечает. Запущен ли server.py на :8000?");
    } finally {
      setBusy(false);
      setSpeaking(false);
      sendingRef.current = false;
    }
  }
  sendRef.current = sendMessage;

  useEffect(() => {
    dlog("mount", {
      SR: !!SR,
      mediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      secureContext: window.isSecureContext,
      url: window.location.href,
      ua: navigator.userAgent,
    });
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: "microphone" })
        .then((p) => dlog("perm", { state: p.state }))
        .catch((e) => dlog("perm-err", { message: String(e) }));
    }
    if (!SR) return;
    const r = new SR();
    r.lang = "en-US";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onstart = () => { dlog("sr-start"); setReply("🎤 Слушаю… говори"); };
    r.onresult = (e) => {
      const tr = e.results[0][0].transcript;
      dlog("sr-result", { transcript: tr });
      sendRef.current(tr);
    };
    r.onerror = (e) => {
      dlog("sr-error", { error: e.error, message: e.message });
      setListening(false);
      setReply("🎤 Ошибка микрофона: " + (e.error || "?"));
    };
    r.onend = () => { dlog("sr-end"); setListening(false); };
    recogRef.current = r;
    return () => r.abort();
  }, []);

  async function toggleMic() {
    dlog("mic-click", { listening, SR: !!SR });
    unlockAudio(); // resume Web Audio on this real click gesture (for the voice-out later)
    if (!SR) {
      setReply("🎤 Голосовой ввод не поддерживается этим браузером — используй Chrome или пиши текстом.");
      return;
    }
    if (listening) {
      recogRef.current.stop();
      setListening(false);
      return;
    }
    // Explicitly request mic permission first: clearer prompt + precise error name, and often fixes not-allowed.
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        dlog("getusermedia-ok", { tracks: stream.getAudioTracks().length });
        stream.getTracks().forEach((t) => t.stop());
      }
    } catch (e) {
      dlog("getusermedia-err", { name: e.name, message: e.message });
      setReply("🎤 Нет доступа к микрофону: " + e.name + " — разреши доступ в браузере.");
      return;
    }
    setListening(true);
    setReply("🎤 Запускаю микрофон…");
    try {
      recogRef.current.start();
    } catch (e) {
      dlog("sr-start-throw", { message: e.message });
      setListening(false);
      setReply("🎤 Не запустился: " + e.message);
    }
  }

  return (
    <>
      {reply && (
        <div style={{
          padding: "8px 14px", fontSize: "14px", color: "#cfd6df",
          borderTop: "1px solid #20262e", background: "#0e131a",
        }}>
          🎾 {reply}{speaking ? "  🔊…" : ""}
        </div>
      )}
      <footer className="controls">
        <button
          className="mic"
          onClick={toggleMic}
          title="Сказать голосом"
          style={listening ? { background: "#7a1f1f", borderColor: "#7a1f1f" } : undefined}
        >
          {listening ? "■" : "🎤"}
        </button>
        <input
          className="text"
          placeholder="Напиши или скажи тренеру…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage(text)}
          disabled={busy}
        />
        <button className="play" onClick={() => sendMessage(text)} disabled={busy}>
          {busy ? "…" : "Отправить"}
        </button>
      </footer>
    </>
  );
}
