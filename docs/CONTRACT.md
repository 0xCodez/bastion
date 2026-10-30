# Bastion internal contract

This file is the source of truth for how the pieces of the app talk to each other. Every module is built against it.

## Layout

```
electron/main.js        Window, menu, IPC handlers (thin: delegates to engine/ and agents/)
electron/preload.js     contextBridge -> window.bastion (the only renderer <-> main surface)
engine/*.js             Network engine. CommonJS, Node built-ins only, no native addons.
engine/icons.js         App icons from installed applications. Main-process only (uses Electron's app/nativeImage/net).
electron/support.js     Tips (Beyond Apps tip jar) and feedback. Main-process only; registers its own `support:*` IPC.
agents/*.js             AI providers + key storage. CommonJS.
renderer/index.html     App shell. ES modules, importmap for three.
renderer/styles/*.css   Design tokens, layout, glow kit
renderer/js/*.js        UI modules (ES modules)
renderer/js/mock-api.js In-browser stand-in for window.bastion (used when not running in Electron)
scripts/*.js            Dev scripts (preview server, checks, engine smoke test)
```

Renderer never touches Node. Main never touches the DOM.

## Platform rules (engine)

- Windows 10/11 and macOS 13+. Every function must work on both or return `{ supported: false, reason }` for the field it cannot fill.
- Shell out only with `child_process.execFile` (never `exec` with interpolated strings). Timeouts on every call (default 8 s).
- Parse command output defensively; never throw to the renderer. Engine functions resolve with data, and put problems in an `errors: string[]` field.
- No admin rights required for anything read-only. Anything that would need admin is a "guided fix" (steps + a button that opens the right settings page or the router admin page), never a silent change.
- Never send anything off the machine except: the speed test (Cloudflare speed endpoints), the public IP lookup (`https://api.ipify.org?format=json`), AI requests the user starts with their own key or through their own subscription CLI (below), the one-time provider icon download (below), and the tips and feedback requests the user starts on the Support screen (below).
- Provider icon download: only for a provider whose desktop app is not installed AND that has a saved API key, `engine/icons.js` fetches that provider's site icon once (`https://claude.ai`, `https://chatgpt.com`, `https://grok.com`: `/apple-touch-icon.png`, else `/favicon.ico`; 4 s timeout, PNG/JPEG/ICO only, max 512 KB) and keeps it in `<userData>/provider-icons.json`. A failed download is retried at most once a day.

## window.bastion (preload)

All methods return Promises. Event subscriptions return an unsubscribe function.

```js
bastion.platform                       // 'win32' | 'darwin' | 'browser-mock'
bastion.version                        // app version string

bastion.network.overview()   -> NetworkOverview
bastion.network.devices()    -> Device[]
bastion.network.connections()-> Connection[]          // this computer's live connections
bastion.network.scan()       -> ScanReport            // runs all checks
bastion.network.onScanProgress(cb: (p: ScanProgress) => void) -> unsubscribe

bastion.wifi.info()          -> WifiInfo
bastion.wifi.survey()        -> WifiSurvey

bastion.dns.status()         -> DnsStatus

bastion.speed.run()          -> SpeedResult
bastion.speed.cancel()       -> void
bastion.speed.onProgress(cb: (p: SpeedProgress) => void) -> unsubscribe

bastion.fix.open(target)     -> { ok: boolean }       // target: 'router-admin' | 'dns-settings' | 'wifi-settings' | 'mac-privacy'
bastion.app.openExternal(url)-> void                  // https only

bastion.agents.providers(opts?: { refresh?: boolean }) -> Provider[] // also detects the subscription CLIs (cached 60 s; 5 s while not ready; refresh: check now)
bastion.agents.setKey(id, key)       -> { ok: boolean, error?: string }   // 'api' providers only
bastion.agents.clearKey(id)          -> { ok: boolean }                    // 'api' providers only
bastion.agents.setModel(id, model)   -> { ok: boolean }                    // 'cli': 'default' = no model flag
bastion.agents.test(id)              -> { ok: boolean, error?: string, model?: string }   // 'cli': re-detects, then "Reply with OK" (same lock and cancel as ask)
bastion.agents.ask(id, question, snapshot) -> AgentAnswer
bastion.agents.cancel(id)            -> { ok: boolean, cancelled?: boolean } // stops a running ask / CLI test (kills a CLI's process tree); the provider stays busy until that call settles

bastion.icons.forProcesses(list: { pid: number, process: string | null }[], opts?: { known?: string[] })
  -> { processes: { [pid]: { exe: string | null, product: string | null, description: string | null } },
       icons: { [exe]: dataURL | null } }   // icons only for executables not in opts.known
bastion.icons.providers()            -> { claude: dataURL | null, openai: dataURL | null, grok: dataURL | null }

bastion.support.tipsProfile()        -> { ok: true, profile: TipsProfile } | { ok: false, error: string }
bastion.support.startTip(req: TipRequest) -> { ok: true, url: string } | { ok: false, error: string }   // also opens the checkout in the browser
bastion.support.sendFeedback(payload: FeedbackPayload) -> { ok: true, via: 'endpoint' | 'email' | 'saved', message: string } | { ok: false, error: string }
bastion.support.systemInfo()         -> { ok: true, system: SystemInfo }   // exactly what "include app version and OS" attaches
```

### Support (`support:*`, electron/support.js)

Ported from Cleanly (`services/tips.ts`, `services/feedback.ts`). Handlers never throw: `{ ok: true, ... }` or `{ ok: false, error }` (a plain sentence). Only Bastion's own `file://` page may call them. Endpoints are constants at the top of `electron/support.js` (empty string = channel off).

- Tips: `GET https://beyond-media.ai/api/tips?creator=beyond-apps` -> profile (presets filtered to min..max, at most 8; currency 3 letters), cached 10 min, concurrent loads share one request. `startTip` validates the amount against the profile (min..max, at most 2 decimals), cleans `name` (60) and `message` (280) of control characters, `POST`s `{ creator, amount, name, message, monthly, returnUrl }`, accepts only an `https:` checkout URL and opens it with `shell.openExternal`. One checkout at a time. 15 s timeout. Card details never touch Bastion (Stripe Checkout in the browser).
- Feedback: validated in main (kind idea|bug|love; message 3..2000 chars after trim, same cap as the textarea; rating integer 1..5 or null; email optional, RFC-ish, max 254). Channel: `FEEDBACK_ENDPOINT` (POST JSON `{ kind, message, rating, email, system, app: 'bastion', version }`, 15 s) if set, else `mailto:contact@beyond-media.ai` with subject `Bastion feedback: <kind>` via `shell.openExternal` (rating, reply-to and system lines first; only the message is shortened until the percent-encoded body is at most 1700 chars, and then the full message is copied to the clipboard); if openExternal fails, or no email is configured, a JSON file in `<userData>/feedback` (result carries `path`; on mail failure the file is revealed). System info is opt-in only: the switch starts off for every kind, bugs just show a hint. One send at a time.
- Privacy: `system` is attached only when `includeSystemInfo` is true and holds only `SystemInfo` (no home directory, user name or host name). Nothing from scans, devices, connections or keys is ever attached.
- Renderer: `renderer/js/views/support.js` (tab "Support", last in the tab bar) with `renderer/styles/views/support.css`. Tip presets / custom amount / one-time or monthly, the live supporter count, a note from the maker; then the feedback form (Idea / Bug / Love segment, star rating, message with Ctrl+Enter, optional email, "Include app version and OS" switch that turns on by itself for bugs until the user touches it, with a preview of exactly what is attached). The mock (`mock-api.js`) sends nothing and opens nothing.

### Icons (`icons:processes`, `icons:providers`)

- Icons are the user's own installed applications' icons, never hand-drawn copies of logos. `null` means unknown: the renderer shows its monogram / coloured dot.
- `forProcesses`: Windows: one PowerShell call per batch of new pids resolves each executable (`Get-Process -Id`), reads its product name and description from the version resource, and extracts a 64 px icon (`PrivateExtractIcons`) only for executables not seen this session. The P/Invoke helper is compiled once into `<userData>/bastion-iconx-<v>.dll` and loaded from there afterwards. Falls back to `app.getFileIcon`. macOS: `ps -o pid=,comm= -p a,b,c`, then the outermost enclosing `.app` bundle (product = bundle name). Executables without their own icon and macOS non-bundle binaries give a `null` icon. Icons and product names are cached by executable path for the session, pid -> path for 5 minutes; a batch whose PowerShell call failed is not cached. The renderer groups connections per executable and names them from `product` (so `claude.exe` of the Claude desktop app and of the Claude Code CLI are two different apps). Never throws.
- `providers`: subscription providers have no icon of their own: `claude-cli` uses `claude`'s and `codex-cli` uses `openai`'s, and a ready one counts as a saved key for (b). (a) the installed desktop app's icon, only when the app is signed by that provider (Anthropic, OpenAI, X.AI). Windows: `%LOCALAPPDATA%\AnthropicClaude\claude.exe`, `%LOCALAPPDATA%\Programs\claude\Claude.exe`, `%LOCALAPPDATA%\Programs\ChatGPT\ChatGPT.exe`, `%LOCALAPPDATA%\Programs\Grok\Grok.exe` with a Valid Authenticode signature whose subject names the vendor, else the Microsoft Store package (`Get-AppxPackage` name matching Claude / ChatGPT / Grok and Publisher naming the vendor; main executable from its `AppxManifest.xml`), all in one PowerShell call. macOS: `Claude.app`, `ChatGPT.app`, `Grok.app` in `/Applications` or `~/Applications` whose `codesign` Developer ID authority names the vendor. A lookup where PowerShell failed is retried (at most once a minute) instead of being kept for the session. (b) only for providers with a saved key: the cached site icon (see Platform rules), decoded and re-encoded as PNG where possible; under 48 px is used only when no larger icon exists. (c) `null`.
- A dark glyph on a transparent background is set on a light rounded plate (like Windows' plated tiles) so it stays visible on dark glass; full-tile icons are returned unchanged.
- The renderer keeps provider icons in the store key `providerIcons` (loaded by `app.js`, reloaded when the set of saved keys changes); Settings, Agents, Home and the titlebar keys indicator read it. Process icons are cached inside the Devices view per executable path (one data URL per program, bounded; the `<img>` nodes are reused across repaints). If `icons:providers` fails, or every provider comes back without an icon, `app.js` asks once more 20 s later.

## Types

```ts
NetworkOverview = {
  hostname: string,
  local: { ip: string, iface: string, mac: string, macRandomized: boolean | null },
  gateway: { ip: string | null, mac: string | null, vendor: string | null },
  publicIp: string | null,
  errors: string[]
}

Device = { ip: string, mac: string, vendor: string | null, randomizedMac: boolean,
           isGateway: boolean, isThisComputer: boolean, hostname: string | null }

Connection = { process: string | null, pid: number | null, protocol: 'tcp'|'udp',
               local: string, remoteIp: string, remotePort: number, state: string | null }

ScanCheckId = 'tr069' | 'upnp' | 'dns-plaintext' | 'admin-default' | 'wps' | 'telnet'
            | 'ssh' | 'web-admin-http' | 'location-map' | 'mac-privacy' | 'wifi-security'
            | 'unknown-devices'

ScanCheck = {
  id: ScanCheckId,
  title: string,                 // plain-language, e.g. "Your provider can reach your router"
  status: 'risk' | 'warn' | 'ok' | 'unknown',
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info',
  evidence: string,              // what we actually observed, e.g. "TCP 192.168.1.1:7547 open"
  fix: { label: string, steps: string[], open?: 'router-admin'|'dns-settings'|'wifi-settings'|'mac-privacy' } | null
}

ScanProgress = { index: number, total: number, id: ScanCheckId, title: string, status?: ScanCheck['status'] }

ScanReport = { startedAt: string, finishedAt: string, score: number /* 0-100 */,
               checks: ScanCheck[], upnpMappings: { protocol, externalPort, internalClient, internalPort, description }[],
               openPorts: { port: number, service: string }[], errors: string[] }

WifiInfo = { supported: boolean, ssid: string | null, bssid: string | null, band: '2.4' | '5' | '6' | null,
             channel: number | null, widthMHz: number | null, rssi: number | null, signalPct: number | null,
             rxMbps: number | null, txMbps: number | null, security: string | null, nomap: boolean | null,
             errors: string[] }

WifiSurvey = { supported: boolean, networks: { ssid: string, bssid: string | null, channel: number, band: string, signalPct: number | null, rssi: number | null }[],
               congestion: { channel: number, band: string, count: number }[],
               current: { channel: number | null, band: string | null },
               recommendation: { channel: number, band: string, reason: string, neighboursNow: number, neighboursThere: number } | null,
               errors: string[] }

DnsStatus = { servers: string[], gatewayIsResolver: boolean, encrypted: boolean | null,
              provider: string | null /* 'Cloudflare' | 'Google' | 'Quad9' | 'ISP / router' | ... */, errors: string[] }

SpeedProgress = { phase: 'ping' | 'download' | 'upload' | 'done', mbps?: number, pingMs?: number, progress: number /* 0-1 */ }
SpeedResult = { pingMs: number, jitterMs: number, downMbps: number, upMbps: number, server: string, at: string, errors: string[] }

Provider = { id: 'claude' | 'openai' | 'grok' | 'claude-cli' | 'codex-cli', name: string, kind: 'api' | 'cli',
             hasKey: boolean,          // 'api': key saved. 'cli': installed and not known to be signed out (usable)
             model: string, models: string[],
             cli?: {                   // 'cli' only
               installed: boolean, ready: boolean /* signed in for sure and not with an API key */,
               version: string | null, loggedIn: boolean | null /* null = unknown until first use */,
               path: string | null, authMethod: string | null, product: 'Claude Code' | 'Codex',
               installCommand: string, loginCommand: string, error: string | null, note: string | null } }
AgentAnswer = { ok: boolean, provider: string, model: string, text: string, error?: string }

TipsProfile = { name: string, tagline: string, currency: string /* 'usd' */, presets: number[], min: number, max: number, supporterCount: number }
TipRequest = { amount: number, monthly: boolean, name?: string, message?: string }
FeedbackPayload = { kind: 'idea' | 'bug' | 'love', message: string, rating: number | null /* 1-5 */, email?: string, includeSystemInfo: boolean }
SystemInfo = { platform: 'win32' | 'darwin' | 'linux', arch: string, osVersion: string, appVersion: string }
```

## Subscription CLIs (`agents/cli.js`)

`claude-cli` ("Claude (my subscription)") and `codex-cli` ("ChatGPT (my subscription)") answer through the official CLI the user is signed in to, billed to their Claude / ChatGPT plan, with no API key. `ask()` returns the same `AgentAnswer` and sends exactly what the API providers get: `prompt.SYSTEM_PROMPT` plus `prompt.buildUserMessage()` (the privacy-minimised snapshot).

- Detection: the executable is looked up on PATH and in the usual install folders (Windows: `%APPDATA%\npm`, `%LOCALAPPDATA%\Programs\…`, `~/.local/bin`, scoop, Volta; macOS: `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.npm-global/bin`, `~/.claude/local`, nvm), because apps started from the Dock or Start menu get a minimal PATH. Version from `--version`. Sign-in: `codex login status`; `claude auth status` (JSON, exit 0 = signed in) only when `claude --help` lists an `auth` command, else unknown until the first answer. Codex models: `codex debug models --bundled` (no refresh from OpenAI). Status checks never contact a provider; every probe runs in its own empty folder.
- Launching: `spawn` without a shell. A Windows `.cmd` shim is resolved to the script it launches and run with `node` (or Electron with `ELECTRON_RUN_AS_NODE=1`); only an unparseable shim runs through `cmd.exe`, and then every argument is checked for cmd metacharacters and refused if it has one. argv holds only fixed flags, a validated model id and Bastion's own paths; the question and snapshot always go on stdin. The child's PATH gets the install folders too. `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` are removed for Claude Code so the subscription login is used.
- No tools: every run (probes included) gets its own folder `<userData>/cli/runs/r-XXXX` (mkdtemp), deleted afterwards; the CLI's cwd is its empty `cwd` subfolder, Bastion's files for that run sit next to it. Claude Code: `claude -p --output-format json --tools "" --disallowedTools "*" --strict-mcp-config --permission-mode dontAsk --setting-sources project --settings <run>/settings.json --disable-slash-commands --no-session-persistence --system-prompt-file <run>/system.txt [--model m]`. `settings.json` is `{"disableAllHooks":true}` and `--setting-sources project` skips `~/.claude/settings.json`, so the user's hooks (shell commands, which tool flags do not stop) and plugins never load; the sign-in is stored apart from settings. The answer is `result` of the JSON (`is_error` -> error). Checked with Claude Code 2.1.314. Codex: `codex exec --json --color never --skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules --sandbox read-only -c approval_policy=never -c web_search=disabled -c features.<shell_tool|unified_exec|code_mode|code_mode_host|multi_agent|multi_agent_v2|apps|plugins|hooks|browser_use|sleep_tool|goals|tool_suggest|…>=false [-m m] -`. Codex ignores feature names it does not know, so before the first ask per Codex binary and version Bastion runs `codex features list` with the same overrides and refuses to ask unless `shell_tool` and `code_mode_host` are listed as false and every other listed feature is false (`unified_exec` is exempt: config cannot switch it off on 0.153.4, and it only matters while `shell_tool` is on). Bastion's instructions lead the stdin prompt (Codex has no text system-prompt flag); the answer is the last `agent_message` of a run that sent `turn.completed`, no `turn.failed` and exited 0. Because `--ignore-user-config` also drops the model, the top-level `model` from the user's `~/.codex/config.toml` is passed with `-m` when the user picked "default".
- Timeout 120 s per ask; `cancel(id)` and the timeout kill the whole process tree (`taskkill /T /F` on Windows, the process group on macOS), also when the direct child already exited, and the call resolves at most 5 s later even if the pipes stay open. On app quit (`before-quit`) `agents.shutdown()` cancels every request and kills every CLI still running. Errors are plain sentences: not installed (with the npm install command), not signed in (with `claude auth login` / `codex login`), plan usage limit reached, model rejected, Codex version with tools Bastion cannot switch off.
- Renderer: Settings shows a "Use your subscription" block above the API keys (status, Test, install / sign-in command with Copy, a usage-limits note). "Check again" calls `providers({ refresh: true })`. Agents tabs and the Home agent menu list ready subscriptions (`cli.ready`) first, then the API-key providers, then subscriptions whose sign-in is unchecked or uses an API key (labelled as such), and hide ones whose CLI is not installed; "Auto" prefers a ready subscription, then the first API provider with a key, then a usable but unchecked subscription. While an agent answers, the Agents Send button becomes Stop (`agents.cancel`).

## Renderer modules

- `renderer/js/hero3d.js` exports `initRouterHero(container: HTMLElement, opts?)` -> `{ setThreat(level: 0|1|2), setSignal(strength0to1), pulse(), setPaused(bool), dispose() }`.
  `level` 2 = critical door open (WAN port glows red), 1 = warnings, 0 = all clear (cool white/blue).
- `renderer/js/glow-kit.js` exports `initGlowKit(root = document)` which upgrades markup:
  - `<label class="gk-slider"><span>Label</span><input type="range" ...></label>` -> Apple-style slider with glowing fill and an anamorphic flare on the thumb
  - `<button class="gk-toggle" role="switch" aria-checked="true">` -> toggle with a rotating conic glow ring when on
  - `<div class="gk-ring">` wrapper -> rotating rainbow/blue glow border around any card or button (Apple Intelligence style)
  - `<button class="gk-btn gk-btn--primary">` -> primary button with sweeping light
  - `<div class="gk-segment" role="tablist">` of `<button role="tab">` -> segmented control with sliding glass thumb
  CSS lives in `renderer/styles/glow-kit.css`. Must respect prefers-reduced-motion.
- `renderer/js/app.js` is the entry; it imports the above plus `api.js` (returns `window.bastion` or the mock).
