// Bottom command line. Hidden input captures keystrokes; clicking the bar focuses it.
import { useRef, useEffect } from "react";

export default function CommandLine({ command, setCommand, send, recording, toggleRec, busy }) {
  const inp = useRef(null);
  useEffect(() => { inp.current?.focus(); }, []);

  return (
    <div className="cmd" onClick={() => inp.current?.focus()}>
      <span className="cor tl" /><span className="cor br" />
      <span className="gt">&gt;</span>
      <div className="field">
        {command ? <span>{command}</span> : <span className="ph">ask the coach</span>}
        <span className="ccur" />
      </div>
      <input
        ref={inp}
        className="hidden"
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") send(); }}
        aria-label="command"
      />
      <button
        className={"cbtn rec" + (recording ? " on" : "")}
        onClick={(e) => { e.stopPropagation(); toggleRec(); }}
      >
        <span className="d" /> REC
      </button>
      <button
        className="cbtn send"
        onClick={(e) => { e.stopPropagation(); send(); }}
        disabled={busy}
      >
        SEND ▸
      </button>
    </div>
  );
}
