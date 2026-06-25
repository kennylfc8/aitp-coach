import { useState, Suspense, lazy } from "react";
import CoachCanvas from "./components/CoachCanvas";
import Dashboard from "./components/Dashboard";
import Controls from "./components/Controls";
import "./App.css";

// Lazy: keep MediaPipe (~heavy) out of the coach bundle — loads only when the tab is opened.
const Technique = lazy(() => import("./components/Technique"));

export default function App() {
  const [mode, setMode] = useState("coach"); // "coach" | "technique"

  return (
    <div className="app">
      <header className="topbar">
        🎾 AI Tennis Coach <span className="badge">3D · live</span>
        <nav className="modes">
          <button className={mode === "coach" ? "on" : ""} onClick={() => setMode("coach")}>
            Коуч
          </button>
          <button className={mode === "technique" ? "on" : ""} onClick={() => setMode("technique")}>
            Техника 3D
          </button>
        </nav>
      </header>

      {mode === "coach" ? (
        <>
          <div className="main">
            <div className="stage"><CoachCanvas /></div>
            <Dashboard />
          </div>
          <Controls />
        </>
      ) : (
        <Suspense
          fallback={
            <div className="tech">
              <div className="tech-stage">
                <div className="tech-empty"><div className="tech-spinner">Загружаю модуль…</div></div>
              </div>
            </div>
          }
        >
          <Technique />
        </Suspense>
      )}
    </div>
  );
}
