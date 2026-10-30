// Renderer side of the speech-to-text worker (whisper-worker.js). One worker for the app,
// started on first use. Everything stays on this computer; only the one-time model download
// reaches huggingface.co.

let worker = null;
let seq = 0;
const pending = new Map(); // id -> { resolve, reject }
const listeners = new Set();
let state = { phase: 'idle', loaded: 0, total: 0, mb: 0, device: null, error: null };
let readyWaiters = [];

function emit(patch) {
  state = { ...state, ...patch };
  for (const fn of listeners) {
    try { fn(state); } catch (err) { console.warn(err); }
  }
}

function fail(err) {
  const e = new Error(err.message || 'Speech model failed');
  e.stage = err.stage || 'load';
  e.network = Boolean(err.network);
  return e;
}

function ensureWorker(force) {
  if (worker) return worker;
  worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module', name: 'bastion-voice' });
  worker.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.type === 'status') {
      emit({ phase: m.phase, loaded: m.loaded, total: m.total, mb: m.mb, device: m.device, error: null });
    } else if (m.type === 'ready') {
      emit({ phase: 'ready', device: m.device, loadMs: m.ms, cached: m.cached, error: null });
      readyWaiters.forEach((w) => w.resolve());
      readyWaiters = [];
    } else if (m.type === 'result') {
      const p = pending.get(m.id);
      if (p) { pending.delete(m.id); p.resolve({ text: m.text, language: m.language || null, ms: m.ms }); }
    } else if (m.type === 'error') {
      const err = fail(m);
      if (m.stage === 'load') {
        emit({ phase: 'error', error: err.message, network: err.network });
        readyWaiters.forEach((w) => w.reject(err));
        readyWaiters = [];
      }
      if (m.id != null && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        p.reject(err);
      }
    }
  });
  worker.addEventListener('error', (e) => {
    const err = fail({ message: (e && e.message) || 'The speech worker stopped.', stage: 'load' });
    emit({ phase: 'error', error: err.message });
    readyWaiters.forEach((w) => w.reject(err));
    readyWaiters = [];
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    try { worker.terminate(); } catch { /* already gone */ }
    worker = null;
  });
  worker.postMessage({ type: 'load', force: force || null });
  return worker;
}

export function voiceState() {
  return state;
}

export function onVoiceState(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Starts loading (or downloading, the first time) the model. Resolves when it is ready.
export function prepareModel(force) {
  if (state.phase === 'ready') return Promise.resolve();
  const w = worker;
  ensureWorker(force);
  // Retry after a failed load: post 'load' again on the live worker.
  if (w && state.phase === 'error') { emit({ phase: 'load', error: null }); worker.postMessage({ type: 'load', force: force || null }); }
  return new Promise((resolve, reject) => readyWaiters.push({ resolve, reject }));
}

// audio: Float32Array, 16 kHz mono. Resolves { text, ms }.
export function transcribe(audio, opts = {}) {
  ensureWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ type: 'transcribe', id, audio, language: opts.language || null }, [audio.buffer]);
  });
}
