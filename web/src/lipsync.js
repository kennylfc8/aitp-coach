// Browser-native, real-time, audio-driven lip-sync (language-agnostic — works on RU).
// Heavy stuff (LLM, TTS) lives on servers; this only analyzes the audio the browser plays.
import { Lipsync } from "wawa-lipsync";

export const lipsyncManager = new Lipsync();

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
export function playAudio(src) {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.crossOrigin = "anonymous";
    lipsyncManager.connectAudio(audioEl);
    connected = true;
  }
  unlockAudio();
  audioEl.src = src;
  audioEl.currentTime = 0;
  return audioEl.play();
}

export const isConnected = () => connected;
