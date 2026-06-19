// Browser-native, real-time, audio-driven lip-sync (language-agnostic — works on RU).
// Heavy stuff (LLM, TTS) lives on servers; this only analyzes the audio the browser plays.
import { Lipsync } from "wawa-lipsync";

export const lipsyncManager = new Lipsync();

let audioEl = null;
let connected = false;

// Reuse ONE <audio> element: wawa-lipsync attaches a single Web Audio source per element.
export function playAudio(src) {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.crossOrigin = "anonymous";
    lipsyncManager.connectAudio(audioEl);
    connected = true;
  }
  audioEl.src = src;
  audioEl.currentTime = 0;
  return audioEl.play();
}

export const isConnected = () => connected;
