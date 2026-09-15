import { useState, Suspense, lazy } from "react";
import Dashboard from "./components/Dashboard";
import CoachViewport from "./components/CoachViewport";
import CommandLine from "./components/CommandLine";
import Onboarding from "./components/Onboarding";
import { useCoach } from "./useCoach";
import { loadProfile, saveProfile, clearProfile } from "./onboarding";
import "./App.css";

const Technique = lazy(() => import("./components/Technique"));

const THEME_NAMES = ["neon", "clay", "blue"];

export default function App() {
  const [profile, setProfile] = useState(loadProfile);
  const [tab, setTab] = useState("coach");
  const [theme, setTheme] = useState(() =>
    new URLSearchParams(window.location.search).get("theme") ||
    localStorage.getItem("coach_theme") || "neon"); // URL wins: links/tests stay deterministic
  const pickTheme = (t) => { setTheme(t); localStorage.setItem("coach_theme", t); };
  const coach = useCoach();

  // First run (no saved profile) → onboarding.
  if (!profile) {
    return <Onboarding onDone={(p) => { saveProfile(p); setProfile(p); }} />;
  }

  const reset = () => { clearProfile(); setProfile(null); };

  return (
    <div className="term">
      <header className="topbar">
        <div className="brand">
          <span className="bar" />ACE&nbsp;COACH
        </div>
        <div className="tabs">
          <button className={"tab" + (tab === "coach" ? " on" : "")} onClick={() => setTab("coach")}>COACH</button>
          <button className={"tab" + (tab === "tech" ? " on tech" : "")} onClick={() => setTab("tech")}>TECHNIQUE.3D</button>
        </div>
        <div className="tabs" title="сцена корта">
          {THEME_NAMES.map((t) => (
            <button key={t} className={"tab" + (theme === t ? " on" : "")}
              style={{ padding: "3px 8px", fontSize: 10 }} onClick={() => pickTheme(t)}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="kpis">
          <span><span className="dim">PLAYER</span> <span className="wd">{profile.name}</span></span>
          <span className="sep">·</span>
          <span><span className="dim">NTRP</span> <b>{profile.utr.value.toFixed(1)}</b> <span className="up">▸{profile.utr.target.toFixed(1)}</span></span>
          <span className="sep">·</span>
          <span><span className="dim">STREAK</span> <span className="wd">{profile.streak}d</span></span>
          <span className="sep">·</span>
          <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span className="recdot" /> <span className="red">LIVE</span>
          </span>
          <button className="tab" style={{ marginLeft: 8, padding: "3px 9px" }} onClick={reset} title="restart onboarding">⟳</button>
        </div>
      </header>

      {tab === "coach" ? (
        <>
          <div className="middle">
            <CoachViewport transcript={coach.transcript} speaking={coach.speaking} recording={coach.recording} theme={theme} />
            <Dashboard data={profile} />
          </div>
          <CommandLine {...coach} />
        </>
      ) : (
        <Suspense fallback={<div className="boot">loading TECHNIQUE.3D module…</div>}>
          <Technique />
        </Suspense>
      )}
    </div>
  );
}
