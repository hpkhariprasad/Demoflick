#!/usr/bin/env node
// demoflick save-session: open a browser window, let the user sign in by hand,
// then save the signed-in state for storyboards to reuse with "session".
//
//   node save-session.mjs http://localhost:3000/login session.json

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { loadPlaywright, die } from './lib.mjs';

const [url, out = 'session.json'] = process.argv.slice(2);
if (!url) die('usage: node save-session.mjs <sign-in url> [session.json]');

const { chromium } = loadPlaywright();
const browser = await chromium.launch({
  headless: false,
  executablePath: process.env.DEMOFLICK_CHROMIUM || undefined,
}).catch((err) => die(`demoflick: could not open a browser window (${err.message.split('\n')[0]}).\n` +
  '  Run this on a machine with a display, or sign in from the storyboard\'s "setup" with "saveSession".'));
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();
await page.goto(url);

console.log('Sign in in the browser window, then press Enter here to save.');
const rl = readline.createInterface({ input: process.stdin });
await new Promise((resolve) => {
  rl.once('line', resolve);
  browser.on('disconnected', resolve);
});
rl.close();
if (!browser.isConnected()) die('demoflick: the browser was closed before saving; nothing was saved.');

const file = path.resolve(out);
await context.storageState({ path: file });
fs.chmodSync(file, 0o600);
await browser.close();
console.log(`saved -> ${file}\nAdd "session": "${out}" to the storyboard. Keep this file out of git: it signs you in.`);
