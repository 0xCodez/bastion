'use strict';

// AI agents: provider registry, key storage and the ask/test entry points used
// by electron/main.js. Every exported function resolves with data and never
// throws; failures come back as { ok: false, error }.

const keystore = require('./keystore');
const prompt = require('./prompt');
const cli = require('./cli');

// kind 'api': the user's own API key. kind 'cli': the user's Claude / ChatGPT
// subscription through the official CLI they are signed in to (agents/cli.js).
const PROVIDERS = {
  claude: { name: 'Claude', vendor: 'Anthropic', kind: 'api', load: () => require('./claude') },
  openai: { name: 'ChatGPT', vendor: 'OpenAI', kind: 'api', load: () => require('./openai') },
  grok: { name: 'Grok', vendor: 'xAI', kind: 'api', load: () => require('./grok') },
  'claude-cli': { name: 'Claude (my subscription)', vendor: 'Anthropic', kind: 'cli', base: 'claude' },
  'codex-cli': { name: 'ChatGPT (my subscription)', vendor: 'OpenAI', kind: 'cli', base: 'openai' },
};

// Static model info, kept here so providers() works without loading any SDK.
const MODEL_INFO = {
  claude: { defaultModel: 'claude-opus-5-5', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] },
  openai: { defaultModel: 'gpt-5', models: ['gpt-5', 'gpt-5-mini'] },
  grok: { defaultModel: 'grok-4', models: ['grok-4', 'grok-4-fast'] },
  // 'default' = no model flag: the CLI uses the user's own default.
  'claude-cli': { defaultModel: 'default', models: ['default', 'opus', 'sonnet', 'haiku'] },
  'codex-cli': { defaultModel: 'default', models: ['default'] },
};

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,99}$/;
const inFlight = new Map(); // id -> AbortController of the running ask()
// Overall limit for one ask(), retries included, so a hung request can never
// hold the per-provider lock (watch mode included) for long.
const ASK_DEADLINE_MS = 4 * 60 * 1000;
let initialized = false;

function errMessage(err) {
  return String((err && err.message) || err || 'Unknown error').slice(0, 300);
}

function isProvider(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, id);
}

function currentModel(id) {
  return keystore.getModel(id) || MODEL_INFO[id].defaultModel;
}

function isCliProvider(id) {
  return isProvider(id) && PROVIDERS[id].kind === 'cli';
}

function init(userDataDir) {
  try {
    cli.init(userDataDir);
    const r = keystore.init(userDataDir);
    initialized = r.ok;
    return { ok: r.ok };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

function notReady() {
  return initialized ? null : 'AI agents are not initialized yet.';
}

// For 'cli' providers hasKey means "installed and usable" (signed in, or not
// known to be signed out), and `cli` carries the detection result.
// cli.ready is stricter: signed in for sure, and not with an API key. Only a
// ready subscription goes first in the UI and is picked by Auto.
// opts.refresh: check the CLIs again now instead of using the cached status.
async function providers(opts) {
  try {
    const force = Boolean(opts && opts.refresh);
    const ids = Object.keys(PROVIDERS);
    const statuses = await Promise.all(ids.map((id) => (isCliProvider(id) ? cli.status(id, { force }) : null)));
    return ids.map((id, i) => {
      const model = currentModel(id);
      const st = statuses[i];
      const models = [...MODEL_INFO[id].models];
      if (st && Array.isArray(st.models)) for (const m of st.models) if (!models.includes(m)) models.push(m);
      if (!models.includes(model)) models.push(model);
      if (!st) return { id, name: PROVIDERS[id].name, kind: 'api', hasKey: keystore.hasKey(id), model, models };
      const spec = cli.SPECS[id];
      const apiKeyLogin = st.authMethod === 'api_key' || st.authMethod === 'api_key_helper';
      return {
        id,
        name: PROVIDERS[id].name,
        kind: 'cli',
        hasKey: Boolean(st.installed && st.loggedIn !== false),
        model,
        models,
        cli: {
          installed: Boolean(st.installed),
          ready: Boolean(st.installed && st.loggedIn === true && !apiKeyLogin),
          version: st.version || null,
          loggedIn: typeof st.loggedIn === 'boolean' ? st.loggedIn : null,
          path: st.path || null,
          authMethod: st.authMethod || null,
          product: spec.product,
          installCommand: spec.install,
          loginCommand: spec.login,
          error: st.error || null,
          note: st.note || null,
        },
      };
    });
  } catch {
    return [];
  }
}

function setKey(id, key) {
  try {
    if (!isProvider(id)) return { ok: false, error: 'Unknown provider.' };
    if (isCliProvider(id)) return { ok: false, error: `${PROVIDERS[id].name} uses your ${cli.SPECS[id].product} login, not an API key.` };
    const blocked = notReady();
    if (blocked) return { ok: false, error: blocked };
    const k = typeof key === 'string' ? key.trim() : '';
    if (!k) return { ok: false, error: 'Paste an API key first.' };
    if (k.length < 20 || k.length > 512 || /[\s\u0000-\u001f\u007f]/.test(k)) {
      return { ok: false, error: 'That does not look like an API key. Copy the whole key without spaces.' };
    }
    if (id === 'claude' && !k.startsWith('sk-ant-')) {
      return { ok: false, error: 'Anthropic API keys start with "sk-ant-". Create one in the Claude Console under API keys.' };
    }
    const r = keystore.setKey(id, k);
    return r.ok ? { ok: true } : { ok: false, error: r.error || 'Could not save the key.' };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

function clearKey(id) {
  try {
    if (!isProvider(id)) return { ok: false, error: 'Unknown provider.' };
    if (isCliProvider(id)) return { ok: false, error: `${PROVIDERS[id].name} has no API key. Sign out with ${cli.SPECS[id].product} itself.` };
    const blocked = notReady();
    if (blocked) return { ok: false, error: blocked };
    const r = keystore.clearKey(id);
    return r.ok ? { ok: true } : { ok: false, error: r.error || 'Could not remove the key.' };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

// Any well-formed model id is accepted (custom models); the provider decides
// whether it exists, and test() reports that.
function setModel(id, model) {
  try {
    if (!isProvider(id)) return { ok: false, error: 'Unknown provider.' };
    const blocked = notReady();
    if (blocked) return { ok: false, error: blocked };
    const m = typeof model === 'string' ? model.trim() : '';
    if (!MODEL_RE.test(m)) return { ok: false, error: 'Invalid model name.' };
    if (isCliProvider(id) && !cli.MODEL_RE.test(m)) return { ok: false, error: 'Invalid model name.' };
    if (id === 'claude' && !m.startsWith('claude-')) return { ok: false, error: 'Claude model names start with "claude-".' };
    const r = keystore.setModel(id, m);
    return r.ok ? { ok: true } : { ok: false, error: r.error || 'Could not save the model.' };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

function keyOrError(id) {
  if (!keystore.hasKey(id)) {
    return { error: `No API key saved for ${PROVIDERS[id].name}. Add your ${PROVIDERS[id].vendor} key in Agents settings.` };
  }
  const apiKey = keystore.getKey(id);
  if (!apiKey) return { error: `The saved ${PROVIDERS[id].name} key could not be decrypted on this account. Remove it and add it again.` };
  return { apiKey };
}

async function test(id) {
  try {
    if (!isProvider(id)) return { ok: false, error: 'Unknown provider.' };
    const blocked = notReady();
    if (blocked) return { ok: false, error: blocked };
    const model = currentModel(id);
    if (isCliProvider(id)) {
      // Same lock and cancel path as ask(): one CLI run per provider at a time.
      if (inFlight.get(id)) return { ok: false, model, error: `${PROVIDERS[id].name} is still answering the previous question.` };
      const controller = new AbortController();
      inFlight.set(id, controller);
      try {
        const r = await cli.test(id, model, controller.signal);
        if (!r.ok && controller.signal.aborted) return { ok: false, model, error: 'Cancelled.' };
        return r.ok ? { ok: true, model: r.model || model } : { ok: false, model: r.model || model, error: r.error };
      } finally {
        if (inFlight.get(id) === controller) inFlight.delete(id);
      }
    }
    const { apiKey, error } = keyOrError(id);
    if (error) return { ok: false, model, error };
    const r = await PROVIDERS[id].load().test({ apiKey, model });
    return r.ok ? { ok: true, model: r.model || model } : { ok: false, model: r.model || model, error: r.error };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

async function ask(id, question, snapshot) {
  const base = { ok: false, provider: isProvider(id) ? id : String(id || ''), model: '', text: '' };
  try {
    if (!isProvider(id)) return { ...base, error: 'Unknown provider.' };
    const blocked = notReady();
    const model = currentModel(id);
    if (blocked) return { ...base, model, error: blocked };
    const q = typeof question === 'string' ? question.trim() : '';
    if (!q) return { ...base, model, error: 'Type a question first.' };
    let apiKey = null;
    if (!isCliProvider(id)) {
      const k = keyOrError(id);
      if (k.error) return { ...base, model, error: k.error };
      apiKey = k.apiKey;
    }
    if (inFlight.get(id)) return { ...base, model, error: `${PROVIDERS[id].name} is still answering the previous question.` };

    const controller = new AbortController();
    inFlight.set(id, controller);
    let timer = null;
    try {
      const userText = prompt.buildUserMessage(q, snapshot);
      const deadline = new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort('deadline');
          resolve({ ok: false, model, text: '', error: `${PROVIDERS[id].name} did not answer within ${ASK_DEADLINE_MS / 60000} minutes. Try again, or pick a faster model.` });
        }, ASK_DEADLINE_MS);
      });
      // Same privacy-minimised message and system prompt for every provider kind.
      const call = isCliProvider(id)
        ? cli.ask(id, { model, system: prompt.SYSTEM_PROMPT, userText, signal: controller.signal })
        : PROVIDERS[id].load().ask({ apiKey, model, system: prompt.SYSTEM_PROMPT, userText, signal: controller.signal });
      let r = await Promise.race([call, deadline]);
      if (!r.ok && controller.signal.aborted && controller.signal.reason === 'cancelled') {
        r = { ok: false, model, text: '', error: 'Cancelled.' };
      }
      const out = { ok: Boolean(r.ok), provider: id, model: r.model || model, text: r.ok ? r.text : (r.text || '') };
      if (!r.ok) out.error = r.error || 'The request failed.';
      return out;
    } finally {
      clearTimeout(timer);
      if (inFlight.get(id) === controller) inFlight.delete(id);
    }
  } catch (err) {
    return { ...base, error: errMessage(err) };
  }
}

// Stops a running ask() or CLI test() for this provider; it resolves with
// "Cancelled.". The lock stays until that call has settled (the CLI is dead or
// the kill grace period ran out), so a new question cannot overlap the old run.
function cancel(id) {
  try {
    const controller = isProvider(id) ? inFlight.get(id) : null;
    if (!controller) return { ok: true, cancelled: false };
    if (!controller.signal.aborted) controller.abort('cancelled');
    return { ok: true, cancelled: true };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

// App quit: cancel every request and kill every CLI still running, so nothing
// keeps using the user's subscription after Bastion is gone.
function shutdown() {
  try {
    for (const controller of inFlight.values()) {
      try { if (!controller.signal.aborted) controller.abort('cancelled'); } catch { /* ignore */ }
    }
    cli.killAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

// Exactly what ask() sends with a question (privacy-minimized snapshot and the
// system prompt), for the Settings preview. Nothing leaves the machine.
function preview(snapshot) {
  try {
    return { ok: true, snapshot: prompt.minimizeSnapshot(snapshot), system: prompt.SYSTEM_PROMPT };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

module.exports = { init, providers, setKey, clearKey, setModel, test, ask, cancel, shutdown, preview };
