// Dev-only local capture. Uses an existing Playwright installation, no app dependency.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: {
  url: { type: 'string', default: 'http://localhost:5173' }, video: { type: 'string' }, output: { type: 'string' },
  fps: { type: 'string', default: '30' }, 'num-poses': { type: 'string', default: '1' },
  playwright: { type: 'string' }, delegate: { type: 'string' }, adaptive: { type: 'boolean', default: false },
  'local-assets': { type: 'boolean', default: false },
  'target-ms': { type: 'string', default: '60000' },
} });
if (!values.video || !values.output) throw new Error('--video and --output required');
const runtime = values.playwright || process.env.PLAYWRIGHT_PATH;
const { chromium } = await import(runtime ? pathToFileURL(path.resolve(runtime)).href : 'playwright');
// Full Chromium headless has a compositor; headless-shell can suppress video callbacks.
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  if (values['local-assets']) {
    await page.route('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/*', async route => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1);
      await route.fulfill({ path: path.resolve('web/node_modules/@mediapipe/tasks-vision/wasm', name),
        contentType: name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await page.route('https://storage.googleapis.com/mediapipe-models/**', route => route.fulfill({
      path: path.resolve('samples/pose_landmarker_heavy.task'), contentType: 'application/octet-stream', headers: { 'Access-Control-Allow-Origin': '*' } }));
  }
  await page.goto(values.url);
  await page.evaluate(async () => { await import('/src/pose.js'); const input = document.createElement('input'); input.type = 'file'; input.id = 'pose-capture-file'; document.body.appendChild(input); });
  await page.locator('#pose-capture-file').setInputFiles(path.resolve(values.video));
  const result = await page.evaluate(async options => {
    const capture = await window.__poseQA.processVideo(document.querySelector('#pose-capture-file').files[0], options);
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    capture.meta.renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
    return capture;
  }, { fps: +values.fps, numPoses: +values['num-poses'], adaptive: values.adaptive, targetMs: +values['target-ms'], delegate: values.delegate });
  await fs.mkdir(path.dirname(values.output), { recursive: true });
  await fs.writeFile(values.output, JSON.stringify(result));
  console.log(JSON.stringify({ output: values.output, ...result.meta }));
} finally { await browser.close(); }
