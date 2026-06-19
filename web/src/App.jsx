import CoachCanvas from "./components/CoachCanvas";
import Dashboard from "./components/Dashboard";
import Controls from "./components/Controls";
import "./App.css";

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        🎾 AI Tennis Coach <span className="badge">3D · live</span>
      </header>
      <div className="main">
        <div className="stage"><CoachCanvas /></div>
        <Dashboard />
      </div>
      <Controls />
    </div>
  );
}
