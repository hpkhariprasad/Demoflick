import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function die(msg) {
  console.error(msg);
  process.exit(1);
}

// Plugin managers replace the skill folder on update, so dependencies live in
// a stable folder of their own. setup.mjs installs them there.
export const depsDir = process.env.DEMOFLICK_HOME
  || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'demoflick');

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const SETUP = `node "${path.join(scriptsDir, 'setup.mjs')}"`;

// Look next to the skill, in the shared deps folder, then in the user's project.
function load(name) {
  const bases = [import.meta.url, path.join(depsDir, 'package.json'), path.join(process.cwd(), 'package.json')];
  for (const base of bases) {
    try {
      return createRequire(base)(name);
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND') throw err;
    }
  }
  return null;
}

export function loadPlaywright() {
  const pw = load('playwright');
  if (!pw) die(`demoflick: Playwright is not installed. Run once:\n  ${SETUP}`);
  return pw;
}

export function ffmpegPath() {
  if (spawnSync('ffmpeg', ['-version']).status === 0) return 'ffmpeg';
  const bundled = load('ffmpeg-static');
  if (bundled) return bundled;
  die(`demoflick: ffmpeg not found. Install ffmpeg, or run once:\n  ${SETUP}`);
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
