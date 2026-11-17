---
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

I want a demo GIF of signing up to my app for the README. Write the demoflick
storyboard to `demo/storyboard.json`. Don't run anything: the app isn't running
on this machine.

Details about the app:
- It runs at http://localhost:3000; the sign-up page is /signup.
- The form has `#email`, `#password` and a button with the text "Create account".
- After signing up, a dashboard loads with `[data-testid=welcome]`.
- The password for the demo account is in the DEMO_PASSWORD environment variable.
