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
};

export function demoCmd(cmd, arg) {
  demo.cmd = cmd; demo.arg = arg; demo.cmdId++;
}

// Curated pilot library from the 40-clip base. Real tennis strokes plug in here
// once a mocap pack is bought — same format, zero code changes.
export const DEMO_MOVES = [
  ["RETARGET.TEST — sword swing", "rtest"],
  ["SERVE — pitch surrogate", "pitch"],
  ["SWING — golf surrogate", "golf"],
  ["OVERHEAD THROW", "throw"],
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
