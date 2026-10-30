# Bastion internal contract

This file is the source of truth for how the pieces of the app talk to each other. Every module is built against it.

## Layout

```
electron/main.js        Window, menu, IPC handlers (thin: delegates to engine/ and agents/)
electron/preload.js     contextBridge -> window.bastion (the only renderer <-> main surface)
engine/*.js             Network engine. CommonJS, Node built-ins only, no native addons.
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
- Never send anything off the machine except: the speed test (Cloudflare speed endpoints), the public IP lookup (`https://api.ipify.org?format=json`), and AI requests the user starts with their own key.

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

bastion.agents.providers()           -> Provider[]
bastion.agents.setKey(id, key)       -> { ok: boolean, error?: string }
bastion.agents.clearKey(id)          -> { ok: boolean }
bastion.agents.setModel(id, model)   -> { ok: boolean }
bastion.agents.test(id)              -> { ok: boolean, error?: string, model?: string }
bastion.agents.ask(id, question, snapshot) -> AgentAnswer
```

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

Provider = { id: 'claude' | 'openai' | 'grok', name: string, hasKey: boolean, model: string, models: string[] }
AgentAnswer = { ok: boolean, provider: string, model: string, text: string, error?: string }
```

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
