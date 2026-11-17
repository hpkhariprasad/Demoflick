#!/usr/bin/env node
// demoflick render: turn a recording into finished videos.
//
//   node render.mjs [demoflick-out] [--formats landscape,vertical,square,gif] [--theme aurora] [--fps 30]
//
// Outputs in the recording folder:
//   demo.mp4           1920x1080, for X, LinkedIn and YouTube
//   demo-vertical.mp4  1080x1920, for Instagram Reels, Shorts and TikTok
//   demo-square.mp4    1080x1080, for Instagram and LinkedIn feed posts
//   demo.gif           looping GIF for a README
//   contact-*.jpg      a sheet of stills, for checking the result

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPlaywright, ffmpegPath, parseArgs, die } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const dir = path.resolve(args._[0] || 'demoflick-out');
const timelineFile = path.join(dir, 'timeline.json');
if (!fs.existsSync(timelineFile)) die(`demoflick: no recording in ${dir} (run record.mjs first)`);
const tl = JSON.parse(fs.readFileSync(timelineFile, 'utf8'));
const formats = String(args.formats || 'landscape,vertical,gif').split(',').map((f) => f.trim());
for (const f of formats) {
  if (!['landscape', 'vertical', 'square', 'gif'].includes(f)) die(`demoflick: unknown format "${f}"`);
}
// Frames are independent, so split each video across several browser pages.
const workers = Math.max(1, Math.min(Number(args.workers) || Math.min(4, os.cpus().length), 8));
const fps = Number(args.fps || 30);
const theme = args.theme || 'aurora';
if (!['aurora', 'sunset', 'mint', 'slate'].includes(theme)) die(`demoflick: unknown theme "${theme}"`);
const ffmpeg = ffmpegPath();
const here = path.dirname(fileURLToPath(import.meta.url));

// Camera path: ease in on each action, hold, then pan to the next or pull back.
function buildCamera(layout) {
  const { width: vw, height: vh } = tl.viewport;
  const IN = 0.8, LEAD = 0.15, HOLD = 1.0, OUT = 0.8, GAP = 1.2;
  // A terminal reads from the left, so a cropped view starts there.
  const kf = [{ t: 0, cx: tl.chrome === 'terminal' ? 0 : vw / 2, cy: vh / 2, z: 1 }];
  const focus = tl.focus.filter((f) => f.zoom > 0);
  focus.forEach((e, i) => {
    const z = layout === 'vertical' ? 1 + (e.zoom - 1) * 0.45 : e.zoom;
    const last = kf[kf.length - 1];
    const start = Math.max(last.t, e.t0 - IN);
    if (start > last.t) kf.push({ ...last, t: start });
    const arrive = Math.max(e.t0 - LEAD, start + 0.4);
    kf.push({ t: arrive, cx: e.x, cy: e.y, z });
    const next = focus[i + 1];
    const holdEnd = Math.max(arrive, e.t1, Math.min(e.t1 + HOLD, next ? next.t0 - IN : Infinity));
    if (holdEnd > arrive) kf.push({ t: holdEnd, cx: e.x, cy: e.y, z });
    if (!next || next.t0 - IN - holdEnd > GAP) kf.push({ t: holdEnd + OUT, cx: e.x, cy: e.y, z: 1 });
  });
  return kf;
}

function run(cmdArgs) {
  const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', ...cmdArgs], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) die('demoflick: ffmpeg failed');
}

const SIZES = { landscape: [1920, 1080], vertical: [1080, 1920], square: [1080, 1080] };
const introD = tl.intro ? (tl.intro.duration ?? 2.2) : 0;
const outroD = tl.outro ? (tl.outro.duration ?? 2.8) : 0;
const totalDuration = introD + tl.duration + outroD;

async function renderSegment(browser, layout, from, to, outFile, progress) {
  const [W, H] = SIZES[layout];
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(here, 'compositor.html')).href);
  await page.evaluate((cfg) => window.init(cfg), {
    W, H, layout, theme, timeline: tl, platform: process.platform,
    keyframes: buildCamera(layout),
    framesUrl: pathToFileURL(path.join(dir, 'raw')).href + '/',
  });
  const enc = spawn(ffmpeg, [
    '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', outFile,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => {
    enc.on('close', (code) => (code === 0 ? res() : rej(new Error('ffmpeg encode failed'))));
    enc.on('error', rej);
  });
  for (let i = from; i < to; i++) {
    await page.evaluate((T) => window.renderFrame(T), i / fps);
    const buf = await page.screenshot({ type: 'jpeg', quality: 93 });
    if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once('drain', r));
    progress();
  }
  enc.stdin.end();
  await done;
  await page.close();
}

async function renderVideo(browser, layout, outFile) {
  const total = Math.ceil(totalDuration * fps);
  const n = Math.min(workers, Math.max(1, Math.floor(total / (fps * 2))));
  const parts = Array.from({ length: n }, (_, k) => ({
    from: Math.round((k * total) / n),
    to: Math.round(((k + 1) * total) / n),
    file: `${outFile}.part${k}.mp4`,
  }));
  let doneFrames = 0;
  const progress = () => {
    if (++doneFrames % 30 === 0) process.stdout.write(`\r  ${layout}: ${Math.round((doneFrames / total) * 100)}%   `);
  };
  try {
    await Promise.all(parts.map((p) => renderSegment(browser, layout, p.from, p.to, p.file, progress)));
    // Each part starts on a keyframe, so they join without re-encoding.
    const list = `${outFile}.parts.txt`;
    fs.writeFileSync(list, parts.map((p) => `file '${p.file.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', outFile]);
    fs.rmSync(list, { force: true });
  } finally {
    for (const p of parts) fs.rmSync(p.file, { force: true });
  }
  process.stdout.write(`\r  ${layout}: done -> ${outFile}\n`);
}

function contactSheet(video, out) {
  const every = Math.max(1, totalDuration / 12);
  run(['-i', video, '-vf', `fps=1/${every.toFixed(3)},scale=-2:360,tile=4x3`, '-frames:v', '1', '-q:v', '3', out]);
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: process.env.DEMOFLICK_CHROMIUM || undefined });
const landscape = path.join(dir, 'demo.mp4');
const vertical = path.join(dir, 'demo-vertical.mp4');

if (formats.includes('landscape') || formats.includes('gif')) {
  await renderVideo(browser, 'landscape', landscape);
  contactSheet(landscape, path.join(dir, 'contact-landscape.jpg'));
}
if (formats.includes('vertical')) {
  await renderVideo(browser, 'vertical', vertical);
  contactSheet(vertical, path.join(dir, 'contact-vertical.jpg'));
}
if (formats.includes('square')) {
  const square = path.join(dir, 'demo-square.mp4');
  await renderVideo(browser, 'square', square);
  contactSheet(square, path.join(dir, 'contact-square.jpg'));
}
await browser.close();

if (formats.includes('gif')) {
  const gif = path.join(dir, 'demo.gif');
  const width = Number(args['gif-width'] || 880);
  run(['-i', landscape, '-vf',
    `fps=15,scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];` +
    '[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle', gif]);
  const mb = fs.statSync(gif).size / 1e6;
  console.log(`  gif: done -> ${gif} (${mb.toFixed(1)} MB)`);
  if (mb > 10) console.log('  note: over 10 MB; shorten the storyboard or pass --gif-width 720');
}
