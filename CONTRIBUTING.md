# Contributing to Bastion

Thanks for helping make home networks a little less leaky.

## Ground rules

1. **Never fake data.** If something cannot be measured from this computer, the app says
   `unknown` and explains how the user can find out. Mock data lives only in
   `renderer/js/mock-api.js`, which is used for the browser preview and nothing else.
2. **Never touch settings silently.** Read-only checks need no admin rights. Anything that changes
   the computer or the router is a guided fix: clear steps plus a button that opens the right
   settings page. The user always makes the change.
3. **Never send data off the machine** except the hosts listed in the README's Privacy section.
   Adding a new outbound host needs a strong reason and an update to that section.
4. **Respect the contract.** `docs/CONTRACT.md` defines the module boundaries, the `window.bastion`
   IPC surface and every data type. Change the contract first, then the code, in the same pull request.
5. **Both platforms.** Every engine function works on Windows 10/11 and macOS 13+, or returns
   `{ supported: false, reason }` for what it cannot fill.

## Setup

```bash
git clone https://github.com/<owner>/bastion.git
cd bastion
npm ci
npm start          # run the desktop app
npm run dev        # same, with DevTools
npm run preview    # renderer only, in a browser at http://127.0.0.1:5174 (mock data)
npm run check      # syntax-check every .js file
```

You need Node.js 24 or newer.

## Code style

- `engine/` and `agents/`: CommonJS, `'use strict'`, Node built-ins only, no native addons.
- `renderer/js/`: ES modules, no frameworks, no remote scripts or styles (the app works offline).
- Shell out with `child_process.execFile` and a timeout (default 8 s). Never build shell strings.
- Parse command output defensively. Engine functions resolve with data and collect problems in an
  `errors: string[]` field instead of throwing.
- Two-space indent, single quotes, semicolons, trailing commas in multi-line literals.
- UI copy and comments in English. Plain language over jargon: "Your provider can reach your router"
  beats "TR-069 CWMP endpoint exposed".
- Use the design tokens from `renderer/styles/` (the "Uplink" visual language) rather than raw colors.
- Respect `prefers-reduced-motion` in anything animated.

## Pull requests

- Keep them focused. One fix or feature per pull request.
- Run `npm run check` and start the app on at least one platform before opening the PR.
- Describe what you tested and on which OS. If a check's result depends on router hardware,
  name the router model you tested with.
- New security checks must include the exact evidence shown to the user and a fix with concrete steps.
- Screenshots or a short screen recording for UI changes.

## Reporting bugs

Use the bug report template. For security issues in Bastion itself, follow `SECURITY.md` instead.
