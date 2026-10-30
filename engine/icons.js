'use strict';

// App icons for the renderer, taken from the user's own installed applications.
// Main-process only (needs Electron's app.getFileIcon / nativeImage / net).
//
//   forProcesses([{ pid, process }], { known }) -> { processes: { [pid]: { exe, product, description } }, icons: { [exe]: dataURL | null } }
//   providers({ keyIds })            -> { claude, openai, grok }: dataURL | null
//
// Never throws; anything unknown resolves to null so the UI keeps its monogram.
// The only network request in this file is the one-time provider icon download
// (fallback (b) below), made only for providers the user saved an API key for.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

let electron = null;
try {
  electron = require('electron');
  if (!electron || typeof electron !== 'object' || !electron.app) electron = null;
} catch {
  electron = null;
}

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const PS_TIMEOUT = 9000;
const FETCH_TIMEOUT = 4000;
const PROCESS_ICON_PX = 64; // shown at 30 px; 64 keeps it sharp on 2x displays
const PROVIDER_ICON_PX = 128; // shown at 14-28 px
const MAX_ICON_BYTES = 512 * 1024;
const RETRY_FAILED_MS = 24 * 60 * 60 * 1000;
const PROVIDER_IDS = ['claude', 'openai', 'grok'];

// ---------------------------------------------------------------- helpers

function run(file, args, opts) {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { timeout: PS_TIMEOUT, windowsHide: true, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', ...opts }, (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') });
      });
    } catch {
      resolve({ ok: false, stdout: '', stderr: '' });
    }
  });
}

// -EncodedCommand keeps the script's quotes intact (powershell.exe mangles quotes in -Command).
function powershell(script, env) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    env: { ...process.env, ...(env || {}) },
  });
}

function parseJson(text) {
  try {
    const t = String(text || '').trim();
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}

function exists(p) {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
}

function okDataUrl(img) {
  try {
    if (!img || img.isEmpty()) return null;
    const url = img.toDataURL();
    return typeof url === 'string' && url.startsWith('data:image/') ? url : null;
  } catch {
    return null;
  }
}

// Electron's own icon lookup (32 px on Windows, bundle icon on macOS).
async function fileIcon(file, size) {
  if (!electron || !electron.app || typeof electron.app.getFileIcon !== 'function') return null;
  try {
    const img = await electron.app.getFileIcon(file, { size: size || 'normal' });
    return okDataUrl(img);
  } catch {
    return null;
  }
}

// Windows: pull the high-resolution icon out of each .exe (Electron's getFileIcon tops out at
// 32 px) with user32's PrivateExtractIcons. The tiny P/Invoke helper is compiled once into
// <userData>/bastion-iconx-<v>.dll and only loaded afterwards, so later calls never start the C#
// compiler. Paths travel in environment variables, never in the script text. Executables
// without their own icon are left out (no generic icon). The fragment fills $icons[path] = base64
// for every path in $want; it is shared by the process and the provider lookups.
const ICONX_VERSION = 1;
const ICONX_SRC = 'using System; using System.Runtime.InteropServices; public static class BastionIconX { [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern uint PrivateExtractIcons(string f, int i, int cx, int cy, IntPtr[] h, int[] id, uint n, uint fl); [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr h); }';
const EXTRACT_FRAGMENT = [
  'if ($want.Count -gt 0) {',
  '  Add-Type -AssemblyName System.Drawing',
  "  $src = '" + ICONX_SRC.replace(/'/g, "''") + "'",
  '  $dll = $env:BASTION_ICONX_DLL; $ready = $false',
  '  if ($dll -and (Test-Path -LiteralPath $dll)) { try { Add-Type -LiteralPath $dll -ErrorAction Stop; $ready = $true } catch {} }',
  '  if (-not $ready -and $dll) {',
  '    try {',
  '      $tmp = "$dll.$PID.tmp.dll"',
  '      Add-Type -TypeDefinition $src -OutputAssembly $tmp -OutputType Library -ErrorAction Stop',
  '      try { Move-Item -LiteralPath $tmp -Destination $dll -ErrorAction Stop } catch { Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue }',
  '      Add-Type -LiteralPath $dll -ErrorAction Stop; $ready = $true',
  '    } catch {}',
  '  }',
  '  if (-not $ready) { Add-Type -TypeDefinition $src }',
  '  $size = [int]$env:BASTION_ICON_SIZE',
  '  foreach ($f in $want) {',
  '    try {',
  '      $h = New-Object IntPtr[] 1; $ids = New-Object int[] 1',
  '      $n = [BastionIconX]::PrivateExtractIcons($f, 0, $size, $size, $h, $ids, 1, 0)',
  '      if ($n -gt 0 -and $n -ne 4294967295 -and $h[0] -ne [IntPtr]::Zero) {',
  '        $ico = [System.Drawing.Icon]::FromHandle($h[0]); $bmp = $ico.ToBitmap()',
  '        $ms = New-Object System.IO.MemoryStream',
  '        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)',
  '        $icons[$f] = [Convert]::ToBase64String($ms.ToArray())',
  '        $bmp.Dispose(); $ico.Dispose(); [void][BastionIconX]::DestroyIcon($h[0])',
  '      }',
  '    } catch {}',
  '  }',
  '}',
].join('\n');

function iconxDll() {
  try {
    if (electron && electron.app) return path.join(electron.app.getPath('userData'), `bastion-iconx-${ICONX_VERSION}.dll`);
  } catch {
    // fall through
  }
  return path.join(os.tmpdir(), `bastion-iconx-${ICONX_VERSION}.dll`);
}

function iconEnv(px) {
  return { BASTION_ICONX_DLL: iconxDll(), BASTION_ICON_SIZE: String(px) };
}

function b64Png(v) {
  return typeof v === 'string' && v && /^[A-Za-z0-9+/=]+$/.test(v) ? 'data:image/png;base64,' + v : null;
}

const EXTRACT_PS = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$icons = @{}',
  '$want = $env:BASTION_ICON_PATHS | ConvertFrom-Json', // assigned first so PS 5.1 enumerates the array
  EXTRACT_FRAGMENT,
  '$icons | ConvertTo-Json -Compress',
].join('\n');

async function extractWinIcons(files, px) {
  const out = {};
  if (!files.length) return out;
  const r = await powershell(EXTRACT_PS, { ...iconEnv(px), BASTION_ICON_PATHS: JSON.stringify(files) });
  const data = parseJson(r.stdout);
  if (!data || typeof data !== 'object') return null; // the whole call failed
  for (const f of files) out[f] = b64Png(data[f]);
  return out;
}

// A dark glyph on a transparent background (e.g. a black monochrome logo) disappears on Bastion's
// dark glass. Like Windows' "plated" tiles, such icons are set on a light rounded plate; the logo
// itself is not changed. Anything else is returned untouched.
function plateIfDark(dataUrl) {
  if (!dataUrl || !electron || !electron.nativeImage || !/^data:image\/(png|jpeg);/.test(dataUrl)) return dataUrl;
  try {
    const img = electron.nativeImage.createFromDataURL(dataUrl);
    if (img.isEmpty()) return dataUrl;
    const { width: w, height: h } = img.getSize();
    if (w < 8 || w !== h) return dataUrl;
    const px = img.toBitmap(); // BGRA, premultiplied
    let covered = 0;
    let visible = 0;
    let lum = 0;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3];
      if (a > 200) covered += 1;
      if (a < 24) continue;
      visible += a;
      // un-premultiply, then Rec. 709 luma weighted by alpha
      lum += ((0.0722 * px[i] + 0.7152 * px[i + 1] + 0.2126 * px[i + 2]) / a) * a;
    }
    const n = w * h;
    if (!visible || covered / n > 0.62) return dataUrl; // a full tile already
    if (lum / visible > 0.42) return dataUrl; // light enough to read on dark glass
    // Plate: soft lavender-white rounded square (22% radius), glyph inset to 76%.
    const out = Buffer.alloc(n * 4);
    const r = w * 0.22;
    const plate = [0xf6, 0xf2, 0xf2]; // B, G, R  (#F2F2F6)
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const cx = Math.min(Math.max(x + 0.5, r), w - r);
        const cy = Math.min(Math.max(y + 0.5, r), h - r);
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const a = Math.max(0, Math.min(1, r - d + 0.5));
        const o = (y * w + x) * 4;
        out[o] = plate[0] * a;
        out[o + 1] = plate[1] * a;
        out[o + 2] = plate[2] * a;
        out[o + 3] = 255 * a;
      }
    }
    const inner = Math.round(w * 0.76);
    const glyph = img.resize({ width: inner, height: inner, quality: 'best' }).toBitmap();
    const off = Math.round((w - inner) / 2);
    for (let y = 0; y < inner; y += 1) {
      for (let x = 0; x < inner; x += 1) {
        const s = (y * inner + x) * 4;
        const k = 1 - glyph[s + 3] / 255;
        const o = ((y + off) * w + (x + off)) * 4;
        for (let c = 0; c < 4; c += 1) out[o + c] = Math.min(255, glyph[s + c] + out[o + c] * k);
      }
    }
    return okDataUrl(electron.nativeImage.createFromBitmap(out, { width: w, height: h })) || dataUrl;
  } catch {
    return dataUrl;
  }
}

// path -> dataURL | null, for the whole app session.
const iconByPath = new Map();

async function iconsForPaths(files, px) {
  const todo = [...new Set(files.filter((f) => f && !iconByPath.has(f)))];
  if (todo.length) {
    if (IS_WIN) {
      const got = await extractWinIcons(todo, px);
      for (const f of todo) {
        let url = got ? got[f] : undefined;
        if (url === undefined) url = await fileIcon(f, 'large'); // PowerShell unavailable: Electron's 32 px icon
        iconByPath.set(f, plateIfDark(url) || null);
      }
    } else if (IS_MAC) {
      for (const f of todo) iconByPath.set(f, /\.app$/i.test(f) ? plateIfDark(await fileIcon(f, 'normal')) : null);
    } else {
      for (const f of todo) iconByPath.set(f, null);
    }
  }
  const out = {};
  for (const f of files) out[f] = f ? iconByPath.get(f) || null : null;
  return out;
}

// ---------------------------------------------------------------- process icons
//
// forProcesses(list, { known }) -> {
//   processes: { [pid]: { exe: string | null, product: string | null, description: string | null } },
//   icons:     { [exe]: dataURL | null }   // only executables not listed in `known`
// }
// Icons are keyed by executable, so twenty Chrome helpers carry one icon, and the renderer can
// tell two programs with the same process name apart (Claude desktop vs. the Claude Code CLI).

// "pid|process" -> { path, at }. Short-lived: a pid can be reused by another program.
const pathByPid = new Map();
const PID_TTL_MS = 5 * 60 * 1000;
// exe path -> { product, description } from the file's version resource, for the whole session.
const infoByPath = new Map();

function cleanPids(list) {
  const seen = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    const pid = Number(item && item.pid);
    if (!Number.isInteger(pid) || pid <= 4 || pid > 0x7fffffff) continue;
    seen.set(pid, String((item && item.process) || ''));
  }
  return seen;
}

function cleanLabel(v) {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  return s && s.length <= 80 ? s : null;
}

// macOS: the outermost .app bundle around an executable, so helpers show their parent app.
function macBundle(exe) {
  const s = String(exe || '');
  const i = s.indexOf('.app/');
  if (i > 0) return s.slice(0, i + 4);
  return /\.app$/.test(s) ? s : null;
}

// Windows: one PowerShell call per batch of new pids. It resolves each pid's executable, reads
// the product name from its version resource and extracts icons only for executables this
// session has not seen yet, so a batch of new helper pids of a known program costs a single
// Get-Process and never compiles or extracts anything.
const PROCESS_PS = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$icons = @{}; $procs = @{}; $known = @{}',
  '$kn = $env:BASTION_KNOWN_PATHS | ConvertFrom-Json', // assigned first so PS 5.1 enumerates the array
  'foreach ($k in $kn) { if ($k) { $known[[string]$k] = 1 } }',
  '$ids = $env:BASTION_PIDS | ConvertFrom-Json',
  '$want = New-Object System.Collections.Generic.List[string]',
  'foreach ($pr in @(Get-Process -Id $ids -ErrorAction SilentlyContinue)) {',
  '  $f = $pr.Path; $prod = $null; $desc = $null',
  '  if ($f -and -not $known.ContainsKey($f)) {',
  '    try { $v = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($f); $prod = $v.ProductName; $desc = $v.FileDescription } catch {}',
  '    if (-not $want.Contains($f)) { $want.Add($f) }',
  '  }',
  '  $procs[[string]$pr.Id] = @{ f = $f; p = $prod; d = $desc }',
  '}',
  EXTRACT_FRAGMENT,
  '@{ procs = $procs; icons = $icons } | ConvertTo-Json -Compress -Depth 4',
].join('\n');

// pid -> path (null when the system would not say). Returns null when the call itself failed,
// so those pids are asked again next time instead of being remembered as unknown.
async function resolveWin(pids) {
  const known = [...iconByPath.keys()].filter((p) => infoByPath.has(p));
  const r = await powershell(PROCESS_PS, {
    ...iconEnv(PROCESS_ICON_PX),
    BASTION_PIDS: JSON.stringify(pids),
    BASTION_KNOWN_PATHS: JSON.stringify(known.length ? known : ['']),
  });
  const data = parseJson(r.stdout);
  if (!data || typeof data !== 'object' || !data.procs || typeof data.procs !== 'object') return null;
  const icons = data.icons && typeof data.icons === 'object' ? data.icons : {};
  const out = new Map();
  for (const pid of pids) {
    const row = data.procs[String(pid)];
    const f = row && typeof row.f === 'string' && row.f ? row.f : null;
    out.set(pid, f);
    if (!f || (iconByPath.has(f) && infoByPath.has(f))) continue;
    infoByPath.set(f, { product: cleanLabel(row.p), description: cleanLabel(row.d) });
    if (!iconByPath.has(f)) iconByPath.set(f, plateIfDark(b64Png(icons[f])) || null);
  }
  return out;
}

async function resolveMac(pids) {
  const out = new Map();
  const r = await run('/bin/ps', ['-o', 'pid=,comm=', '-p', pids.join(',')]);
  if (!r.ok && !r.stdout) return null;
  for (const line of r.stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const bundle = macBundle(m[2]);
    out.set(Number(m[1]), bundle);
    if (bundle && !infoByPath.has(bundle)) infoByPath.set(bundle, { product: cleanLabel(path.basename(bundle, '.app')), description: null });
  }
  for (const pid of pids) if (!out.has(pid)) out.set(pid, null);
  return out;
}

async function forProcesses(list, opts) {
  const result = { processes: {}, icons: {} };
  try {
    const wanted = cleanPids(list);
    const have = new Set((Array.isArray(opts && opts.known) ? opts.known : []).filter((s) => typeof s === 'string').slice(0, 2000));
    const now = Date.now();
    const missing = [];
    for (const [pid, name] of wanted) {
      const hit = pathByPid.get(pid + '|' + name);
      if (!hit || now - hit.at > PID_TTL_MS) missing.push(pid);
    }
    if (missing.length && (IS_WIN || IS_MAC)) {
      const batch = missing.slice(0, 400);
      const found = IS_WIN ? await resolveWin(batch) : await resolveMac(batch);
      if (found) for (const pid of batch) pathByPid.set(pid + '|' + wanted.get(pid), { path: found.get(pid) || null, at: now });
    }
    const paths = [];
    for (const [pid, name] of wanted) {
      const p = (pathByPid.get(pid + '|' + name) || {}).path || null;
      if (p) paths.push(p);
    }
    // Windows already has these from the batch above; macOS (and a failed extraction) fill in here.
    const icons = await iconsForPaths(paths, PROCESS_ICON_PX);
    for (const [pid, name] of wanted) {
      const hit = pathByPid.get(pid + '|' + name);
      const exe = hit ? hit.path || null : null;
      const info = (exe && infoByPath.get(exe)) || {};
      result.processes[pid] = { exe, product: info.product || null, description: info.description || null };
      if (exe && !have.has(exe) && !(exe in result.icons)) result.icons[exe] = icons[exe] || null;
    }
    if (pathByPid.size > 4000) pathByPid.clear();
  } catch {
    // Unknown stays null; the renderer keeps its monogram.
  }
  return result;
}

// ---------------------------------------------------------------- provider icons

const WIN_APPX = { claude: /^(Claude|AnthropicClaude|Anthropic\.Claude)/i, openai: /ChatGPT/i, grok: /Grok/i };
const MAC_APPS = { claude: ['Claude.app'], openai: ['ChatGPT.app'], grok: ['Grok.app'] };
const SITES = {
  claude: ['https://claude.ai/apple-touch-icon.png', 'https://claude.ai/favicon.ico'],
  openai: ['https://chatgpt.com/apple-touch-icon.png', 'https://chatgpt.com/favicon.ico'],
  grok: ['https://grok.com/apple-touch-icon.png', 'https://grok.com/favicon.ico'],
};

// A provider's app counts only when it is signed by that provider: on Windows the Authenticode
// signer of the .exe (status Valid) or the publisher of its Microsoft Store package, on macOS the
// code-signing authority of the bundle. Anything else (a look-alike, a third-party "Grok" or
// "Claude" wrapper) is ignored and the UI keeps its monogram.
const VENDOR = {
  claude: /\b(?:O|CN)="?Anthropic\b/i,
  openai: /\b(?:O|CN)="?OpenAI\b/i,
  grok: /\b(?:O|CN)="?(?:X\.AI|xAI)\b/i,
};
const MAC_VENDOR = { claude: /Anthropic/i, openai: /OpenAI/i, grok: /\b(?:X\.AI|xAI)\b/i };

function winCandidates() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const programs = path.join(local, 'Programs');
  return {
    claude: [path.join(local, 'AnthropicClaude', 'claude.exe'), path.join(programs, 'claude', 'Claude.exe')],
    openai: [path.join(programs, 'ChatGPT', 'ChatGPT.exe')],
    grok: [path.join(programs, 'Grok', 'Grok.exe')],
  };
}

// One call: the signer of every candidate .exe, plus the Store packages named like a provider.
const PROVIDER_PS = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$sig = @{}',
  '$files = $env:BASTION_PROVIDER_EXES | ConvertFrom-Json', // assigned first so PS 5.1 enumerates the array
  'foreach ($f in $files) {',
  '  if (-not $f -or -not (Test-Path -LiteralPath $f)) { continue }',
  '  $s = Get-AuthenticodeSignature -LiteralPath $f',
  "  if ($s -and $s.Status -eq 'Valid' -and $s.SignerCertificate) { $sig[$f] = $s.SignerCertificate.Subject }",
  '}',
  "$appx = @(Get-AppxPackage | Where-Object { $_.Name -match 'Claude|ChatGPT|Grok' -and -not $_.IsFramework } | ForEach-Object { @{ n = $_.Name; l = $_.InstallLocation; p = $_.Publisher } })",
  '@{ sig = $sig; appx = $appx } | ConvertTo-Json -Compress -Depth 4',
].join('\n');

// -> { exe: { claude, openai, grok }, complete } where complete=false means PowerShell failed.
async function winProviderExes() {
  const cands = winCandidates();
  const present = {};
  for (const id of PROVIDER_IDS) present[id] = cands[id].filter(exists);
  const all = PROVIDER_IDS.flatMap((id) => present[id]);
  const r = await powershell(PROVIDER_PS, { BASTION_PROVIDER_EXES: JSON.stringify(all.length ? all : ['']) });
  const data = parseJson(r.stdout);
  const exe = { claude: null, openai: null, grok: null };
  if (!data || typeof data !== 'object') return { exe, complete: false };
  const sig = data.sig && typeof data.sig === 'object' ? data.sig : {};
  for (const id of PROVIDER_IDS) exe[id] = present[id].find((f) => typeof sig[f] === 'string' && VENDOR[id].test(sig[f])) || null;
  let rows = data.appx;
  if (rows && !Array.isArray(rows)) rows = [rows];
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = String((row && row.n) || '');
    const loc = String((row && row.l) || '');
    const publisher = String((row && row.p) || '');
    if (!name || !loc) continue;
    for (const id of PROVIDER_IDS) {
      if (exe[id] || !WIN_APPX[id].test(name) || !VENDOR[id].test(publisher)) continue;
      try {
        const manifest = fs.readFileSync(path.join(loc, 'AppxManifest.xml'), 'utf8');
        const m = /<Application\b[^>]*\bExecutable="([^"]+\.exe)"/i.exec(manifest);
        const file = m ? path.join(loc, m[1]) : null;
        if (file && exists(file)) exe[id] = file;
      } catch {
        // Unreadable package folder.
      }
    }
  }
  return { exe, complete: true };
}

async function macSignedBy(app, id) {
  const r = await run('/usr/bin/codesign', ['-dv', '--verbose=2', app]);
  const authority = /^Authority=Developer ID Application: (.+)$/m.exec(r.stdout + '\n' + r.stderr);
  return !!authority && MAC_VENDOR[id].test(authority[1]);
}

// One lookup per app session. A lookup where PowerShell itself failed (cold-start timeout) is not
// kept: it is tried again on the next request, at most once a minute.
let installedPromise = null;
let installedRetryAt = 0;

function installedIcons() {
  if (installedPromise && installedRetryAt && Date.now() >= installedRetryAt) installedPromise = null;
  if (!installedPromise) {
    installedRetryAt = 0;
    installedPromise = (async () => {
      const out = { claude: null, openai: null, grok: null };
      let complete = true;
      try {
        if (IS_WIN) {
          const found = await winProviderExes();
          complete = found.complete;
          const files = PROVIDER_IDS.map((id) => found.exe[id]).filter(Boolean);
          const icons = await iconsForPaths(files, PROVIDER_ICON_PX);
          for (const id of PROVIDER_IDS) out[id] = found.exe[id] ? icons[found.exe[id]] || null : null;
        } else if (IS_MAC) {
          const roots = ['/Applications', path.join(os.homedir(), 'Applications')];
          for (const id of PROVIDER_IDS) {
            const app = MAC_APPS[id].flatMap((n) => roots.map((r) => path.join(r, n))).find(exists);
            out[id] = app && (await macSignedBy(app, id)) ? await fileIcon(app, 'normal') : null;
          }
        }
      } catch {
        complete = false;
      }
      if (!complete) installedRetryAt = Date.now() + 60 * 1000;
      return out;
    })();
  }
  return installedPromise;
}

// ---- fallback (b): the provider site's icon, fetched once, kept in <userData>/provider-icons.json

let cacheFile = null;
const inflightSite = new Map();

function cachePath() {
  if (cacheFile) return cacheFile;
  try {
    if (electron && electron.app) cacheFile = path.join(electron.app.getPath('userData'), 'provider-icons.json');
  } catch {
    cacheFile = null;
  }
  return cacheFile;
}

function readCache() {
  const f = cachePath();
  if (!f) return {};
  try {
    const v = JSON.parse(fs.readFileSync(f, 'utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function writeCache(next) {
  const f = cachePath();
  if (!f) return;
  try {
    fs.writeFileSync(f, JSON.stringify(next, null, 2), 'utf8');
  } catch {
    // Not fatal: we try again next launch.
  }
}

function sniffType(buf) {
  if (buf.length < 8) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'image/x-icon';
  return null;
}

async function fetchIcon(url) {
  const doFetch = electron && electron.net && typeof electron.net.fetch === 'function' ? electron.net.fetch.bind(electron.net) : globalThis.fetch;
  if (typeof doFetch !== 'function') return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await doFetch(url, { signal: ctrl.signal, redirect: 'follow', credentials: 'omit', cache: 'no-store' });
    if (!res || !res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_ICON_BYTES) return null;
    const type = sniffType(buf);
    if (!type) return null;
    // Decoded and re-encoded as PNG (ICO too, where nativeImage reads it) so it can be measured and
    // plated like an installed icon. Under 48 px it looks soft at 28 px: kept only as a last resort.
    if (electron && electron.nativeImage) {
      const img = electron.nativeImage.createFromBuffer(buf);
      if (!img.isEmpty()) {
        const { width, height } = img.getSize();
        const url = plateIfDark(okDataUrl(img));
        if (!url) return null;
        return { url, small: Math.min(width, height) < 48 };
      }
      if (type !== 'image/x-icon') return null; // a PNG/JPEG that does not decode is broken
    }
    // An ICO nativeImage cannot read: size unknown (usually 16-32 px), so last resort.
    return { url: `data:${type};base64,` + buf.toString('base64'), small: true };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function siteIcon(id) {
  if (inflightSite.has(id)) return inflightSite.get(id);
  const p = (async () => {
    const cache = readCache();
    const hit = cache[id];
    if (hit && typeof hit.dataUrl === 'string' && hit.dataUrl.startsWith('data:image/')) return hit.dataUrl;
    if (hit && hit.failedAt && Date.now() - Date.parse(hit.failedAt) < RETRY_FAILED_MS) return null;
    let best = null;
    for (const url of SITES[id] || []) {
      const got = await fetchIcon(url);
      if (got && (!best || (best.small && !got.small))) best = { ...got, source: url };
      if (best && !best.small) break;
    }
    const fresh = readCache();
    fresh[id] = best ? { dataUrl: best.url, source: best.source, savedAt: new Date().toISOString() } : { failedAt: new Date().toISOString() };
    writeCache(fresh);
    return best ? best.url : null;
  })().catch(() => null);
  inflightSite.set(id, p);
  p.finally(() => inflightSite.delete(id));
  return p;
}

// keyIds: provider ids that have a saved API key (only those may use the web fallback).
// Logos shipped with the app (renderer/assets/providers). They win over installed-app icons
// so the brand looks the same on every machine.
const BUNDLED = { openai: 'chatgpt.png', grok: 'grok.png' };

function bundledIcon(id) {
  const file = BUNDLED[id];
  if (!file) return null;
  try {
    const buf = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'assets', 'providers', file));
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

async function providers(opts) {
  const out = { claude: null, openai: null, grok: null };
  try {
    const keyIds = new Set(Array.isArray(opts && opts.keyIds) ? opts.keyIds : []);
    for (const id of PROVIDER_IDS) out[id] = bundledIcon(id);
    const installed = await installedIcons();
    for (const id of PROVIDER_IDS) {
      if (out[id]) continue;
      if (installed[id]) out[id] = installed[id];
      else if (keyIds.has(id)) out[id] = await siteIcon(id);
    }
  } catch {
    // Monograms it is.
  }
  return out;
}

module.exports = { forProcesses, providers };
