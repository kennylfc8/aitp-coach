// wawa-lipsync emits 15 visemes via `lipsyncManager.viseme`, as PREFIXED strings:
// "viseme_sil", "viseme_aa", "viseme_E", "viseme_O" ... (see node_modules/wawa-lipsync,
// the enum maps each key to "viseme_<KEY>"). Keys here MUST match those exact strings.
// For the PLACEHOLDER avatar we map each to a mouth "openness" (0..1). A real Avaturn GLB
// has morph targets named exactly `viseme_<key>`, so the same strings drive it directly.
export const VISEME_OPENNESS = {
  viseme_sil: 0.0,
  viseme_PP: 0.05,
  viseme_FF: 0.15,
  viseme_TH: 0.3,
  viseme_DD: 0.35,
  viseme_kk: 0.3,
  viseme_CH: 0.3,
  viseme_SS: 0.2,
  viseme_nn: 0.25,
  viseme_RR: 0.35,
  viseme_aa: 1.0,
  viseme_E: 0.6,
  viseme_I: 0.45,
  viseme_O: 0.85,
  viseme_U: 0.6,
};
