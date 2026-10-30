// Speech-to-text worker: Whisper (onnx-community/whisper-base, multilingual) through
// transformers.js, entirely on this computer. WebGPU when the GPU allows it, else WebAssembly.
// The model is downloaded once from huggingface.co and kept in Cache Storage
// ('transformers-cache'); after that it loads offline. The ONNX Runtime wasm comes from the
// local node_modules copy, never from a CDN.
//
// In:  { type: 'load' }
//      { type: 'transcribe', id, audio: Float32Array /* 16 kHz mono */ }
// Out: { type: 'status', phase: 'download' | 'load', loaded, total, mb }
//      { type: 'ready', device, ms, cached }
//      { type: 'result', id, text, ms }
//      { type: 'error', id?, stage: 'load' | 'transcribe', message, network }

import { env, pipeline, Tensor } from '../../../node_modules/@huggingface/transformers/dist/transformers.min.js';

const MODEL = 'onnx-community/whisper-base';
const ORT_DIST = new URL('../../../node_modules/onnxruntime-web/dist/', import.meta.url).href;

// Sizes of the ONNX files we fetch (MB, from the model repo), for an honest "≈N MB" up front.
// Tokenizer and config files add about 3 MB.
const CONFIGS = {
  webgpu: { dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, files: { 'onnx/encoder_model.onnx': 82.5, 'onnx/decoder_model_merged_q4.onnx': 123.6 } },
  wasm: { dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, files: { 'onnx/encoder_model_quantized.onnx': 23.2, 'onnx/decoder_model_merged_quantized.onnx': 53.7 } },
};
const EXTRA_MB = 3;

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
// The wasm cache would turn the runtime into a blob: module; it is local already, so skip it.
env.useWasmCache = false;
const onnx = env.backends && env.backends.onnx;
if (onnx && onnx.wasm) {
  onnx.wasm.wasmPaths = {
    mjs: ORT_DIST + 'ort-wasm-simd-threaded.asyncify.mjs',
    wasm: ORT_DIST + 'ort-wasm-simd-threaded.asyncify.wasm',
  };
  onnx.wasm.proxy = false;
  onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, (navigator.hardwareConcurrency || 2) - 1) : 1;
}

let asr = null;
let loading = null;
let device = null;

const post = (msg) => self.postMessage(msg);
const errText = (err) => String((err && err.message) || err || 'Unknown error');
const isNetwork = (err) => /fetch|network|Failed to load|ERR_|offline|status 5\d\d|status 4\d\d|Could not locate/i.test(errText(err));

async function hasWebGPU() {
  try {
    if (!self.navigator || !navigator.gpu) return false;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    return Boolean(adapter);
  } catch {
    return false;
  }
}

// True when every ONNX file of this config is in the transformers cache already.
async function isCached(cfg) {
  try {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open(env.cacheKey || 'transformers-cache');
    for (const f of Object.keys(cfg.files)) {
      const hit = await cache.match(`https://huggingface.co/${MODEL}/resolve/main/${f}`);
      if (!hit) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function build(dev, forced) {
  const cfg = CONFIGS[dev];
  const cached = await isCached(cfg);
  const mb = Math.round(Object.values(cfg.files).reduce((a, b) => a + b, 0) + EXTRA_MB);
  const phase = cached ? 'load' : 'download';
  post({ type: 'status', phase, loaded: 0, total: mb * 1e6, mb, device: dev });
  let last = 0;
  const t0 = performance.now();
  const p = await pipeline('automatic-speech-recognition', MODEL, {
    device: dev,
    dtype: (forced && forced.dtype) || cfg.dtype,
    progress_callback: (info) => {
      if (!info || info.status !== 'progress_total') return;
      const now = performance.now();
      if (now - last < 120 && info.progress < 100) return;
      last = now;
      post({ type: 'status', phase, loaded: info.loaded || 0, total: Math.max(info.total || 0, mb * 1e6), mb, device: dev });
    },
  });
  return { p, cached, ms: Math.round(performance.now() - t0) };
}

function load(forced) {
  if (asr) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    const wanted = (forced && forced.device) || ((await hasWebGPU()) ? 'webgpu' : 'wasm');
    let built;
    try {
      built = await build(wanted, forced);
      device = wanted;
    } catch (err) {
      // A GPU that refuses the model falls back to WebAssembly (not for download failures).
      if (wanted !== 'webgpu' || isNetwork(err) || (forced && forced.device)) throw err;
      console.warn('[voice] WebGPU failed, using WebAssembly:', errText(err));
      built = await build('wasm', null);
      device = 'wasm';
    }
    asr = built.p;
    // Warm up once so the first real question is not the slow one.
    try { await asr(new Float32Array(16000), { language: 'en', task: 'transcribe', return_timestamps: false }); } catch { /* warm-up is best effort */ }
    post({ type: 'ready', device, ms: built.ms, cached: built.cached });
  })();
  loading.catch(() => {}).finally(() => { if (!asr) loading = null; });
  return loading;
}

// transformers.js would default a multilingual Whisper to English, so detect the language
// first: one decoder step after <|startoftranscript|> gives the language-token probabilities
// (on the first 30 s). Languages the system prefers win close calls on short clips.
const PREFERRED = [...new Set([...(self.navigator && navigator.languages ? navigator.languages : []), 'en']
  .map((l) => String(l).toLowerCase().split('-')[0]).filter(Boolean))];

async function detectLanguage(audio) {
  const cfg = asr.model.generation_config || {};
  const langToId = cfg.lang_to_id;
  const sot = cfg.decoder_start_token_id;
  if (!langToId || sot == null) return null;
  const { input_features } = await asr.processor(audio.length > 480000 ? audio.subarray(0, 480000) : audio);
  const out = await asr.model({ input_features, decoder_input_ids: new Tensor('int64', BigInt64Array.from([BigInt(sot)]), [1, 1]) });
  const logits = out.logits;
  const vocab = logits.dims.at(-1);
  const data = logits.data;
  const base = data.length - vocab;
  const entries = Object.entries(langToId).map(([tok, id]) => [tok.slice(2, -2), Number(data[base + id])]);
  const max = Math.max(...entries.map((e) => e[1]));
  let sum = 0;
  for (const e of entries) { e[1] = Math.exp(e[1] - max); sum += e[1]; }
  entries.forEach((e) => { e[1] /= sum; });
  entries.sort((a, b) => b[1] - a[1]);
  const [top, topP] = entries[0];
  if (PREFERRED.includes(top) || topP >= 0.6) return { language: top, p: topP };
  const pref = entries.find((e) => PREFERRED.includes(e[0]));
  if (pref && pref[1] >= 0.15) return { language: pref[0], p: pref[1] };
  return { language: top, p: topP };
}

async function transcribe(id, audio, language) {
  await load();
  const t0 = performance.now();
  const seconds = audio.length / 16000;
  let lang = language;
  if (!lang) {
    try { lang = (await detectLanguage(audio) || {}).language || null; } catch (err) { console.warn('[voice] language detection failed:', errText(err)); }
  }
  const out = await asr(audio, {
    task: 'transcribe',
    ...(lang ? { language: lang } : {}),
    chunk_length_s: seconds > 29 ? 30 : undefined,
    stride_length_s: seconds > 29 ? 5 : undefined,
    return_timestamps: false,
  });
  const text = String((Array.isArray(out) ? out.map((o) => o.text).join(' ') : out && out.text) || '').replace(/s+/g, ' ').trim();
  post({ type: 'result', id, text, language: lang, ms: Math.round(performance.now() - t0) });
}

self.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'load') {
    load(msg.force || null).catch((err) => post({ type: 'error', stage: 'load', message: errText(err), network: isNetwork(err) }));
  } else if (msg.type === 'transcribe') {
    transcribe(msg.id, msg.audio, typeof msg.language === 'string' ? msg.language : null).catch((err) => {
      const stage = asr ? 'transcribe' : 'load';
      post({ type: 'error', id: msg.id, stage, message: errText(err), network: stage === 'load' && isNetwork(err) });
    });
  }
});
