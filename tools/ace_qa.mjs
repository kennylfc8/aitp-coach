// Headless QA for the Ace mascot head (?char=ace). Drives the live dev server through
// the DEV hooks (window.__rig/__face/__demo/__cam/__ctr), writes a JSON report and PNG frames.
//   PLAYWRIGHT_PATH=<playwright-core/index.mjs> node tools/ace_qa.mjs [--url http://localhost:5173] [--out mockups/characters/ace/qa]
// Frame rate under SwiftShader is ~8 fps: character time (A.t) is used for waits, not wall clock.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { url: { type: 'string', default: 'http://localhost:5173' },
  out: { type: 'string', default: 'mockups/characters/ace/qa' }, playwright: { type: 'string' } } });
const runtime = values.playwright || process.env.PLAYWRIGHT_PATH;
const { chromium } = await import(runtime ? pathToFileURL(path.resolve(runtime)).href : 'playwright');
const PROFILE = { name: 'QA', streak: 0, utr: { value: 4, target: 4.5, confidence: 43, weeks_left: 12, focus: 'RETURN' },
  weaknesses: [{ key: 'return', label: 'RETURN' }],
  skills: ['forehand', 'backhand', 'serve', 'return', 'movement', 'consistency'].map(k => ({ key: k, label: k.toUpperCase(), v: 0.8, raw: 8 })),
  today_plan: [{ title: 'WARMUP', minutes: 10 }] };
const VISEMES = ['viseme_sil', 'viseme_aa', 'viseme_E', 'viseme_O', 'viseme_U', 'viseme_FF', 'viseme_PP'];
await fs.mkdir(values.out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-unsafe-swiftshader'] });
const report = { startedAt: new Date().toISOString(), tests: {} };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.addInitScript(p => localStorage.setItem('ace_profile_v1', JSON.stringify(p)), PROFILE);
  page.on('pageerror', e => console.error('[page]', e.message));
  console.error('[qa] goto'); await page.goto(values.url + '/?char=ace');
  await page.waitForFunction(() => window.__rig?.scene?.userData?.ace && window.__rig.A.currentName && window.__cam && window.__ctr, null, { timeout: 90000 });
  // advance character time (A.t is accumulated from render dt, so it is frame-loop truth)
  const advance = s => page.evaluate(s => new Promise(res => {
    const A = window.__rig.A, t0 = A.t, w0 = performance.now(); let n = 0;
    const tick = () => { n++; if (A.t - t0 >= s || performance.now() - w0 > s * 1000 + 6000) res({ frames: n, elapsed: +(A.t - t0).toFixed(2) }); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), s);
  await page.waitForFunction(() => new Promise(r => { const A = window.__rig.A, t0 = A.t; setTimeout(() => r(A.t - t0 > 0.2), 400); }), null, { timeout: 60000 }); // clips loaded, clock running
  console.error('[qa] booted', await page.evaluate(() => ({ anim: window.__rig.A.currentName, t: window.__rig.A.t })));
  await page.evaluate(() => { window.__rig.A.busy = false; window.__rig.playLoop('idle', 0.2); });
  console.error('[qa] settle', await advance(2.5));
  // camera in the FACE frame: dist along the ball's forward, side = yaw offset (m), up offset (m)
  const camFace = (dist, side = 0, up = 0.02, ty = -0.02) => page.evaluate(([dist, side, up, ty]) => {
    const r = window.__rig, T = r.THREE, ace = r.scene.userData.ace;
    const h = ace.head.getWorldPosition(new T.Vector3()), f = ace.head.getWorldDirection(new T.Vector3());
    const right = new T.Vector3().crossVectors(f, new T.Vector3(0, 1, 0)).normalize();
    window.__ctr.target.copy(h).addScaledVector(new T.Vector3(0, 1, 0), ty);
    window.__cam.position.copy(h).addScaledVector(f, dist).addScaledVector(right, side).addScaledVector(new T.Vector3(0, 1, 0), up);
    window.__ctr.update();
  }, [dist, side, up, ty]);
  const camWorld = (dx, dy, dz, ty = -0.02) => page.evaluate(([dx, dy, dz, ty]) => {
    const r = window.__rig, T = r.THREE; const h = r.bones.head.getWorldPosition(new T.Vector3());
    window.__ctr.target.set(h.x, h.y + ty, h.z); window.__cam.position.set(h.x + dx, h.y + dy, h.z + dz); window.__ctr.update();
  }, [dx, dy, dz, ty]);
  const shot = (name, clip) => page.screenshot({ path: path.join(values.out, name + '.png'), clip });
  const FACE = { x: 60, y: 60, width: 520, height: 460 }, BODY = { x: 0, y: 40, width: 760, height: 560 };
  const aceState = () => page.evaluate(() => { const a = window.__rig.scene.userData.ace, d = window.__demo.demo;
    return { t: +d.t.toFixed(2), stretch: +a.state.stretch.toFixed(3), jig: +a.state.jigPos.length().toFixed(4), anim: window.__rig.A.currentName }; });

  console.error('[qa] T1', new Date().toISOString());
  // T1 rigid attachment + frame rate (jig/stretch are children of head, so the seat itself must be rigid)
  report.tests.rigid = await page.evaluate(() => new Promise(res => {
    const r = window.__rig, T = r.THREE, ace = r.scene.userData.ace; const a = new T.Vector3(), b = new T.Vector3();
    let min = 1e9, max = 0, n = 0; const t0 = performance.now();
    const tick = () => { r.bones.head.getWorldPosition(a); ace.head.getWorldPosition(b); const d = a.distanceTo(b); min = Math.min(min, d); max = Math.max(max, d);
      if (++n < 120) requestAnimationFrame(tick); else res({ offsetMin: +min.toFixed(4), offsetMax: +max.toFixed(4), fps: +(n / ((performance.now() - t0) / 1000)).toFixed(1) }); };
    requestAnimationFrame(tick);
  }));

  console.error('[qa] T2', new Date().toISOString());
  // T2 blinks over 12 s of character time
  report.tests.blink = await page.evaluate(() => new Promise(res => {
    const r = window.__rig, ace = r.scene.userData.ace; const A = r.A, t0 = A.t; const blinks = []; let prev = false, minSy = 1;
    const tick = () => { const sy = ace.eyes[0].scale.y; minSy = Math.min(minSy, sy); const bl = sy < 0.5; if (bl && !prev) blinks.push(+(A.t - t0).toFixed(2)); prev = bl;
      if (A.t - t0 < 12) requestAnimationFrame(tick); else res({ blinksAt: blinks, minEyeScaleY: +minSy.toFixed(3) }); };
    requestAnimationFrame(tick);
  }));

  console.error('[qa] T3', new Date().toISOString());
  // T3 iris tracking: camera right / centre / left of the face
  const iris = [];
  for (const side of [0.4, 0, -0.4]) {
    await camFace(0.5, side, 0.05); await advance(0.8);
    iris.push(await page.evaluate(side => { const ace = window.__rig.scene.userData.ace; const [l, r] = ace.eyes.map(e => e.getObjectByName('iris').position);
      return { camSide: side, irisL: [+l.x.toFixed(4), +l.y.toFixed(4)], irisR: [+r.x.toFixed(4), +r.y.toFixed(4)] }; }, side));
    await shot('iris_cam' + (side > 0 ? 'R' : side < 0 ? 'L' : 'C'), FACE);
  }
  report.tests.iris = { samples: iris, tracks: Math.sign(iris[0].irisL[0]) !== Math.sign(iris[2].irisL[0]) && Math.abs(iris[0].irisL[0] - iris[2].irisL[0]) > 0.004 };

  console.error('[qa] T4', new Date().toISOString());
  // T4 visemes + squash during the talk loop (camera re-seated on the face each shot: the talk clip turns the head)
  await page.evaluate(() => { window.__rig.A.speaking = true; window.__rig.playLoop('talk', 0.3); });
  await advance(0.6);
  const vis = [];
  for (const v of [...VISEMES.slice(1), 'viseme_kk', 'viseme_sil']) {
    await page.evaluate(v => { window.__face.force = v; }, v); await advance(0.45); await camFace(0.42, 0.03, 0.0, -0.03); await advance(0.05);
    vis.push(await page.evaluate(v => { const ace = window.__rig.scene.userData.ace;
      return { viseme: v, cell: Math.round(ace.sheet.offset.x * 8), squash: +ace.state.squash.toFixed(3), scaleY: +ace.sA.scale.y.toFixed(3), nodDeg: +(ace.parts.rotation.x * 180 / Math.PI).toFixed(1), anim: window.__rig.A.currentName }; }, v));
    await shot('viseme_' + v.replace('viseme_', ''), FACE);
  }
  report.tests.visemes = vis;
  await page.evaluate(() => { window.__face.force = null; window.__rig.A.speaking = false; window.__rig.playLoop('idle', 0.3); });
  await advance(1);

  // portraits before the demo test: leaving DEMO.LAB flies the app camera back and overrides ours
  await camFace(0.45, 0.25, 0.08, -0.05); await advance(0.3); await shot('portrait_3q', FACE);
  await camFace(0.02, 0.5, 0.02, -0.05); await advance(0.3); await shot('portrait_profile', FACE);
  console.error('[qa] T5', new Date().toISOString());
  // T5 demo clip live at 1x: head follows the body, stretch/wobble react to the throw, then settle in idle
  await camWorld(0.9, -0.2, 1.9, -0.55);
  await page.evaluate(() => { window.__demo.demoCmd('start', 'pitch'); });
  await advance(0.6);
  await page.evaluate(() => { window.__demo.demoCmd('speed', 1); window.__demo.demoCmd('scrub', 0); });
  const live = [];
  for (let i = 0; i < 12; i++) { live.push(await aceState()); await shot('live_' + String(i).padStart(2, '0'), BODY); await advance(0.3); }
  const trace = await page.evaluate(() => new Promise(res => { const a = window.__rig.scene.userData.ace, d = window.__demo.demo, A = window.__rig.A, t0 = A.t;
    window.__demo.demoCmd('scrub', 0); let sMax = 0, jMax = 0, n = 0; const tick = () => { n++; sMax = Math.max(sMax, a.state.stretch); jMax = Math.max(jMax, a.state.jigPos.length());
      if (A.t - t0 < d.dur * 1.05) requestAnimationFrame(tick); else res({ frames: n, stretchMax: +sMax.toFixed(3), jigMaxM: +jMax.toFixed(4), active: d.active }); }; requestAnimationFrame(tick); }));
  await page.evaluate(() => { window.__demo.demoCmd('exit'); });
  await advance(2.5);
  const rest = await aceState();
  report.tests.demo = { live, trace, rest };
  report.pass = {
    rigid: report.tests.rigid.offsetMax - report.tests.rigid.offsetMin < 0.001,
    blink: report.tests.blink.blinksAt.length >= 2 && report.tests.blink.minEyeScaleY < 0.2,
    iris: report.tests.iris.tracks,
    visemes: vis.filter(x => x.viseme !== 'viseme_kk').every(x => x.cell === VISEMES.indexOf(x.viseme)) && vis.find(x => x.viseme === 'viseme_aa').squash > 0.03,
    demoFollows: live.every(d => d.anim === 'pitch') && trace.active === 'pitch',
    motionReacts: trace.stretchMax > 0.05 && trace.jigMaxM > 0.003,
    motionSettles: rest.stretch < 0.01 && rest.jig < 0.002 && rest.anim === 'idle',
  };
} finally { await browser.close(); }
await fs.writeFile(path.join(values.out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ pass: report.pass, rigid: report.tests.rigid, blink: report.tests.blink, iris: report.tests.iris.samples, visemes: report.tests.visemes, demo: report.tests.demo }, null, 1));
