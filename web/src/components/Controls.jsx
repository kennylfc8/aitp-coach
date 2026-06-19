import { useState } from "react";
import { playAudio } from "../lipsync";

// Step 1–2: text input + mic are mocked; the "Тест речи" button plays the sample
// mp3 and drives lip-sync. Step 3 wires Claude; step 4 wires Web Speech API mic.
export default function Controls() {
  const [text, setText] = useState("");

  return (
    <footer className="controls">
      <button className="mic" title="Push-to-talk (шаг 4)">🎤</button>
      <input
        className="text"
        placeholder="Напиши тренеру… (чат — шаг 3)"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="play" onClick={() => playAudio("/coach_test.mp3")}>
        ▶ Тест речи (lip-sync)
      </button>
    </footer>
  );
}
