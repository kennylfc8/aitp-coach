// wawa-lipsync emits 15 visemes. For the PLACEHOLDER avatar we map each to a mouth
// "openness" (0..1). A real Avaturn GLB instead has morph targets named `viseme_<key>`
// (ARKit/Oculus), which we'd drive directly — see web/README.md.
export const VISEME_OPENNESS = {
  sil: 0.0, PP: 0.05, FF: 0.15, TH: 0.3, DD: 0.35, kk: 0.3, CH: 0.3,
  SS: 0.2, nn: 0.25, RR: 0.35, aa: 1.0, E: 0.6, ih: 0.45, oh: 0.85, ou: 0.6,
};
