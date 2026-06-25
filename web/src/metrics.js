// Level B (1): biomechanics metrics from the MediaPipe 3D skeleton we already extract.
// Pure geometry on metric world landmarks (meters). Approximate (monocular depth), but indicative.
// MediaPipe Pose landmark indices:
const I = {
  NOSE: 0,
  LSHO: 11, RSHO: 12, LELB: 13, RELB: 14, LWRI: 15, RWRI: 16,
  LHIP: 23, RHIP: 24, LKNE: 25, RKNE: 26, LANK: 27, RANK: 28,
};

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v) => Math.hypot(v.x, v.y, v.z);
const dist = (a, b) => len(sub(a, b));
const deg = (r) => (r * 180) / Math.PI;

// Angle (deg) at joint b in the triangle a-b-c (3D).
function angleAt(a, b, c) {
  const u = sub(a, b);
  const v = sub(c, b);
  const d = (u.x * v.x + u.y * v.y + u.z * v.z) / (len(u) * len(v) || 1);
  return deg(Math.acos(Math.max(-1, Math.min(1, d))));
}

// Rotation of a body line (e.g. shoulders) in the ground plane (x-z); y is vertical (down).
const groundAngle = (a, b) => deg(Math.atan2(b.z - a.z, b.x - a.x));

const range = (arr) => (arr.length ? Math.max(...arr) - Math.min(...arr) : 0);
const round = (n, p = 0) => {
  const f = 10 ** p;
  return Math.round(n * f) / f;
};

/**
 * @param frames Array<{ t, joints:[{x,y,z,score}×33] }>
 * @param hand "right" | "left" — the hitting arm
 * @returns metrics summary + the detected contact frame index
 */
export function computeMetrics(frames, hand = "right") {
  if (!frames || frames.length < 3) return null;
  const J = (f) => f.joints;

  const SHO = hand === "right" ? I.RSHO : I.LSHO;
  const ELB = hand === "right" ? I.RELB : I.LELB;
  const WRI = hand === "right" ? I.RWRI : I.LWRI;
  const HIP = hand === "right" ? I.RHIP : I.LHIP;
  const KNE = hand === "right" ? I.RKNE : I.LKNE;
  const ANK = hand === "right" ? I.RANK : I.LANK;

  const shoulderAng = frames.map((f) => groundAngle(J(f)[I.LSHO], J(f)[I.RSHO]));
  const hipAng = frames.map((f) => groundAngle(J(f)[I.LHIP], J(f)[I.RHIP]));

  // Contact ≈ frame of peak hitting-wrist speed (most dynamic moment, no racquet needed).
  let contact = 1;
  let maxSpeed = -1;
  for (let i = 1; i < frames.length; i++) {
    const v = dist(J(frames[i])[WRI], J(frames[i - 1])[WRI]);
    if (v > maxSpeed) { maxSpeed = v; contact = i; }
  }

  // X-factor (shoulder-hip separation) across the wind-up, up to contact.
  let xFactor = 0;
  for (let i = 0; i <= contact; i++) {
    xFactor = Math.max(xFactor, Math.abs(shoulderAng[i] - hipAng[i]));
  }

  const cf = frames[contact];
  const elbowAtContact = angleAt(J(cf)[SHO], J(cf)[ELB], J(cf)[WRI]);

  // Deepest knee bend over the swing (smaller angle = more bend).
  let kneeMin = 180;
  for (const f of frames) kneeMin = Math.min(kneeMin, angleAt(J(f)[HIP], J(f)[KNE], J(f)[ANK]));

  // Contact height: hitting wrist vs shoulder (y is DOWN → positive = wrist above shoulder).
  const contactWristVsShoulder = J(cf)[SHO].y - J(cf)[WRI].y;

  return {
    hand,
    frames: frames.length,
    contactIndex: contact,
    shoulderTurnDeg: round(range(shoulderAng)),
    hipTurnDeg: round(range(hipAng)),
    xFactorDeg: round(xFactor),
    elbowAtContactDeg: round(elbowAtContact),
    kneeBendMinDeg: round(kneeMin),
    contactWristAboveShoulderM: round(contactWristVsShoulder, 2),
  };
}

// Human-readable rows for the UI panel (label, value, hint of the rough ideal).
export function metricRows(m) {
  if (!m) return [];
  return [
    { k: "Поворот плеч", v: `${m.shoulderTurnDeg}°`, ideal: "больше = больше замах" },
    { k: "Поворот бёдер", v: `${m.hipTurnDeg}°`, ideal: "база вращения" },
    { k: "X-factor (плечи−бёдра)", v: `${m.xFactorDeg}°`, ideal: "~30–50° = мощность" },
    { k: "Локоть в контакте", v: `${m.elbowAtContactDeg}°`, ideal: "форхенд ~120–160°" },
    { k: "Сгиб колена", v: `${m.kneeBendMinDeg}°`, ideal: "меньше = глубже загрузка" },
    { k: "Кисть выше плеча", v: `${m.contactWristAboveShoulderM} м`, ideal: "подача: высоко" },
  ];
}
