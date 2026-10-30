'use strict';

// Wi-Fi link info and neighbourhood survey.
// Windows: netsh wlan (labels may be localized, so parsing is label-variant and value-shape tolerant).
// macOS: system_profiler SPAirPortDataType -json, with ipconfig getsummary as an SSID fallback.
// Every exported function resolves with data and never throws.

const { execFile } = require('node:child_process');

const DEFAULT_TIMEOUT = 8000;
const LOCATION_SETTINGS_URI = 'ms-settings:privacy-location';

const LOCATION_HINT_WIN =
  'Windows only shares Wi-Fi details with apps that have Location access. ' +
  'Turn on Location services for desktop apps: Settings > Privacy & security > Location ' +
  '(enable "Location services" and "Let desktop apps access your location"), ' +
  'then try again. Settings URI: ' + LOCATION_SETTINGS_URI;

// macOS 14.4+ redacts SSIDs until the app itself has asked for and been granted Location access.
// Bastion only appears in Location Services after it has made that request once.
const LOCATION_HINT_MAC =
  'macOS hides Wi-Fi network names from apps without Location access, so the name is unknown. ' +
  'If Bastion is listed under System Settings > Privacy & Security > Location Services, turn it on; ' +
  'if it is not listed, macOS has not been asked yet and there is no switch to turn on. ' +
  'Channel, signal and speed readings are still real.';

// ---------- process helpers ----------

// Picks the most plausible decoding of console output: UTF-8 when valid,
// otherwise the OEM (cp866) or ANSI (cp1251) Cyrillic codepage, whichever reads like real text.
function decodeOutput(buf) {
  if (!buf || !buf.length) return '';
  if (typeof buf === 'string') return buf;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // not UTF-8, fall through
  }
  const candidates = [];
  for (const enc of ['ibm866', 'windows-1251', 'latin1']) {
    try {
      candidates.push(new TextDecoder(enc).decode(buf));
    } catch {
      // encoding not available in this runtime
    }
  }
  if (!candidates.length) return buf.toString('latin1');
  const common = /[оеаинтсрвлкмдпуяыгзбчйхжшюцщэфъё]/g;
  let best = candidates[0];
  let bestScore = -1;
  for (const text of candidates) {
    const score = (text.match(common) || []).length;
    if (score > bestScore) {
      best = text;
      bestScore = score;
    }
  }
  return best;
}

function run(cmd, args, timeout = DEFAULT_TIMEOUT) {
  return new Promise((resolve) => {
    try {
      execFile(
        cmd,
        args,
        { timeout, windowsHide: true, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 },
        (err, stdout, stderr) => {
          resolve({
            ok: !err,
            out: decodeOutput(stdout),
            err: decodeOutput(stderr),
            code: err ? (err.code != null ? err.code : null) : 0,
            message: err ? String(err.message || err) : '',
            timedOut: Boolean(err && err.killed),
          });
        }
      );
    } catch (err) {
      resolve({ ok: false, out: '', err: '', code: null, message: String((err && err.message) || err), timedOut: false });
    }
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- shared helpers ----------

function bandFromChannel(channel) {
  if (!Number.isFinite(channel)) return null;
  if (channel >= 1 && channel <= 14) return '2.4';
  if (channel >= 32 && channel <= 177) return '5';
  return null;
}

// Parses a band string such as "5 GHz", "2,4 ГГц", "6GHz".
function bandFromText(text) {
  if (!text) return null;
  const m = String(text).match(/(2[.,]4|5|6)\s*(?:g|г)/i);
  if (!m) return null;
  return m[1].replace(',', '.');
}

function isNomap(ssid) {
  if (ssid == null) return null;
  const s = String(ssid).toLowerCase();
  return s.endsWith('_nomap') || s.includes('_optout');
}

function pctToRssi(pct) {
  if (!Number.isFinite(pct)) return null;
  return Math.round(pct / 2 - 100);
}

function rssiToPct(rssi) {
  if (!Number.isFinite(rssi)) return null;
  return Math.max(0, Math.min(100, Math.round((rssi + 100) * 2)));
}

function num(text) {
  if (text == null) return null;
  const m = String(text).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function normMac(text) {
  if (!text) return null;
  const m = String(text).match(/([0-9a-f]{1,2}[:-]){5}[0-9a-f]{1,2}/i);
  if (!m) return null;
  return m[0]
    .split(/[:-]/)
    .map((p) => p.padStart(2, '0'))
    .join(':')
    .toLowerCase();
}

// The settings URI is decisive. Keywords only count when the output carries no Wi-Fi data at all,
// so an SSID that happens to contain "location" is not mistaken for the privacy error.
function looksLikeLocationError(text) {
  if (!text) return false;
  if (/ms-settings:privacy-location/i.test(text)) return true;
  if (/^\s*(SSID|BSSID|AP BSSID|GUID)\b/im.test(text)) return false;
  return /location permission|location services|местоположени|геолокаци|расположени/i.test(text);
}

function emptyInfo(supported, errors) {
  return {
    supported,
    ssid: null,
    bssid: null,
    band: null,
    channel: null,
    widthMHz: null,
    rssi: null,
    signalPct: null,
    rxMbps: null,
    txMbps: null,
    security: null,
    nomap: null,
    errors,
  };
}

function emptySurvey(supported, errors, current) {
  return {
    supported,
    networks: [],
    congestion: [],
    current: current || { channel: null, band: null },
    recommendation: null,
    errors,
  };
}

// ---------- Windows (netsh) ----------

// Label variants (English and Russian). Matched against the lower-cased label with trailing
// unit hints removed. Unknown languages fall back to value-shape detection below.
const WIN_LABELS = {
  name: [/^name$/, /^имя$/],
  state: [/^state$/, /^состояние$/],
  ssid: [/^ssid$/],
  bssid: [/^(ap )?bssid$/],
  mac: [/physical address/, /физический адрес/],
  band: [/^band$/, /^диапазон$/],
  channel: [/^channel$/, /^канал$/],
  radio: [/^radio type$/, /^тип радио$/],
  auth: [/^authentication$/, /^проверка подлинности$/],
  cipher: [/^cipher$/, /^шифр$/, /^encryption$/, /^шифрование$/],
  rx: [/receive rate/, /скорость при[её]ма/],
  tx: [/transmit rate/, /скорость передачи/],
  signal: [/^signal$/, /^сигнал$/],
  rssi: [/^rssi$/],
};

function classifyLabel(label) {
  const l = label.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const [key, patterns] of Object.entries(WIN_LABELS)) {
    if (patterns.some((p) => p.test(l))) return key;
  }
  return null;
}

// Splits "    Label      : value" at the first colon (MAC addresses in values keep their colons).
function splitLine(line) {
  const m = line.match(/^(\s*)([^:]+?)\s*:\s?(.*)$/);
  if (!m) return null;
  return { indent: m[1].length, label: m[2].trim(), value: m[3].trim() };
}

function parseWinInterfaces(text) {
  const blocks = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const kv = splitLine(raw);
    if (!kv) continue;
    const key = classifyLabel(kv.label);
    // A new interface block starts at its Name line (or at the first field if names are unrecognized).
    if (key === 'name' || !cur) {
      cur = { fields: {}, values: [] };
      blocks.push(cur);
    }
    cur.values.push(kv.value);
    if (key && cur.fields[key] == null) cur.fields[key] = kv.value;
  }
  // Value-shape fallbacks for unrecognized languages.
  for (const b of blocks) {
    if (b.fields.signal == null) {
      const v = b.values.find((x) => /^\d{1,3}\s*%$/.test(x));
      if (v) b.fields.signal = v;
    }
    if (b.fields.band == null) {
      const v = b.values.find((x) => /^(2[.,]4|5|6)\s*\S*hz$/i.test(x) || /^(2[.,]4|5|6)\s*ггц$/i.test(x));
      if (v) b.fields.band = v;
    }
    if (b.fields.bssid == null) {
      const macs = b.values.map(normMac).filter(Boolean);
      // First MAC is the adapter's own address; the second one, if any, is the access point.
      if (macs.length >= 2) b.fields.bssid = macs[1];
    }
  }
  return blocks;
}

function infoFromWinBlock(f) {
  const errors = [];
  const ssid = f.ssid != null && f.ssid !== '' ? f.ssid : null;
  const channel = num(f.channel);
  const signalPct = num(f.signal);
  const rssiLine = num(f.rssi);
  const rssi = Number.isFinite(rssiLine) && rssiLine < 0 ? rssiLine : pctToRssi(signalPct);
  const band = bandFromText(f.band) || bandFromChannel(channel);
  const security = f.auth ? (f.cipher ? `${f.auth} (${f.cipher})` : f.auth) : null;
  if (!ssid) errors.push('This computer is not connected to a Wi-Fi network right now.');
  return {
    supported: true,
    ssid,
    bssid: normMac(f.bssid),
    band: ssid ? band : null,
    channel: ssid ? channel : null,
    widthMHz: null, // netsh does not report channel width
    rssi: ssid ? rssi : null,
    signalPct: ssid ? signalPct : null,
    rxMbps: ssid ? num(f.rx) : null,
    txMbps: ssid ? num(f.tx) : null,
    security: ssid ? security : null,
    nomap: isNomap(ssid),
    errors,
  };
}

function winCommandProblem(res) {
  const text = `${res.out}\n${res.err}\n${res.message}`;
  if (looksLikeLocationError(text)) {
    return { supported: false, errors: ['Wi-Fi details are blocked by Windows location privacy. ' + LOCATION_HINT_WIN] };
  }
  if (/wlansvc|autoconfig|служба автонастройки|автонастройки wlan/i.test(text) && /not running|не запущен/i.test(text)) {
    return { supported: false, errors: ['The Windows WLAN AutoConfig service is not running, so Wi-Fi details are unavailable.'] };
  }
  if (/no wireless interface|нет беспроводн/i.test(text)) {
    return { supported: false, errors: ['No Wi-Fi adapter was found on this computer.'] };
  }
  if (res.timedOut) return { supported: false, errors: ['netsh did not answer in time.'] };
  if (!res.ok && !res.out.trim()) {
    return { supported: false, errors: ['Could not run netsh: ' + (res.err.trim() || res.message || 'unknown error')] };
  }
  return null;
}

async function wifiInfoWin() {
  const res = await run('netsh', ['wlan', 'show', 'interfaces']);
  const problem = winCommandProblem(res);
  if (problem) return emptyInfo(problem.supported, problem.errors);
  const blocks = parseWinInterfaces(res.out).filter((b) => Object.keys(b.fields).length > 2);
  if (!blocks.length) {
    return emptyInfo(false, ['Could not read Wi-Fi details from netsh output.']);
  }
  const connected = blocks.find((b) => b.fields.ssid) || blocks[0];
  return infoFromWinBlock(connected.fields);
}

function parseWinNetworks(text) {
  const networks = [];
  let ssid = null;
  let auth = null;
  let ap = null;
  const flush = () => {
    if (ap && ap.bssid) networks.push(ap);
    ap = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const ssidHead = raw.match(/^SSID\s+\d+\s*:\s?(.*)$/i);
    if (ssidHead) {
      flush();
      ssid = ssidHead[1].trim();
      auth = null;
      continue;
    }
    const bssidHead = raw.match(/^\s+BSSID\s+\d+\s*:\s*(.+)$/i);
    if (bssidHead) {
      flush();
      ap = { ssid: ssid || '', bssid: normMac(bssidHead[1]), auth, signal: null, band: null, channel: null };
      continue;
    }
    const kv = splitLine(raw);
    if (!kv) continue;
    const key = classifyLabel(kv.label);
    if (!ap) {
      if (key === 'auth') auth = kv.value;
      continue;
    }
    if (key === 'signal' || (ap.signal == null && /^\d{1,3}\s*%$/.test(kv.value))) {
      if (ap.signal == null) ap.signal = num(kv.value);
    } else if (key === 'band') {
      ap.band = bandFromText(kv.value);
    } else if (key === 'channel') {
      ap.channel = num(kv.value);
    } else if (ap.band == null && /^(2[.,]4|5|6)\s*(\S*hz|ггц)$/i.test(kv.value)) {
      ap.band = bandFromText(kv.value);
    }
  }
  flush();
  return networks
    .filter((n) => Number.isFinite(n.channel) && n.channel > 0)
    .map((n) => ({
      ssid: n.ssid,
      bssid: n.bssid,
      channel: n.channel,
      band: n.band || bandFromChannel(n.channel) || 'unknown',
      signalPct: n.signal,
      rssi: pctToRssi(n.signal),
      widthMHz: null,
    }));
}

// Asks Windows to rescan via wlanapi WlanScan (no admin needed). netsh only reads the scan cache,
// which Windows often empties down to the connected network between its own background scans.
const WLAN_SCAN_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace BastionWlan -Name Native -MemberDefinition @'
[DllImport("wlanapi.dll")] public static extern uint WlanOpenHandle(uint v, IntPtr r, out uint neg, out IntPtr h);
[DllImport("wlanapi.dll")] public static extern uint WlanEnumInterfaces(IntPtr h, IntPtr r, out IntPtr list);
[DllImport("wlanapi.dll")] public static extern uint WlanScan(IntPtr h, ref Guid g, IntPtr ssid, IntPtr ie, IntPtr r);
[DllImport("wlanapi.dll")] public static extern void WlanFreeMemory(IntPtr p);
[DllImport("wlanapi.dll")] public static extern uint WlanCloseHandle(IntPtr h, IntPtr r);
'@
$neg = 0; $h = [IntPtr]::Zero
$rc = [BastionWlan.Native]::WlanOpenHandle(2, [IntPtr]::Zero, [ref]$neg, [ref]$h)
if ($rc -ne 0) { Write-Output ('open ' + $rc); exit 0 }
$list = [IntPtr]::Zero
$rc = [BastionWlan.Native]::WlanEnumInterfaces($h, [IntPtr]::Zero, [ref]$list)
if ($rc -ne 0) { Write-Output ('enum ' + $rc); [void][BastionWlan.Native]::WlanCloseHandle($h, [IntPtr]::Zero); exit 0 }
$n = [System.Runtime.InteropServices.Marshal]::ReadInt32($list, 0)
for ($i = 0; $i -lt $n; $i++) {
  $bytes = New-Object byte[] 16
  [System.Runtime.InteropServices.Marshal]::Copy([IntPtr]($list.ToInt64() + 8 + $i * 532), $bytes, 0, 16)
  $g = New-Object Guid (,$bytes)
  $rc = [BastionWlan.Native]::WlanScan($h, [ref]$g, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero)
  Write-Output ('scan ' + $g + ' ' + $rc)
}
[BastionWlan.Native]::WlanFreeMemory($list)
[void][BastionWlan.Native]::WlanCloseHandle($h, [IntPtr]::Zero)
`;

async function triggerWinScan() {
  const res = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WLAN_SCAN_PS],
    15000
  );
  if (/^scan \S+ 0\s*$/m.test(res.out)) return { ok: true, rc: null };
  const m = res.out.match(/^(?:scan \S+|open|enum) (\d+)\s*$/m);
  return { ok: false, rc: m ? Number(m[1]) : 'no-result' };
}

// Explains a failed WlanScan / WlanOpenHandle return code (Win32 error code, printed as uint).
function winScanProblem(rc) {
  const hex = typeof rc === 'number' ? '0x' + rc.toString(16).toUpperCase().padStart(8, '0') : null;
  const tail = ' (Location access for desktop apps can also block scans: ' + LOCATION_SETTINGS_URI + ')';
  if (rc === 0x80342002) return 'The Wi-Fi radio is off (airplane mode or a hardware switch), so Windows cannot scan. Turn Wi-Fi on and try again.';
  if (rc === 0x80342001 || rc === 170) return 'The Wi-Fi adapter is busy (code ' + hex + '). Try again in a few seconds.';
  if (rc === 1062 || rc === 1068) return 'The Windows WLAN AutoConfig service is not running, so Windows cannot scan for Wi-Fi networks.';
  if (rc === 5) return 'Windows denied this app a Wi-Fi scan (access denied).' + tail;
  if (hex) return 'Windows could not start a Wi-Fi scan (code ' + hex + '). The Wi-Fi radio may be off or the adapter busy.' + tail;
  return 'Windows could not start a Wi-Fi scan (PowerShell did not report a result).' + tail;
}

async function readWinNetworks() {
  const res = await run('netsh', ['wlan', 'show', 'networks', 'mode=bssid']);
  const problem = winCommandProblem(res);
  return { problem, networks: problem ? [] : parseWinNetworks(res.out) };
}

async function surveyWin() {
  const first = await readWinNetworks();
  if (first.problem) return { networks: [], supported: first.problem.supported, errors: first.problem.errors };
  let networks = first.networks;
  let scan = { ok: true, rc: null };
  if (networks.length < 2) {
    // Cache is empty or mid-refresh: request a fresh scan and poll until the list settles (max ~6 s).
    scan = await triggerWinScan();
    let prev = -1;
    for (let i = 0; i < 6; i++) {
      await delay(1000);
      const next = await readWinNetworks();
      if (next.problem) break;
      if (next.networks.length >= networks.length) networks = next.networks;
      if (networks.length > 0 && networks.length === prev) break;
      prev = networks.length;
    }
  }
  const errors = [];
  if (!networks.length && scan.rc != null) {
    errors.push(winScanProblem(scan.rc));
  }
  if (!networks.length) {
    errors.push('Windows did not report any nearby access points. The list refreshes after the next Wi-Fi scan; try again in a few seconds.');
  }
  return { networks, supported: true, errors };
}

// ---------- macOS (system_profiler) ----------

function macSecurity(mode) {
  if (!mode) return null;
  const s = String(mode).replace(/^spairport_security_mode_/, '').replace(/^pairport_security_mode_/, '');
  const map = {
    none: 'Open',
    wep: 'WEP',
    wpa_personal: 'WPA-Personal',
    wpa_personal_mixed: 'WPA/WPA2-Personal',
    wpa2_personal: 'WPA2-Personal',
    wpa2_wpa3_personal: 'WPA2/WPA3-Personal',
    wpa3_personal: 'WPA3-Personal',
    wpa3_transition: 'WPA2/WPA3-Personal',
    wpa_enterprise: 'WPA-Enterprise',
    wpa_enterprise_mixed: 'WPA/WPA2-Enterprise',
    wpa2_enterprise: 'WPA2-Enterprise',
    wpa3_enterprise: 'WPA3-Enterprise',
    owe: 'OWE (Enhanced Open)',
  };
  return map[s] || s.replace(/_/g, ' ');
}

// "149 (5GHz, 80MHz)" | 149 | "6 (2GHz, 20MHz)" -> { channel, band, widthMHz }
function parseMacChannel(value) {
  if (value == null) return { channel: null, band: null, widthMHz: null };
  const text = String(value);
  const channel = num(text);
  let band = null;
  const bm = text.match(/(\d+(?:\.\d+)?)\s*GHz/i);
  if (bm) {
    const g = Number(bm[1]);
    band = g < 3 ? '2.4' : g < 5.9 ? '5' : '6';
  }
  if (!band) band = bandFromChannel(channel);
  const wm = text.match(/(\d+)\s*MHz/i);
  return { channel, band, widthMHz: wm ? Number(wm[1]) : null };
}

function parseMacSignal(value) {
  if (value == null) return { rssi: null, noise: null };
  const m = String(value).match(/(-?\d+)\s*dBm\s*\/\s*(-?\d+)\s*dBm/i);
  if (m) return { rssi: Number(m[1]), noise: Number(m[2]) };
  const single = num(value);
  return { rssi: Number.isFinite(single) && single < 0 ? single : null, noise: null };
}

function isRedacted(name) {
  return name == null || name === '' || /redacted/i.test(String(name));
}

async function macAirport() {
  const res = await run('system_profiler', ['SPAirPortDataType', '-json'], 15000);
  if (!res.ok && !res.out.trim()) {
    return { error: 'Could not run system_profiler: ' + (res.err.trim() || res.message || 'unknown error') };
  }
  let data;
  try {
    data = JSON.parse(res.out);
  } catch {
    return { error: 'Could not parse system_profiler output.' };
  }
  const root = (data && data.SPAirPortDataType && data.SPAirPortDataType[0]) || {};
  const ifaces = root.spairport_airport_interfaces || [];
  const iface =
    ifaces.find((i) => i.spairport_current_network_information) ||
    ifaces.find((i) => /^en\d+$/.test(i._name || '') && i.spairport_wireless_card_type) ||
    ifaces[0] ||
    null;
  return { iface };
}

async function macSsidFallback(ifaceName) {
  const res = await run('ipconfig', ['getsummary', ifaceName || 'en0']);
  if (!res.out) return null;
  const m = res.out.match(/^\s*SSID\s*:\s*(.+)$/m);
  if (!m) return null;
  const ssid = m[1].trim();
  return isRedacted(ssid) ? null : ssid;
}

// `airport` is an optional macAirport() result, so one survey runs system_profiler (a slow scan) once.
async function wifiInfoMac(airport) {
  const { iface, error } = airport || (await macAirport());
  if (error) return emptyInfo(false, [error]);
  if (!iface) return emptyInfo(false, ['No Wi-Fi adapter was found on this Mac.']);
  const cur = iface.spairport_current_network_information;
  if (!cur) {
    const off = /off/i.test(String(iface.spairport_status_information || ''));
    return emptyInfo(true, [off ? 'Wi-Fi is turned off on this Mac.' : 'This Mac is not connected to a Wi-Fi network right now.']);
  }
  const errors = [];
  let ssid = isRedacted(cur._name) ? null : String(cur._name);
  if (!ssid) ssid = await macSsidFallback(iface._name);
  if (!ssid) errors.push(LOCATION_HINT_MAC);
  const ch = parseMacChannel(cur.spairport_network_channel);
  const sig = parseMacSignal(cur.spairport_signal_noise);
  const rate = num(cur.spairport_network_rate);
  return {
    supported: true,
    ssid,
    bssid: normMac(cur.spairport_network_bssid),
    band: ch.band,
    channel: ch.channel,
    widthMHz: ch.widthMHz,
    rssi: sig.rssi,
    signalPct: rssiToPct(sig.rssi),
    rxMbps: rate, // macOS reports a single negotiated rate
    txMbps: rate,
    security: macSecurity(cur.spairport_security_mode),
    nomap: isNomap(ssid),
    errors,
  };
}

async function surveyMac(airport) {
  const { iface, error } = airport || (await macAirport());
  if (error) return { networks: [], supported: false, errors: [error] };
  if (!iface) return { networks: [], supported: false, errors: ['No Wi-Fi adapter was found on this Mac.'] };
  const errors = [];
  const list = iface.spairport_airport_other_local_wireless_networks || [];
  const networks = [];
  let redacted = 0;
  for (const n of list) {
    const ch = parseMacChannel(n.spairport_network_channel);
    if (!Number.isFinite(ch.channel)) continue;
    const sig = parseMacSignal(n.spairport_signal_noise);
    const hidden = isRedacted(n._name);
    if (hidden) redacted += 1;
    networks.push({
      ssid: hidden ? '' : String(n._name),
      bssid: normMac(n.spairport_network_bssid),
      channel: ch.channel,
      band: ch.band || 'unknown',
      signalPct: rssiToPct(sig.rssi),
      rssi: sig.rssi,
      widthMHz: ch.widthMHz,
    });
  }
  const cur = iface.spairport_current_network_information;
  if (cur) {
    const ch = parseMacChannel(cur.spairport_network_channel);
    const sig = parseMacSignal(cur.spairport_signal_noise);
    if (Number.isFinite(ch.channel)) {
      networks.push({
        ssid: isRedacted(cur._name) ? '' : String(cur._name),
        bssid: normMac(cur.spairport_network_bssid),
        channel: ch.channel,
        band: ch.band || 'unknown',
        signalPct: rssiToPct(sig.rssi),
        rssi: sig.rssi,
        widthMHz: ch.widthMHz,
        own: true,
      });
    }
  }
  if (redacted && redacted === list.length) errors.push(LOCATION_HINT_MAC);
  if (!list.length) errors.push('macOS did not report any nearby networks. Open the Wi-Fi menu once to trigger a scan, then try again.');
  return { networks, supported: true, errors };
}

// ---------- congestion and recommendation ----------

const BLOCK_STARTS_5 = {
  40: [36, 44, 52, 60, 100, 108, 116, 124, 132, 140, 149, 157, 165, 173],
  80: [36, 52, 100, 116, 132, 149, 165],
  160: [36, 100, 149],
};

// 20 MHz channels a 5 GHz transmission occupies, given its primary channel and width.
function occupied5(channel, widthMHz) {
  const w = widthMHz && BLOCK_STARTS_5[widthMHz] ? widthMHz : 20;
  if (w === 20) return [channel];
  const span = w / 5 - 4; // 40 -> 4, 80 -> 12, 160 -> 28
  const start = BLOCK_STARTS_5[w].find((s) => channel >= s && channel <= s + span);
  if (start == null) return [channel];
  const out = [];
  for (let c = start; c <= start + span; c += 4) out.push(c);
  return out;
}

function overlaps(band, a, aWidth, b, bWidth) {
  if (band === '2.4') return Math.abs(a - b) <= 4;
  if (band === '5') {
    const sa = occupied5(a, aWidth);
    const sb = occupied5(b, bWidth);
    return sa.some((c) => sb.includes(c));
  }
  return a === b;
}

// True when two BSSIDs look like siblings on one router. Routers give their other-band radios the
// next few addresses after the base, and derive guest/hidden/backhaul BSSIDs by setting the
// locally-administered (LA) bit and flipping a few more bits (e.g. 8c:90:2d:37:09:7e and
// 8e:90:2d:77:09:7c). Neighbours of the same model bought in one batch have near-sequential
// universal addresses too, so the rule is narrow:
// - both universal: same OUI and octets 4-5, last octet in the same block of 8;
// - LA bit set on either: same first three octets ignoring the LA bit, at most 3 differing bits
//   in octets 4-6.
function siblingBssid(a, b) {
  if (!a || !b || a === b) return false;
  const pa = a.split(':').map((x) => parseInt(x, 16));
  const pb = b.split(':').map((x) => parseInt(x, 16));
  if (pa.length !== 6 || pb.length !== 6 || pa.some(Number.isNaN) || pb.some(Number.isNaN)) return false;
  if ((pa[0] & ~0x02) !== (pb[0] & ~0x02) || pa[1] !== pb[1] || pa[2] !== pb[2]) return false;
  if (!((pa[0] | pb[0]) & 0x02)) {
    return pa[3] === pb[3] && pa[4] === pb[4] && (pa[5] & 0xf8) === (pb[5] & 0xf8);
  }
  let bits = 0;
  for (let i = 3; i < 6; i++) {
    for (let x = pa[i] ^ pb[i]; x; x >>= 1) bits += x & 1;
  }
  return bits <= 3;
}

// Marks the user's own access points (connected BSSID, same SSID, or sibling BSSIDs of the same
// router) so they are not counted as competing neighbours.
function markOwn(networks, info) {
  for (const n of networks) {
    if (n.own) continue;
    if (info.bssid && n.bssid === info.bssid) n.own = true;
    else if (info.ssid && n.ssid && n.ssid === info.ssid) n.own = true;
    else if (info.bssid && siblingBssid(n.bssid, info.bssid)) n.own = true;
  }
}

function neighboursOn(networks, band, channel, width) {
  let count = 0;
  let weight = 0;
  for (const n of networks) {
    if (n.band !== band || n.own) continue;
    if (!overlaps(band, channel, width, n.channel, n.widthMHz)) continue;
    count += 1;
    weight += Number.isFinite(n.signalPct) ? n.signalPct : 50;
  }
  return { count, weight };
}

const CANDIDATES_24 = [1, 6, 11];
const NON_DFS_5 = [36, 40, 44, 48, 149, 153, 157, 161, 165];
const DFS_5 = [52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144];

function buildCongestion(networks, current) {
  const out = [];
  const seen = new Set();
  const add = (band, channel) => {
    const key = `${band}:${channel}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ channel, band, count: neighboursOn(networks, band, channel, null).count });
  };
  const bands = new Set(networks.map((n) => n.band));
  if (current.band) bands.add(current.band);
  if (bands.has('2.4')) CANDIDATES_24.forEach((c) => add('2.4', c));
  if (bands.has('5')) NON_DFS_5.forEach((c) => add('5', c));
  for (const n of networks) add(n.band, n.channel);
  if (current.channel && current.band) add(current.band, current.channel);
  out.sort((a, b) => (a.band === b.band ? a.channel - b.channel : Number(a.band) - Number(b.band)));
  return out;
}

function recommend(networks, info) {
  const band = info.band;
  const channel = info.channel;
  if (!band || !Number.isFinite(channel)) return null;
  if (band !== '2.4' && band !== '5') return null; // 6 GHz is rarely crowded; no advice
  const width = info.widthMHz;
  const now = neighboursOn(networks, band, channel, width);

  const score = (c) => ({ channel: c, ...neighboursOn(networks, band, c, width) });
  const better = (a, b) => a.count - b.count || a.weight - b.weight;

  let best;
  let dfs = false;
  if (band === '2.4') {
    best = CANDIDATES_24.map(score).sort(better)[0];
  } else {
    best = NON_DFS_5.map(score).sort(better)[0];
    const bestDfs = DFS_5.map(score).sort(better)[0];
    // DFS only when it is clearly better: at least two fewer neighbours than the best non-DFS option.
    if (bestDfs && bestDfs.count <= best.count - 2) {
      best = bestDfs;
      dfs = true;
    }
  }
  if (!best || best.channel === channel) return null;
  if (best.count >= now.count) return null;
  // Skip moves inside the same wide block: they change nothing for a wide channel.
  if (band === '5' && width && width > 20 && occupied5(channel, width).includes(best.channel)) return null;

  const bandLabel = band === '2.4' ? '2.4 GHz' : '5 GHz';
  const plural = (n) => (n === 1 ? '1 network' : `${n} networks`);
  let reason =
    `On ${bandLabel}, channel ${channel} currently shares airtime with ${plural(now.count)} nearby; ` +
    `channel ${best.channel} overlaps with ${plural(best.count)}. ` +
    'Fewer overlapping networks means less waiting to transmit and more stable speed. ' +
    "Change the channel in your router's Wi-Fi settings (set it manually instead of Auto).";
  if (band === '2.4') reason += ' On 2.4 GHz only channels 1, 6 and 11 avoid partial overlap.';
  if (dfs) {
    reason +=
      ' This is a DFS channel: the router must listen for radar first, so Wi-Fi may take about a minute to come up and can briefly move channels if radar is detected.';
  }
  if (!width) reason += ' Counts assume 20 MHz channels because channel width is not reported on this computer.';
  return { channel: best.channel, band, reason, neighboursNow: now.count, neighboursThere: best.count };
}

function dedupe(networks) {
  const byKey = new Map();
  for (const n of networks) {
    const key = n.bssid || `${n.ssid}|${n.band}|${n.channel}|${n.own ? 'own' : n.rssi}`;
    const prev = byKey.get(key);
    if (!prev || (n.signalPct || 0) > (prev.signalPct || 0) || n.own) byKey.set(key, { ...n, own: n.own || (prev && prev.own) });
  }
  return [...byKey.values()];
}

// ---------- exports ----------

async function wifiInfo() {
  try {
    if (process.platform === 'win32') return await wifiInfoWin();
    if (process.platform === 'darwin') return await wifiInfoMac();
    return emptyInfo(false, ['Wi-Fi details are only available on Windows and macOS.']);
  } catch (err) {
    return emptyInfo(false, ['Wi-Fi info failed: ' + String((err && err.message) || err)]);
  }
}

async function wifiSurvey() {
  try {
    if (process.platform !== 'win32' && process.platform !== 'darwin') {
      return emptySurvey(false, ['Wi-Fi survey is only available on Windows and macOS.']);
    }
    let info;
    let scan;
    if (process.platform === 'win32') {
      [info, scan] = await Promise.all([wifiInfo(), surveyWin()]);
    } else {
      const airport = await macAirport();
      [info, scan] = await Promise.all([wifiInfoMac(airport), surveyMac(airport)]);
    }
    const current = { channel: info.channel, band: info.band };
    if (!scan.supported) return emptySurvey(false, scan.errors, current);

    const networks = dedupe(scan.networks).filter((n) => n.band === '2.4' || n.band === '5' || n.band === '6');
    markOwn(networks, info);
    const errors = [...scan.errors];
    if (!info.ssid && info.supported && !info.channel) {
      errors.push('Not connected to Wi-Fi, so there is no current channel to compare.');
    }
    const recommendation = recommend(networks, info);
    networks.sort((a, b) => (b.signalPct || 0) - (a.signalPct || 0));
    return {
      supported: true,
      networks: networks.map((n) => ({
        ssid: n.ssid,
        bssid: n.bssid,
        channel: n.channel,
        band: n.band,
        signalPct: n.signalPct,
        rssi: n.rssi,
        own: Boolean(n.own), // extra field: the user's own router, not counted as a neighbour
      })),
      congestion: buildCongestion(networks, current),
      current,
      recommendation,
      errors,
    };
  } catch (err) {
    return emptySurvey(false, ['Wi-Fi survey failed: ' + String((err && err.message) || err)]);
  }
}

module.exports = {
  wifiInfo,
  wifiSurvey,
  // exported for tests
  _internal: { parseWinInterfaces, parseWinNetworks, parseMacChannel, parseMacSignal, occupied5, recommend, decodeOutput, siblingBssid, winScanProblem },
};
