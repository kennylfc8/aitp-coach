// Browser-native, real-time, audio-driven lip-sync (language-agnostic — works on RU).
// Heavy stuff (LLM, TTS) lives on servers; this only analyzes the audio the browser plays.
import { Lipsync } from "wawa-lipsync";

export const lipsyncManager = new Lipsync();
if (typeof window !== "undefined") window.__lip = lipsyncManager; // debug handle

let audioEl = null;
let connected = false;

// Web Audio contexts start "suspended" until a user gesture. Once the <audio> is
// routed through wawa-lipsync's context, a suspended context = SILENCE even though
// play() resolves. Call this synchronously on a click/tap to unlock it.
export function unlockAudio() {
  try {
    const ctx = lipsyncManager.audioContext;
    if (ctx && ctx.state !== "running") return ctx.resume();
  } catch {}
}

export const audioContextState = () => {
  try { return lipsyncManager.audioContext ? lipsyncManager.audioContext.state : "none"; }
  catch { return "?"; }
};

// Reuse ONE <audio> element: wawa-lipsync attaches a single Web Audio source per element.
// Resolves when playback ENDS (so callers can hold "speaking" for the whole reply).
// ORDER MATTERS: connectAudio() silently bails out (and permanently marks the element
// as "connected") if the element has NO src yet — so src must be set FIRST.
export function playAudio(src) {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.crossOrigin = "anonymous";
  }
  audioEl.src = src;
  if (!connected) {
    lipsyncManager.connectAudio(audioEl);
    connected = true;
  }
  unlockAudio();
  audioEl.currentTime = 0;
  return new Promise((resolve) => {
    audioEl.onended = resolve;
    audioEl.onerror = resolve;
    audioEl.play().catch(resolve);
  });
}

export const isConnected = () => connected;

// ---- Rhubarb phoneme cues (server-computed): [[startSec, "A".."H"|"X"], ...] ----
// When present they drive the mouth precisely; otherwise the FFT realtime path runs.
let cues = [];
export function setCues(c) { cues = Array.isArray(c) ? c : []; }
export const hasCues = () => cues.length > 0;
export const audioTime = () => (audioEl ? audioEl.currentTime : 0);
export function cueAt(t) {
  if (!cues.length) return null;
  let lo = 0, hi = cues.length - 1, ans = "X";
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid][0] <= t) { ans = cues[mid][1]; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
