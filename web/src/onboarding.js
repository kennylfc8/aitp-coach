// New-user NTRP assessment funnel. Tiered depth (quick / help-me / detailed),
// expanded skippable strokes, weakest-link scoring (USTA: your NTRP ≈ your weakest link),
// flexible goal. Client-side; profile persisted to localStorage in the /player shape.

const KEY = "ace_profile_v1";
export const loadProfile = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
export const saveProfile = (p) => localStorage.setItem(KEY, JSON.stringify(p));
export const clearProfile = () => localStorage.removeItem(KEY);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Official-ish NTRP level descriptions (USTA General Characteristics, condensed).
export const LEVELS = [
  { key: "2.5", ntrp: 2.5, desc: "Держишь медленный обмен с задней линии; удары ещё нарабатываются; учишься читать мяч и позицию." },
  { key: "3.0", ntrp: 3.0, desc: "Стабилен на среднем темпе, но не все удары уверенные; слабый контроль направления, глубины и пейса." },
  { key: "3.5", ntrp: 3.5, desc: "Удары надёжны, контролируешь направление на среднем темпе; глубины/вариаций мало; растёт игра у сетки." },
  { key: "4.0", ntrp: 4.0, desc: "Надёжные удары, меняешь глубину на форхенде и бэкхенде; успешно играешь лоб, смеш, подход, воллей." },
  { key: "4.5", ntrp: 4.5, desc: "Варьируешь пейс и спин, хорошо закрываешь корт, контролируешь глубину, строишь план; мощная точная подача." },
  { key: "5.0", ntrp: 5.0, desc: "Сильное предугадывание, регулярные виннеры, надёжен под давлением; уверенные удары в сложных ситуациях." },
];

export const MODES = [
  { key: "quick",    label: "QUICK",             qs: "1 шаг",     desc: "Просто выбери уровень. Грубо, но мгновенно.", conf: 40 },
  { key: "standard", label: "HELP ME DETERMINE", qs: "6 ударов",  desc: "Оцени основные удары — точнее.",              conf: 65 },
  { key: "deep",     label: "DETAILED",          qs: "12 ударов", desc: "Все удары + тактика. Максимум точности.",     conf: 85 },
];

// Expanded stroke set. Every stroke is skippable ("не знаю").
export const STROKES = [
  { key: "forehand", label: "FOREHAND", core: true },
  { key: "backhand", label: "BACKHAND", core: true },
  { key: "serve", label: "SERVE", core: true },
  { key: "return", label: "RETURN", core: true },
  { key: "movement", label: "MOVEMENT / FOOTWORK", core: true },
  { key: "consistency", label: "CONSISTENCY", core: true },
  { key: "volley", label: "VOLLEY" },
  { key: "smash", label: "OVERHEAD / SMASH" },
  { key: "slice", label: "SLICE" },
  { key: "lob", label: "LOB" },
  { key: "approach", label: "APPROACH SHOT" },
  { key: "tactics", label: "TACTICS / MATCH PLAY" },
];

const DRILLS = {
  forehand: ["FOREHAND CROSS", 20], backhand: ["BACKHAND CROSS", 20], serve: ["SERVE: TOSS + KICK", 20],
  return: ["RETURN DIRECTIONS", 15], movement: ["SPLIT-STEP FOOTWORK", 15], consistency: ["20-BALL RALLY", 15],
  volley: ["VOLLEY REACT", 15], smash: ["OVERHEAD REPS", 15], slice: ["SLICE CONTROL", 15],
  lob: ["LOB + RECOVER", 15], approach: ["APPROACH + CLOSE", 15], tactics: ["PATTERN POINTS", 15],
};

const labelOf = (k) => (STROKES.find((s) => s.key === k) || { label: k.toUpperCase() }).label;

// QUICK: NTRP = the level you self-pick. DETERMINE/DETAILED: NTRP is COMPUTED from your
// stroke ratings (weakest-link) — no level pick, that's the whole point of "help me determine".
export function computeNtrp({ mode, level, ratings }) {
  if (mode === "quick") return (LEVELS.find((l) => l.key === level) || LEVELS[1]).ntrp;
  const vals = STROKES.map((s) => ratings[s.key]).filter((v) => typeof v === "number");
  if (!vals.length) return 3.0; // determine mode, nothing rated yet
  const min = Math.min(...vals);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const skill = 0.55 * min + 0.45 * avg;        // weakest-link leaning
  return clamp(Math.round((1.0 + skill * 0.5) * 2) / 2, 1.5, 7); // skill 5→3.5, 7→4.5, 8→5.0
}

export function computeConf({ mode, ratings }) {
  if (mode === "quick") return 40;
  const answered = STROKES.filter((s) => typeof ratings[s.key] === "number").length;
  const total = mode === "deep" ? STROKES.length : 6;
  const base = MODES.find((m) => m.key === mode)?.conf || 60;
  return Math.round(base * (0.6 + 0.4 * clamp(answered / total, 0, 1)));
}

export function buildProfile({ name, mode, level, ratings, target, weeks }) {
  const ntrp = computeNtrp({ mode, level, ratings });
  const tgt = clamp(target ?? ntrp + 0.5, 1.5, 7);
  const conf = computeConf({ mode, ratings });

  const ratedKeys = STROKES.filter((s) => typeof ratings[s.key] === "number");

  // weak zones = lowest-rated strokes
  const weakSorted = [...ratedKeys].sort((a, b) => ratings[a.key] - ratings[b.key]);
  const weakStrokes = (weakSorted.length ? weakSorted : STROKES.filter((s) => s.core)).slice(0, 2);

  // skill matrix: core strokes; rated value or level default
  const def = clamp(Math.round(ntrp * 2), 1, 10);
  const skills = STROKES.filter((s) => s.core).map((s) => {
    const raw = typeof ratings[s.key] === "number" ? ratings[s.key] : def;
    return { key: s.key, label: s.label.split(" ")[0], v: raw / 10, raw };
  });

  // plan from weak dims
  const seen = new Set();
  const planSeq = [["WARMUP", 10], DRILLS[weakStrokes[0].key], DRILLS[weakStrokes[1]?.key], ["LIVE POINTS", 15]];
  const plan = planSeq.filter((x) => x && !seen.has(x[0]) && seen.add(x[0])).slice(0, 5);

  return {
    name: (name || "PLAYER").toUpperCase().slice(0, 18),
    streak: 0,
    utr: { value: ntrp, target: tgt, confidence: conf, weeks_left: weeks || 12, focus: weakStrokes[0].label.split(" ")[0] },
    weaknesses: weakStrokes.map((s) => ({ key: s.key, label: s.label.split(" ")[0] })),
    skills,
    today_plan: plan.map(([t, m]) => ({ title: t, minutes: m })),
  };
}

export { labelOf };
