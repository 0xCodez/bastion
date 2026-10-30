# Security policy

Bastion is a security tool, so bugs in Bastion itself are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue** for a vulnerability.

Use GitHub's private reporting instead: open the repository's **Security** tab and choose
**Report a vulnerability**. Include:

- the Bastion version and your OS (Windows / macOS, version, CPU architecture),
- what an attacker can do and what they need (local user, same network, malicious web page, malicious AI response, ...),
- steps to reproduce or a proof of concept,
- any suggested fix.

You should get an acknowledgement within 7 days. We will keep you posted while a fix is prepared and
credit you in the release notes unless you prefer not to be named.

## Supported versions

Only the latest release receives security fixes. Bastion is pre-1.0; please update before reporting.

## What is in scope

- Anything that lets a web page, a network peer, a router response or an AI model response run code,
  read files, or call privileged IPC in the app.
- Leaks of stored AI API keys (keys are encrypted at rest with the operating system keychain via
  Electron `safeStorage`) or of network data to any host other than the ones listed in the README's
  Privacy section.
- Bastion changing a setting on your computer or router without your explicit approval.
- Command injection through values parsed from system tools (`netsh`, `ipconfig`, `arp`, `airport`, ...).
- Checks that report "OK" when the risk is demonstrably present (false reassurance).

## Out of scope

- Vulnerabilities in your router, ISP equipment or other devices. Bastion helps you find some of
  them; please report those to the vendor.
- Findings that require an already compromised machine or administrator access.
- Unsigned builds triggering SmartScreen or Gatekeeper warnings (signed builds are on the roadmap).

## Design rules that keep Bastion safe

- The renderer runs sandboxed with context isolation and no Node access; the only bridge is a small,
  typed `window.bastion` API (see `docs/CONTRACT.md`).
- System tools are run with `execFile` and fixed argument lists, never through a shell string.
- Bastion never logs in to your router, never tries passwords and never changes settings on its own.
  AI agents can only answer and suggest steps; they cannot change anything themselves.
