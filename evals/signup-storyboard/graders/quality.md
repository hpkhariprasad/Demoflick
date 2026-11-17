---
type: llm
weight: 3
---

Judge the storyboard in `demo/storyboard.json` (and the final message). Pass only if all hold:

1. It is valid JSON in demoflick's format: a top-level `url` and a `steps` list whose actions are among goto, click, type, press, hover, scroll, wait, run.
2. It uses the selectors given (`#email`, `#password`, the "Create account" button, `[data-testid=welcome]`) rather than invented ones.
3. The password is written as `${env:DEMO_PASSWORD}`, never as a literal value.
4. After clicking "Create account" it waits for `[data-testid=welcome]` so the payoff is on screen.
5. Captions, if present, describe a benefit to the user rather than narrating clicks, and there are no more than about five.
6. The response does not claim the demo was recorded or show made-up output.
