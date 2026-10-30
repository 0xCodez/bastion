'use strict';

// Claude (Anthropic) via the official @anthropic-ai/sdk.

const DEFAULT_MODEL = 'claude-opus-5-5';
const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

// Models that accept server-side refusal fallbacks in the "default" form.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-fable-5', 'claude-sonnet-5-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// Per attempt; one retry at most. index.js also enforces an overall deadline.
const TIMEOUT_MS = 3 * 60 * 1000;
const MAX_RETRIES = 1;
// Explicit so a stray ANTHROPIC_BASE_URL on the user's machine cannot redirect
// requests carrying their key. BASTION_ANTHROPIC_BASE_URL is honoured only
// outside Electron (the smoke test), never in the shipped app.
const BASE_URL = (!process.versions.electron && process.env.BASTION_ANTHROPIC_BASE_URL) || 'https://api.anthropic.com';

let sdk = null;
function loadSdk() {
  if (!sdk) {
    const mod = require('@anthropic-ai/sdk');
    sdk = mod.Anthropic || mod.default || mod;
  }
  return sdk;
}

// `effort` exists on current models only; older ids reject it.
function supportsEffort(model) {
  return /^claude-(opus-4-[5-9]|opus-[5-9]|sonnet-4-6|sonnet-[5-9]|haiku-[5-9]|fable|mythos)/.test(model);
}

function scrub(text, apiKey) {
  let s = String(text || '');
  if (apiKey) s = s.split(apiKey).join('[key]');
  return s.replace(/\bsk-ant-[A-Za-z0-9_\-*]{4,}/g, '[key]').slice(0, 400);
}

function describeError(err, apiKey) {
  const Anthropic = loadSdk();
  if (err instanceof Anthropic.AuthenticationError) return 'That API key was rejected by Anthropic. Check that it is copied completely and still active.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use that model. Pick another model or check the key\'s workspace permissions.';
  if (err instanceof Anthropic.NotFoundError) return 'That model was not found for this key. Pick another model.';
  if (err instanceof Anthropic.RateLimitError) return 'Anthropic rate limit or spending limit reached. Wait a minute and try again, or check your plan limits.';
  if (err instanceof Anthropic.BadRequestError) return `Anthropic rejected the request: ${scrub(err.message, apiKey)}`;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'The request to Anthropic timed out. Try again, or pick a faster model.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach Anthropic. Check your internet connection, firewall or proxy.';
  if (err instanceof Anthropic.APIError) return `Anthropic error${err.status ? ` ${err.status}` : ''}: ${scrub(err.message, apiKey)}`;
  return `Request failed: ${scrub(err && err.message ? err.message : err, apiKey)}`;
}

function buildParams(model, system, userText, { maxTokens, effort }) {
  const params = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: userText }],
  };
  if (supportsEffort(model)) params.output_config = { effort };
  return params;
}

async function request({ apiKey, model, system, userText, maxTokens = 16000, effort = 'medium', allowEmpty = false, signal }) {
  const Anthropic = loadSdk();
  const client = new Anthropic({ apiKey, baseURL: BASE_URL, timeout: TIMEOUT_MS, maxRetries: MAX_RETRIES });
  const params = buildParams(model, system, userText, { maxTokens, effort });

  const opts = signal ? { signal } : undefined;
  try {
    let response;
    if (FALLBACK_MODELS.has(model)) {
      response = await client.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' }, opts);
    } else {
      response = await client.messages.create(params, opts);
    }

    const servedBy = response.model || model;
    if (response.stop_reason === 'refusal') {
      const details = response.stop_details || {};
      const parts = ['Claude declined to answer this request'];
      if (details.category) parts.push(` (category: ${details.category})`);
      parts.push('.');
      if (details.explanation) parts.push(` ${scrub(details.explanation)}`);
      return { ok: false, model: servedBy, text: '', error: parts.join('') };
    }

    let text = (response.content || [])
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n\n')
      .trim();

    if (response.stop_reason === 'max_tokens') {
      text = `${text}\n\n[The answer was cut off at the length limit. Ask a narrower question for the rest.]`.trim();
    }
    if (!text && !allowEmpty) return { ok: false, model: servedBy, text: '', error: 'Claude returned an empty answer.' };
    return { ok: true, model: servedBy, text };
  } catch (err) {
    return { ok: false, model, text: '', error: describeError(err, apiKey) };
  }
}

function ask({ apiKey, model, system, userText, signal }) {
  return request({ apiKey, model, system, userText, signal });
}

function test({ apiKey, model }) {
  return request({
    apiKey,
    model,
    system: 'You are a connectivity check.',
    userText: 'Reply with OK',
    maxTokens: 1024,
    effort: 'low',
    allowEmpty: true, // a completed call proves the key and model work
  });
}

module.exports = { id: 'claude', name: 'Claude', DEFAULT_MODEL, MODELS, ask, test };
