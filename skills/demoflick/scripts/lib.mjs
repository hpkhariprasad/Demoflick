import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function die(msg) {
  console.error(msg);
  process.exit(1);
}

export function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    die('demoflick: Playwright is not installed.\n' +
      '  Run in the skill folder: npm install && npx playwright install chromium');
  }
}

export function ffmpegPath() {
  if (spawnSync('ffmpeg', ['-version']).status === 0) return 'ffmpeg';
  try {
    return require('ffmpeg-static');
  } catch {
    die('demoflick: ffmpeg not found.\n' +
      '  Install ffmpeg, or run in the skill folder: npm install ffmpeg-static');
  }
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
      else { out[a.slice(2)] = next; i++; }
    } else out._.push(a);
  }
  return out;
}
