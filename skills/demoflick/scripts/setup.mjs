#!/usr/bin/env node
// demoflick setup: install Playwright, its Chromium and (if needed) ffmpeg
// into a folder that survives plugin updates. Safe to run again.
//
//   node setup.mjs [--with-deps]
//
// --with-deps also installs Chromium's system libraries (Linux, needs sudo); CI uses it.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { depsDir } from './lib.mjs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (label, cmd, args, opts = {}) => {
  console.log(`demoflick: ${label}…`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) {
    console.error(`demoflick setup: ${label} failed (see the output above).`);
    process.exit(1);
  }
};

fs.mkdirSync(depsDir, { recursive: true });
const pkg = path.join(depsDir, 'package.json');
if (!fs.existsSync(pkg)) {
  fs.writeFileSync(pkg, JSON.stringify({ name: 'demoflick-deps', private: true }, null, 2) + '\n');
}

const deps = ['playwright@^1.48.0'];
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
if (!hasFfmpeg) deps.push('ffmpeg-static@^5.2.0');

run(`installing ${deps.join(', ')} into ${depsDir}`, npm, ['install', '--no-audit', '--no-fund', ...deps], { cwd: depsDir });
if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD) {
  console.log('demoflick: PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set, so Chromium was not downloaded.');
} else {
  const withDeps = process.argv.includes('--with-deps') ? ['--with-deps'] : [];
  run('downloading Chromium for Playwright', process.execPath,
    [path.join(depsDir, 'node_modules', 'playwright', 'cli.js'), 'install', ...withDeps, 'chromium']);
}
console.log(`demoflick: ready${hasFfmpeg ? '' : ' (using a bundled ffmpeg)'}`);
