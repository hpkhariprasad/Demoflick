---
name: demoflick
description: Record a polished demo video of a real web app or command-line tool, with a smooth cursor, automatic zoom on each action and captions, exported as a README GIF, a 16:9 video and a 9:16 vertical video for Reels and Shorts. Use when the user asks for a demo video, demo GIF, terminal recording, product walkthrough, launch video, or a recording of their app or CLI for a README or social media.
---

# demoflick

Records the user's real web app in a browser, or their command-line tool in a
terminal, and renders a finished demo. The recording is driven from a
storyboard you write, so the result is repeatable: change a step,
run again, get a new video.

Scripts live in `scripts/` next to this file. They need Node 18+, Playwright and
ffmpeg. If a script reports one missing, run `npm install` in this skill folder
(then `npx playwright install chromium` if the browser is missing).

## Workflow

For a command-line tool, skip to "Recording a terminal" below.

1. **Get the app running.** Find the dev command in the project (package.json,
   README, Makefile) and start it in the background. Note the URL. A static
   HTML file works too: use its path as the URL.

2. **Choose the story.** A good demo shows one outcome in 15 to 30 seconds:
   the single flow that makes someone want the product. Ask the user which
   flow if it is not obvious from the README. Do not tour every feature.

3. **Find selectors by looking at the real page.** Open the app with Playwright,
   take a screenshot, and read the DOM for each element you plan to use. Never
   guess a selector. Prefer stable ones: `#id`, `[data-testid=...]`,
   `role=button[name="Save"]`, `text=Sign in`.

4. **Write the storyboard** as JSON (format below). Put sign-in and data
   seeding in `setup` so they happen before recording starts. Use realistic
   sample data, never real credentials or personal data.

5. **Record, then render:**

   ```bash
   node scripts/record.mjs storyboard.json --out demoflick-out
   node scripts/render.mjs demoflick-out
   ```

   If recording fails it names the step and saves `failure.png`. Look at it,
   fix the selector or add a `wait` step, and record again.

6. **Check the result yourself before reporting.** Open
   `demoflick-out/contact-landscape.jpg` and `contact-vertical.jpg`. Confirm
   that every click landed on its target, captions match what is on screen,
   nothing is cut off, and no loading spinner or empty state is on show. Fix
   the storyboard and re-run until it is right.

7. **Hand over** `demo.mp4`, `demo-vertical.mp4` and `demo.gif`, and say what
   each is for. Offer to add the GIF to the README. Delete `demoflick-out/raw`
   when done; it is large.

## Storyboard format

```json
{
  "title": "Shown above the video in the vertical format",
  "url": "http://localhost:3000",
  "viewport": { "width": 1280, "height": 800 },
  "setup": [
    { "action": "type", "selector": "#email", "text": "demo@example.com" },
    { "action": "click", "selector": "text=Sign in" },
    { "action": "wait", "selector": "#dashboard" }
  ],
  "steps": [
    { "action": "click", "selector": "text=New project", "caption": "Start a project in one click" },
    { "action": "type", "selector": "#name", "text": "Launch plan" },
    { "action": "press", "key": "Enter" },
    { "action": "wait", "selector": ".project-card", "ms": 600 }
  ]
}
```

| Action | Fields | Notes |
|---|---|---|
| `goto` | `url` | Navigate mid-demo. The first page comes from the top-level `url`. |
| `click` | `selector` | Moves the cursor there, clicks, zooms in. |
| `type` | `selector`, `text`, `clear` | Clicks the field, then types like a person. |
| `press` | `key` | A key such as `Enter` or `Escape`. |
| `hover` | `selector` | Moves the cursor without clicking. |
| `scroll` | `y` or `selector` | Scroll by pixels, or bring an element to the centre. |
| `wait` | `ms`, `selector` | Wait for time, an element, or both. |

Every step also accepts:

- `caption`: text shown from this step until the next caption. `""` clears it.
- `zoom`: zoom level for this step (default 1.6), or `false` to stay wide.
- `pause`: milliseconds to rest after the step (default 650).

For a phone-sized demo, set `"viewport": { "width": 390, "height": 844 }`. The
vertical video then shows the whole screen instead of cropping a wide page.

Top-level options: `zoom` (default level), `colorScheme` (`light` or `dark`),
`leadIn` and `leadOut` (milliseconds of stillness at each end), and `scale`
(capture resolution: `2` by default, `1` for heavy pages).

## Recording a terminal

Add a `terminal` section and use `run` steps. Each command is typed out, then
run for real in the project folder, and its output appears as it arrives,
with colours and progress bars.

```json
{
  "title": "mytool in 20 seconds",
  "terminal": { "cwd": ".", "prompt": "mytool" },
  "steps": [
    { "action": "run", "command": "mytool init demo", "caption": "Start a project in one command" },
    { "action": "run", "command": "mytool build", "caption": "Builds in seconds" }
  ]
}
```

- `cwd` is relative to the storyboard file. `prompt` is the label shown before
  each command.
- Silences longer than 1.5 seconds are cut, so a slow install does not drag.
  Set `"cutIdle": false` in `terminal` to keep real timing.
- A command that exits with an error stops the recording. Add
  `"allowFail": true` to a step where failure is the point.
- **These commands really run.** Use only commands that are safe to run in the
  user's project: nothing that deletes files, publishes, deploys or needs
  secrets. Try each command yourself first and tidy up anything it creates.
- Keep lines under 75 characters; the vertical video shows about 55.
- Full-screen interactive programs (editors, `top`, prompts that wait for
  keys) are not supported.

## Problems you will meet

- **Dropdown menus that open on hover.** Clicking the trigger can close the
  menu again. Use a `hover` step on the trigger with `"pause": 900`, then
  `click` the item. Open the menu yourself first and read its real items: they
  often differ from links with similar text elsewhere on the page.
- **"renders slowly at 2x capture" after recording.** The page has heavy
  animation or effects. Add `"scale": 1` to the storyboard and record again.
- **A step times out.** Look at `failure.png`. The usual causes are a selector
  that matches nothing on this page, or content that has not loaded: add a
  `wait` step on the element first.
- **Text in a non-Latin script looks wrong.** The machine lacks a font for
  that script. Install one (for example a Noto font) and record again.

## Render options

```bash
node scripts/render.mjs demoflick-out --theme sunset --formats landscape,gif
```

- `--theme`: `aurora` (default), `sunset`, `mint`, `slate`. Pick one that
  contrasts with the app.
- `--formats`: any of `landscape`, `vertical`, `gif`.
- `--gif-width`: GIF width in pixels (default 880). Lower it if the GIF is
  over 10 MB.

## What makes a demo good

- **Captions state the benefit, not the action.** "Share with your team in one
  click", not "Click the share button". Five to seven words. Three to five
  captions in total.
- **Start on a populated screen.** Seed data in `setup`. Empty states make a
  product look unfinished.
- **Wait for results.** After an action that loads something, add a `wait` on
  the element that appears, so the video shows the payoff.
- **Stay wide for navigation.** Set `"zoom": false` on clicks whose result
  appears elsewhere on the page.
- **End on the outcome.** The last second should show the finished result,
  with a longer `pause`.
