'use strict';

// Internet speed test against Cloudflare's public speed endpoints (speed.cloudflare.com).
// - Ping/jitter: sequential empty requests over a warm connection, minus the server's own
//   processing time reported in server-timing.
// - Download: escalating sizes on parallel streams. Bytes are counted as they arrive, sampled in
//   short time windows; the result is the 90th percentile of those samples (warm-up excluded).
//   Warm-up ends after WARMUP_MS or when the first large round starts, whichever comes first, so a
//   gigabit link that reaches the byte cap in under a second is not measured during slow start.
// - Upload: parallel streams of POSTs. Bytes handed to the socket are not proof of delivery
//   (OS and HTTP buffers absorb megabytes), so each request is timed until Cloudflare answers,
//   and its bytes are spread evenly over its own duration. Summing that over all streams gives the
//   link rate in each time window without double counting; the result is the 90th percentile.
// Resolves with a SpeedResult and never throws; problems go in errors[].

const crypto = require('node:crypto');

const BASE = 'https://speed.cloudflare.com';

const PING_COUNT = 12;
const PING_TIMEOUT = 5000;

const DOWN_SIZES = [2e6, 25e6, 50e6]; // few, large requests: Cloudflare rate-limits many small ones (HTTP 429)
const DOWN_STREAMS = 3;
const DOWN_BYTE_CAP = 100e6; // hard cap on downloaded bytes per test
const DOWN_WARM_SIZE = 10e6; // the first round of this size ends the download warm-up early

// Starts small so a slow uplink (ADSL, weak LTE, satellite) still finishes requests within the phase.
const UP_SIZES = [100e3, 1e6, 5e6, 10e6];
const UP_WARM_STEP = 2; // the first 5 MB request ends the upload warm-up early
const UP_STREAMS = 3;
const UP_BYTE_CAP = 50e6; // hard cap on uploaded bytes per test

const PHASE_MS = 8000; // each throughput phase stops after this long
const TICK_MS = 100; // progress events ~10x per second
const WINDOW_MS = 500; // download sample window
const WARMUP_MS = 1000; // samples before this point are ignored (TCP slow start)

// Overall progress ranges per phase.
const RANGES = { ping: [0, 0.1], download: [0.1, 0.55], upload: [0.55, 1] };

let current = null; // { controller } of the running test

function nowMs() {
  return performance.now();
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

function measId() {
  return crypto.randomBytes(8).toString('hex');
}

function isAbort(err) {
  return Boolean(err && (err.name === 'AbortError' || err.code === 'ABORT_ERR'));
}

function describe(err) {
  if (!err) return 'unknown error';
  const cause = err.cause && (err.cause.code || err.cause.message);
  return cause ? `${err.message} (${cause})` : String(err.message || err);
}

// Server-side processing time in ms: sum of every "dur=" in server-timing
// (e.g. "cfSpeedEdge;dur=7, cfSpeedWorker;dur=47"), ignoring the cfL4 transport report.
function serverDuration(headers) {
  const st = headers.get('server-timing') || '';
  let total = 0;
  for (const entry of st.split(',')) {
    if (/^\s*cfL4\b/i.test(entry)) continue;
    const m = entry.match(/(?:^|;)\s*dur=([\d.]+)/);
    if (m) total += Number(m[1]);
  }
  return total;
}

function noteServer(res, state) {
  if (state.server) return;
  // cf-meta-colo is not sent on every response; the cf-ray suffix names the same data centre.
  const ray = (res.headers.get('cf-ray') || '').match(/-([A-Z]{3})$/);
  const colo = res.headers.get('cf-meta-colo') || (ray ? ray[1] : null);
  if (colo) {
    const city = res.headers.get('cf-meta-city');
    state.server = city ? `Cloudflare ${colo} (${city})` : `Cloudflare ${colo}`;
  }
}

// Releases the socket of a response whose body will not be read.
async function discard(res) {
  try {
    if (res && res.body) await res.body.cancel();
  } catch {
    // already consumed or closed
  }
}

// Links an abort signal to a parent so cancelling the test cancels every request.
function childController(parent) {
  const c = new AbortController();
  if (parent.aborted) c.abort();
  else parent.addEventListener('abort', () => c.abort(), { once: true });
  return c;
}

// ---------- ping ----------

async function runPing(signal, emit, state) {
  const rtts = [];
  let failures = 0;
  // One warm-up request opens the TLS connection so the samples measure round trips, not handshakes.
  for (let i = 0; i <= PING_COUNT; i++) {
    if (signal.aborted) break;
    const c = childController(signal);
    const timer = setTimeout(() => c.abort(), PING_TIMEOUT);
    const t0 = nowMs();
    try {
      const res = await fetch(`${BASE}/__down?bytes=0&measId=${measId()}`, { signal: c.signal, cache: 'no-store' });
      const t1 = nowMs();
      noteServer(res, state);
      if (res.status === 429) state.rateLimited = true;
      if (!res.ok) {
        await discard(res);
        throw new Error(`HTTP ${res.status}`);
      }
      await res.arrayBuffer();
      if (i > 0) {
        rtts.push(Math.max(0.1, t1 - t0 - serverDuration(res.headers)));
        emit({ phase: 'ping', pingMs: round1(median(rtts)), progress: i / PING_COUNT });
      }
    } catch (err) {
      if (signal.aborted) break;
      failures += 1;
      if (!state.firstError) state.firstError = describe(err);
      if (failures >= 3 && rtts.length === 0) break;
    } finally {
      clearTimeout(timer);
    }
  }
  if (!rtts.length) return null;
  let diff = 0;
  for (let i = 1; i < rtts.length; i++) diff += Math.abs(rtts[i] - rtts[i - 1]);
  return { pingMs: round1(median(rtts)), jitterMs: rtts.length > 1 ? round1(diff / (rtts.length - 1)) : 0 };
}

// ---------- download ----------

async function runDownload(signal, emit, state) {
  const phase = childController(signal);
  const start = nowMs();
  const marks = [{ t: start, bytes: 0 }];
  const samples = [];
  let bytes = 0;
  let lastAt = start; // when the most recent bytes arrived
  let warm = null; // { t, bytes } at the end of warm-up
  let live = 0;
  let firstError = null;

  const endWarmup = (t) => {
    if (!warm) warm = { t, bytes };
  };

  const tick = () => {
    const t = nowMs();
    if (t - start >= WARMUP_MS) endWarmup(t);
    marks.push({ t, bytes });
    while (marks.length > 2 && t - marks[1].t >= WINDOW_MS) marks.shift();
    const dt = t - marks[0].t;
    if (dt >= WINDOW_MS * 0.8) {
      live = ((bytes - marks[0].bytes) * 8) / (dt / 1000) / 1e6;
      // Only windows that lie entirely after warm-up count toward the result.
      if (warm && marks[0].t >= warm.t) samples.push(live);
    }
    if (bytes >= DOWN_BYTE_CAP) phase.abort();
    const progress = Math.min(1, Math.max((t - start) / PHASE_MS, bytes / DOWN_BYTE_CAP));
    emit({ phase: 'download', mbps: round2(live), progress });
  };

  const one = async (size) => {
    const res = await fetch(`${BASE}/__down?bytes=${Math.round(size)}&measId=${measId()}`, {
      signal: phase.signal,
      cache: 'no-store',
    });
    noteServer(res, state);
    if (res.status === 429) state.rateLimited = true;
    if (!res.ok || !res.body) {
      await discard(res);
      throw new Error(`download HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        lastAt = nowMs();
      }
    } finally {
      reader.releaseLock();
    }
  };

  const stopTimer = setTimeout(() => phase.abort(), PHASE_MS);
  const ticker = setInterval(tick, TICK_MS);
  try {
    for (const size of DOWN_SIZES) {
      if (phase.signal.aborted) break;
      if (size >= DOWN_WARM_SIZE) endWarmup(nowMs());
      const results = await Promise.allSettled(Array.from({ length: DOWN_STREAMS }, () => one(size)));
      for (const r of results) {
        if (r.status === 'rejected' && !isAbort(r.reason) && !phase.signal.aborted && !firstError) {
          firstError = describe(r.reason);
        }
      }
      if (bytes === 0 && firstError) break; // nothing works; do not keep hammering
    }
  } finally {
    clearTimeout(stopTimer);
    clearInterval(ticker);
  }

  if (bytes === 0) return { mbps: 0, error: firstError || 'no data received', warning: null };
  let mbps;
  if (samples.length >= 3) {
    mbps = percentile(samples, 90);
  } else if (warm && lastAt - warm.t >= 200 && bytes > warm.bytes) {
    // Too few windows (fast link hitting the byte cap early): average after warm-up only, so TLS
    // setup, slow start and the small first rounds do not drag the figure down.
    mbps = ((bytes - warm.bytes) * 8) / ((lastAt - warm.t) / 1000) / 1e6;
  } else {
    // Very little data overall: average over the whole phase, which is conservative.
    mbps = (bytes * 8) / (Math.max(1, lastAt - start) / 1000) / 1e6;
  }
  const warning = firstError ? `some download streams failed (${firstError}), so the result may read low.` : null;
  return { mbps: round2(mbps), error: null, warning };
}

// ---------- upload ----------

let randomBlock = null;
function getRandomBlock() {
  if (!randomBlock) randomBlock = crypto.randomBytes(1 << 20); // 1 MiB of incompressible data
  return randomBlock;
}

function uploadBody(size) {
  const block = getRandomBlock();
  if (size <= block.length) return block.subarray(0, size);
  const parts = [];
  for (let left = size; left > 0; left -= block.length) parts.push(block.subarray(0, Math.min(block.length, left)));
  return Buffer.concat(parts, size);
}

async function runUpload(signal, emit, state) {
  const phase = childController(signal);
  const start = nowMs();
  const latest = new Array(UP_STREAMS).fill(null); // latest completed rate per stream, in Mbps (sizing only)
  const done = []; // completed requests: { t0, t1, bytes }
  let issued = 0;
  let completedBytes = 0;
  let warmAt = start + WARMUP_MS; // moved earlier when the first large request starts
  let live = 0;
  let firstError = null;
  const bodies = new Map();
  const bodyFor = (size) => {
    if (!bodies.has(size)) bodies.set(size, uploadBody(size));
    return bodies.get(size);
  };

  // Mbps delivered in [a, b], crediting each finished request's bytes evenly across its duration.
  const rateIn = (a, b) => {
    let bytes = 0;
    for (const r of done) {
      const overlap = Math.min(b, r.t1) - Math.max(a, r.t0);
      if (overlap > 0) bytes += (r.bytes * overlap) / (r.t1 - r.t0);
    }
    return (bytes * 8) / ((b - a) / 1000) / 1e6;
  };

  const tick = () => {
    const t = nowMs();
    if (done.length) {
      // Live figure trails slightly: it covers the second before the most recent confirmed upload.
      const lastEnd = Math.max(...done.map((r) => r.t1));
      live = rateIn(Math.max(start, lastEnd - 1000), lastEnd);
    }
    const progress = Math.min(1, Math.max((t - start) / PHASE_MS, issued / UP_BYTE_CAP));
    emit({ phase: 'upload', mbps: round2(live), progress });
  };

  const stream = async (idx) => {
    let step = 0;
    while (!phase.signal.aborted && issued < UP_BYTE_CAP) {
      let size = UP_SIZES[step];
      const remainingMs = PHASE_MS - (nowMs() - start);
      // Do not start a request that cannot finish before the phase ends at the current rate.
      if (latest[idx] && step > 0) {
        const expectMs = ((size * 8) / (latest[idx] * 1e6)) * 1000;
        if (expectMs > remainingMs) size = UP_SIZES[--step];
      }
      issued += size;
      const t0 = nowMs();
      if (step >= UP_WARM_STEP && t0 < warmAt) warmAt = t0;
      let res;
      try {
        res = await fetch(`${BASE}/__up?measId=${measId()}`, {
          method: 'POST',
          body: bodyFor(size),
          signal: phase.signal,
          cache: 'no-store',
          headers: { 'content-type': 'application/octet-stream' },
        });
        if (res.ok) await res.arrayBuffer();
      } catch (err) {
        if (!isAbort(err) && !phase.signal.aborted && !firstError) firstError = describe(err);
        if (!isAbort(err)) await new Promise((r) => setTimeout(r, 200));
        if (completedBytes === 0 && firstError) return;
        continue;
      }
      const t1 = nowMs();
      noteServer(res, state);
      if (!res.ok) {
        if (res.status === 429) state.rateLimited = true;
        if (!firstError) firstError = `upload HTTP ${res.status}`;
        await discard(res);
        return;
      }
      // No server-timing subtraction here: Cloudflare's worker time includes receiving the body.
      const seconds = Math.max(0.001, (t1 - t0) / 1000);
      latest[idx] = (size * 8) / seconds / 1e6;
      done.push({ t0, t1, bytes: size });
      completedBytes += size;
      if (seconds < 1.5 && step < UP_SIZES.length - 1) step += 1;
    }
  };

  const stopTimer = setTimeout(() => phase.abort(), PHASE_MS);
  const ticker = setInterval(tick, TICK_MS);
  try {
    await Promise.allSettled(Array.from({ length: UP_STREAMS }, (_, i) => stream(i)));
  } finally {
    clearTimeout(stopTimer);
    clearInterval(ticker);
  }
  tick();

  if (completedBytes === 0) {
    return {
      mbps: 0,
      error: firstError || 'not even a 100 kB upload finished within 8 seconds, so the uplink is very slow (well under 1 Mbps) or stalled',
      warning: null,
    };
  }
  const firstStart = Math.min(...done.map((r) => r.t0));
  const lastEnd = Math.max(...done.map((r) => r.t1));
  const samples = [];
  for (let a = warmAt; a + WINDOW_MS <= lastEnd; a += TICK_MS) samples.push(rateIn(a, a + WINDOW_MS));
  let mbps;
  if (samples.length >= 3) mbps = percentile(samples, 90);
  else if (lastEnd - warmAt >= 200) mbps = rateIn(warmAt, lastEnd); // too few windows: average after warm-up
  else mbps = rateIn(firstStart, lastEnd); // very little data: overall average, which is conservative
  // Requests cut off at the end of the phase are not counted, so only a few completions means a floor.
  const warning =
    done.length < UP_STREAMS * 2
      ? 'only a few uploads finished before the time limit, so this is a lower bound.'
      : firstError
        ? `some upload requests failed (${firstError}), so the result may read low.`
        : null;
  return { mbps: round2(mbps), error: null, warning };
}

// ---------- exports ----------

async function speedTest(onProgress) {
  const at = new Date().toISOString();
  if (current) {
    return { pingMs: 0, jitterMs: 0, downMbps: 0, upMbps: 0, server: '', at, errors: ['A speed test is already running.'] };
  }
  const controller = new AbortController();
  current = { controller };
  const signal = controller.signal;
  const errors = [];
  const state = { server: null, firstError: null, rateLimited: false };
  const result = { pingMs: 0, jitterMs: 0, downMbps: 0, upMbps: 0, server: '', at, errors };

  // Maps phase-local progress (0..1) to overall progress and never lets a listener break the test.
  const emit = (p) => {
    try {
      if (typeof onProgress !== 'function') return;
      const [a, b] = RANGES[p.phase] || [0, 1];
      onProgress({ ...p, progress: round2(a + (b - a) * Math.min(1, Math.max(0, p.progress || 0))) });
    } catch {
      // ignore listener errors
    }
  };
  const cancelled = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });

  try {
    emit({ phase: 'ping', progress: 0 });
    const ping = await runPing(signal, emit, state);
    if (signal.aborted) throw cancelled();
    if (!ping) {
      errors.push(
        state.rateLimited
          ? 'speed.cloudflare.com is rate-limiting this connection (HTTP 429), so no test was run. Wait a few minutes and try again.'
          : 'Could not reach speed.cloudflare.com' + (state.firstError ? `: ${state.firstError}` : '') +
              '. Check that this computer is online and that a firewall or VPN is not blocking it.'
      );
      return result;
    }
    result.pingMs = ping.pingMs;
    result.jitterMs = ping.jitterMs;

    const down = await runDownload(signal, emit, state);
    if (signal.aborted) throw cancelled();
    result.downMbps = down.mbps;
    if (down.error) errors.push('Download was not measured: ' + down.error);
    else if (down.warning) errors.push('Download: ' + down.warning);

    const up = await runUpload(signal, emit, state);
    if (signal.aborted) throw cancelled();
    result.upMbps = up.mbps;
    if (up.error) errors.push('Upload was not measured: ' + up.error);
    else if (up.warning) errors.push('Upload: ' + up.warning);
  } catch (err) {
    if (isAbort(err) || signal.aborted) errors.push('Speed test cancelled. Values that were not finished are reported as 0.');
    else errors.push('Speed test failed: ' + describe(err));
  } finally {
    if (state.rateLimited && !errors.some((e) => e.includes('HTTP 429'))) errors.push('Cloudflare rate-limited part of the test (HTTP 429), so this result may read low. Wait a few minutes and run it again.');
    result.server = state.server || 'Cloudflare';
    current = null;
    // Always ends the event stream, also after a failure or cancel. No mbps here: the result has both.
    emit({ phase: 'done', pingMs: result.pingMs, progress: 1 });
  }
  return result;
}

function cancelSpeedTest() {
  if (current) {
    current.controller.abort();
    return { ok: true };
  }
  return { ok: false };
}

module.exports = { speedTest, cancelSpeedTest };
