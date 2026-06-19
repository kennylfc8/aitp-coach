import { useState, useRef, useEffect } from "react";
import { playAudio } from "../lipsync";

// Step 3 + 4: type OR speak -> /chat (Claude) -> reply -> /tts -> play -> lip-sync.
// Voice input = browser Web Speech API (no server STT needed for MVP).
const API = "http://localhost:8000";
const SR = typeof window !== "undefined"
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : null;

export default function Controls() {
  const [text, setText] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const recogRef = useRef(null);
  const sendRef = useRef(() => {});

  async function sendMessage(raw) {
    const msg = (raw || "").trim();
    if (!msg || busy) return;
    setText("");
    setBusy(true);
    setReply("…");
    try {
      const r = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: msg }),
      });
      const data = await r.json();
      setReply(data.reply);

      const t = await fetch(`${API}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: data.reply }),
      });
      if (t.ok) await playAudio(URL.createObjectURL(await t.blob()));
    } catch {
      setReply("⚠️ Бэкенд не отвечает. Запущен ли server.py на :8000?");
    } finally {
      setBusy(false);
    }
  }
  sendRef.current = sendMessage;

  useEffect(() => {
    if (!SR) return;
    const r = new SR();
    r.lang = "ru-RU";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => sendRef.current(e.results[0][0].transcript);
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    recogRef.current = r;
    return () => r.abort();
  }, []);

  function toggleMic() {
    if (!SR) {
      setReply("🎤 Голосовой ввод не поддерживается этим браузером — используй Chrome или пиши текстом.");
      return;
    }
    if (listening) {
      recogRef.current.stop();
      setListening(false);
      return;
    }
    setListening(true);
    setReply("🎤 Слушаю…");
    try { recogRef.current.start(); } catch { /* already running */ }
  }

  return (
    <>
      {reply && (
        <div style={{
          padding: "8px 14px", fontSize: "14px", color: "#cfd6df",
          borderTop: "1px solid #20262e", background: "#0e131a",
        }}>
          🎾 {reply}
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
