#!/usr/bin/env node
// demoflick record: drive a real app from a storyboard and capture raw frames
// plus a timeline (cursor path, clicks, captions) for the renderer.
//
//   node record.mjs storyboard.json [--out demoflick-out]

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPlaywright, parseArgs, sleep, die } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const storyboardPath = args._[0];
if (!storyboardPath) die('usage: node record.mjs storyboard.json [--out dir]');

const board = JSON.parse(fs.readFileSync(storyboardPath, 'utf8'));
const boardDir = path.dirname(path.resolve(storyboardPath));
const outDir = path.resolve(args.out || 'demoflick-out');
const rawDir = path.join(outDir, 'raw');
fs.rmSync(rawDir, { recursive: true, force: true });
fs.mkdirSync(rawDir, { recursive: true });

// Terminal mode records real commands in a terminal drawn in the browser.
const term = board.terminal ? { ...board.terminal } : null;
const vw = board.viewport?.width ?? (term ? 820 : 1280);
const vh = board.viewport?.height ?? (term ? 500 : 800);
if (term) {
  term.cwd = path.resolve(boardDir, term.cwd || '.');
  term.rows = Math.floor((vh - 36) / 24.65);
  term.cols = Math.floor((vw - 44) / 10.25);
  const label = term.prompt ?? path.basename(term.cwd);
  term.promptText = `\x1b[36m${label}\x1b[0m \x1b[32m$\x1b[0m `;
  board.url = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'terminal.html')).href;
}
// Capture scale: 2 is sharp when zoomed; 1 keeps heavy, animated pages smooth.
const DPR = board.scale === 1 ? 1 : 2;
const DEFAULT_ZOOM = board.zoom ?? 1.6;

// Deterministic jitter so two runs of one storyboard look the same.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const resolveUrl = (u) => {
  if (/^[a-z]+:\/\//i.test(u)) return u;
  return pathToFileURL(path.resolve(boardDir, u)).href;
};

const { chromium } = loadPlaywright();
// The flag makes the screencast deliver device pixels, so frames stay sharp when zoomed.
const browser = await chromium.launch({
  args: [`--force-device-scale-factor=${DPR}`],
  executablePath: process.env.DEMOFLICK_CHROMIUM || undefined,
});
const context = await browser.newContext({
  viewport: { width: vw, height: vh },
  deviceScaleFactor: DPR,
  colorScheme: board.colorScheme || 'light',
});
const page = await context.newPage();

let t0 = null;
let skew = 0; // seconds cut out of the recording (idle waits in terminal mode)
const now = () => (performance.now() - t0) / 1000 - skew;
const timeline = {
  title: board.title || '',
  url: '',
  urls: [],
  chrome: term ? 'terminal' : 'browser',
  viewport: { width: vw, height: vh },
  frames: [],
  cursor: [],
  clicks: [],
  focus: [],
  captions: [],
};
const mouse = { x: vw * 0.62, y: vh * 0.58 };
const writes = [];
let recording = false;

async function moveTo(x, y) {
  const sx = mouse.x, sy = mouse.y;
  const dist = Math.hypot(x - sx, y - sy);
  if (!recording || dist < 2) {
    await page.mouse.move(x, y);
    mouse.x = x; mouse.y = y;
    if (recording) timeline.cursor.push({ t: now(), x, y });
    return;
  }
  const dur = Math.min(1000, Math.max(320, 260 + dist * 0.85));
  // Slight arc: control point pushed off the straight line.
  const bend = (rand() - 0.5) * 0.16 * dist;
  const mx = (sx + x) / 2 - ((y - sy) / dist) * bend;
  const my = (sy + y) / 2 + ((x - sx) / dist) * bend;
  const start = performance.now();
  for (;;) {
    const p = Math.min(1, (performance.now() - start) / dur);
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    const cx = (1 - e) * (1 - e) * sx + 2 * (1 - e) * e * mx + e * e * x;
    const cy = (1 - e) * (1 - e) * sy + 2 * (1 - e) * e * my + e * e * y;
    await page.mouse.move(cx, cy);
    mouse.x = cx; mouse.y = cy;
    timeline.cursor.push({ t: now(), x: cx, y: cy });
    if (p >= 1) break;
    await sleep(12);
  }
}

async function target(step) {
  const loc = page.locator(step.selector).first();
  await loc.waitFor({ state: 'visible', timeout: step.timeout ?? 10000 });
  await loc.scrollIntoViewIfNeeded();
  if (recording) await sleep(120);
  const box = await loc.boundingBox();
  if (!box) throw new Error(`no bounding box for ${step.selector}`);
  return { loc, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function clickAt(x, y) {
  await moveTo(x, y);
  if (recording) await sleep(140);
  const t = recording ? now() : 0;
  await page.mouse.down();
  await sleep(recording ? 70 : 0);
  await page.mouse.up();
  if (recording) timeline.clicks.push({ t, x, y });
  return t;
}

const termWrite = (data) => page.evaluate((d) => window.termWrite(d), data);

// Type a command into the terminal, run it for real, and stream its output in as it arrives.
async function runCommand(step) {
  if (!term) throw new Error('"run" needs a top-level "terminal" section in the storyboard');
  for (const ch of step.command) {
    await termWrite(ch);
    if (recording) await sleep(30 + rand() * 50);
  }
  if (recording) await sleep(350);
  await termWrite('\r\n');
  const env = { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1', CLICOLOR_FORCE: '1',
    COLUMNS: String(term.cols), LINES: String(term.rows) };
  // `script` gives the command a real terminal, so tools keep their colours and progress bars.
  const sized = `stty cols ${term.cols} rows ${term.rows} 2>/dev/null; ${step.command}`;
  const hasScript = spawnSync('script', ['--version']).status === 0 || process.platform === 'darwin';
  const child = !hasScript ? spawn('sh', ['-c', step.command], { cwd: term.cwd, env })
    : process.platform === 'darwin' ? spawn('script', ['-q', '/dev/null', 'sh', '-c', sized], { cwd: term.cwd, env })
    : spawn('script', ['-qfec', sized, '/dev/null'], { cwd: term.cwd, env });
  let tail = '', chain = Promise.resolve();
  let lastOutput = performance.now();
  const IDLE = 1500;
  // Waiting on a silent command is dead air: cut any silence down to 1.5 seconds.
  const cutIdle = () => {
    const gap = performance.now() - lastOutput;
    if (recording && term.cutIdle !== false && gap > IDLE) skew += (gap - IDLE) / 1000;
    lastOutput = performance.now();
  };
  const feed = (buf) => {
    cutIdle();
    const text = buf.toString('utf8');
    tail = (tail + text).slice(-4);
    chain = chain.then(() => termWrite(text)).catch(() => {});
  };
  child.stdout.on('data', feed);
  child.stderr.on('data', feed);
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`command timed out: ${step.command}`)); },
      step.timeout ?? 120000);
    child.on('error', reject);
    child.on('close', (c) => { clearTimeout(timer); resolve(c); });
  });
  cutIdle();
  await chain;
  if (code !== 0 && !step.allowFail) throw new Error(`command exited with code ${code}: ${step.command}`);
  await termWrite((tail && !tail.endsWith('\n') ? '\r\n' : '') + term.promptText);
}

const zoomOf = (step) =>
  step.zoom === false ? 0 : typeof step.zoom === 'number' ? step.zoom : DEFAULT_ZOOM;

async function run(step) {
  const pause = step.pause ?? (recording ? 650 : 0);
  switch (step.action) {
    case 'goto':
      await page.goto(resolveUrl(step.url), { waitUntil: 'load' });
      break;
    case 'click': {
      const { x, y } = await target(step);
      const t = await clickAt(x, y);
      if (recording) timeline.focus.push({ t0: t, t1: t, x, y, zoom: zoomOf(step) });
      break;
    }
    case 'type': {
      const { x, y } = await target(step);
      const t = await clickAt(x, y);
      if (step.clear) {
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.press('Backspace');
      }
      if (recording) await sleep(180);
      for (const ch of step.text) {
        await page.keyboard.type(ch);
        if (recording) await sleep(38 + rand() * 55);
      }
      if (recording) timeline.focus.push({ t0: t, t1: now(), x, y, zoom: zoomOf(step) });
      break;
    }
    case 'press':
      await page.keyboard.press(step.key);
      break;
    case 'hover': {
      const { x, y } = await target(step);
      await moveTo(x, y);
      if (recording && step.zoom) {
        const t = now();
        timeline.focus.push({ t0: t, t1: t + pause / 1000, x, y, zoom: zoomOf(step) });
      }
      break;
    }
    case 'scroll': {
      if (step.selector) {
        await page.locator(step.selector).first().evaluate((el) =>
          el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        await sleep(recording ? 700 : 50);
      } else {
        // One smooth scroll in the page: per-event wheel input stalls on heavy pages.
        await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), step.y ?? 400);
        await sleep(recording ? 800 : 50);
      }
      break;
    }
    case 'run':
      await runCommand(step);
      break;
    case 'wait':
      if (step.selector) {
        await page.locator(step.selector).first()
          .waitFor({ state: 'visible', timeout: step.timeout ?? 15000 });
      }
      await sleep(step.ms ?? 0);
      break;
    default:
      throw new Error(`unknown action "${step.action}"`);
  }
  if (pause) await sleep(pause);
}

function setCaption(text) {
  const t = now();
  const last = timeline.captions[timeline.captions.length - 1];
  if (last && last.t1 == null) last.t1 = t;
  if (text) timeline.captions.push({ t0: t, t1: null, text });
}

let stepLabel = 'launch';
try {
  // Setup runs before the camera rolls: sign-in, seeding data, navigation.
  const setup = [{ action: 'goto', url: board.url }, ...(board.setup || [])];
  for (const [i, step] of setup.entries()) {
    stepLabel = `setup step ${i} (${step.action} ${step.selector || step.url || ''})`;
    await run(step);
  }
  await page.mouse.move(mouse.x, mouse.y);
  if (term) {
    await page.evaluate((rows) => window.termInit(rows), term.rows);
    await termWrite(term.promptText);
  }
  await sleep(400);
  timeline.url = term ? (term.title || `${path.basename(term.cwd)} — terminal`) : page.url();
  // Follow in-app navigation so the address bar in the video stays current.
  page.on('framenavigated', (frame) => {
    if (recording && frame === page.mainFrame()) timeline.urls.push({ t: now(), url: frame.url() });
  });

  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    if (t0 === null) t0 = performance.now();
    const file = `${String(timeline.frames.length).padStart(6, '0')}.jpg`;
    timeline.frames.push({ t: now(), file });
    writes.push(fs.promises.writeFile(path.join(rawDir, file), Buffer.from(f.data, 'base64')));
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg', quality: 92, maxWidth: vw * DPR, maxHeight: vh * DPR, everyNthFrame: 1,
  });
  // The first frame starts the clock.
  for (let i = 0; i < 100 && t0 === null; i++) await sleep(20);
  if (t0 === null) throw new Error('browser produced no frames');
  recording = true;
  timeline.cursor.push({ t: 0, x: mouse.x, y: mouse.y });
  await sleep(board.leadIn ?? 700);

  for (const [i, step] of board.steps.entries()) {
    stepLabel = `step ${i} (${step.action} ${step.selector || step.url || ''})`;
    if (step.caption !== undefined) setCaption(step.caption);
    await run(step);
  }
  await sleep(board.leadOut ?? 1200);
  timeline.duration = now();
  setCaption('');
  recording = false;
  await cdp.send('Page.stopScreencast');
  await Promise.all(writes);
  // Frames captured inside a cut carry times later than what follows; drop them.
  let limit = Infinity;
  timeline.frames = timeline.frames.reverse().filter((f) => f.t <= limit && ((limit = f.t), true)).reverse();
} catch (err) {
  const shot = path.join(outDir, 'failure.png');
  await page.screenshot({ path: shot }).catch(() => {});
  await browser.close();
  die(`demoflick: failed at ${stepLabel}\n  ${err.message.split('\n')[0]}\n  screenshot: ${shot}`);
}

await browser.close();
fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify(timeline));
const rel = path.relative(process.cwd(), outDir);
const shown = rel && !rel.startsWith('..') ? rel : outDir;
const fpsSeen = timeline.frames.length / timeline.duration;
console.log(
  `recorded ${timeline.duration.toFixed(1)}s, ${timeline.frames.length} frames, ` +
  `${timeline.clicks.length} clicks -> ${shown}`);
// A static page legitimately sends few frames; slow cursor sampling means the browser is struggling.
const cur = timeline.cursor;
const moveDt = cur.length > 20 ? (cur[cur.length - 1].t - cur[0].t) / cur.length : 0;
if (DPR === 2 && fpsSeen < 12 && moveDt > 0.08) {
  console.log('note: this page renders slowly at 2x capture, so motion may look choppy.\n' +
    '  Add "scale": 1 to the storyboard and record again.');
}
