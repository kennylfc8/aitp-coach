// Imperative bridge between the DEMO.LAB panel and the CoachChar3D animation mixer.
// UI writes commands (cmdId bump); the character consumes them in its frame loop and
// writes playback state (t/dur) back every frame. UI polls state at ~10Hz.
export const demo = {
  cmdId: 0, cmd: null, arg: null,
  active: null,      // clip key while demo mode is on (written by the character)
  paused: false,
  speed: 0.5,        // slow-mo default: technique is for studying
  t: 0, dur: 1,      // current clip time / duration (written by the character)
  gripCam: false,    // GRIP.CAM: camera flies to the racquet fist (button in DEMO.LAB)
  grip: "continental", // active grip preset (see GRIPS in CoachChar3D)
};

export function demoCmd(cmd, arg) {
  demo.cmd = cmd; demo.arg = arg; demo.cmdId++;
}
// dev: lets the QA harness drive demos without clicking through the UI
if (typeof window !== "undefined" && import.meta.env.DEV) window.__demo = { demo, demoCmd };

// Tennis grips = which bevel of the octagonal handle the index knuckle sits on.
// Modeled as twist around the handle axis (45° per bevel) from the solved
// continental (hammer) default. Assigned per clip; switchable live in GRIP.CAM.
export const GRIPS = {
  continental: { twist: 0, label: "CONTINENTAL", hint: "подача · волей · слайс" },
  eastern: { twist: 45, label: "EASTERN", hint: "плоский форхенд" },
  semiwestern: { twist: 90, label: "SEMI-WESTERN", hint: "топспин" },
};

// Curated pilot library from the 40-clip base. Real tennis strokes plug in here
// once a mocap pack is bought — same format, zero code changes.
// [label, clipKey, grip] — grip preset applied on start (default: continental).
export const DEMO_MOVES = [
  ["RETARGET.TEST — sword swing", "rtest", "eastern"],
  ["SERVE — pitch surrogate", "pitch", "continental"],
  ["SWING — golf surrogate", "golf", "eastern"],
  ["OVERHEAD THROW", "throw", "continental"],
  ["FOOTWORK · JACKS", "jacks"],
  ["FOOTWORK · RUN", "run"],
  ["GUARD STEP · BOXING", "boxing"],
  ["AIR SQUAT", "squat"],
  ["BURPEE", "burpee"],
  ["PUSH-UP", "pushup"],
  ["SIT-UPS", "situps"],
  ["PLANK", "plank"],
  ["WARMUP FLOW", "warmup"],
];
