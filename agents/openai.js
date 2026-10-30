'use strict';

// ChatGPT (OpenAI) via the official `openai` SDK, Responses API.

const DEFAULT_MODEL = 'gpt-5';
const MODELS = ['gpt-5', 'gpt-5-mini'];

// Per attempt; one retry at most. index.js also enforces an overall deadline.
const TIMEOUT_MS = 3 * 60 * 1000;
const MAX_RETRIES = 1;
// Explicit so a stray OPENAI_BASE_URL cannot redirect requests carrying the key.
// BASTION_OPENAI_BASE_URL is honoured only outside Electron (the smoke test).
const BASE_URL = (!process.versions.electron && process.env.BASTION_OPENAI_BASE_URL) || 'https://api.openai.com/v1';

let sdk = null;
function loadSdk() {
  if (!sdk) {
    const mod = require('openai');
    sdk = mod.OpenAI || mod.default || mod;
  }
  return sdk;
}

// organization/project are null so OPENAI_ORG_ID / OPENAI_PROJECT_ID in the
// environment are never sent (they may not belong to the stored key, and must
// never reach xAI from grok.js).
function makeClient(apiKey, baseURL, timeout, maxRetries) {
  const OpenAI = loadSdk();
  return new OpenAI({ apiKey, baseURL, timeout, maxRetries, organization: null, project: null });
}

function scrub(text, apiKey) {
  let s = String(text || '');
  if (apiKey) s = s.split(apiKey).join('[key]');
  return s.replace(/\b(sk|xai)-[A-Za-z0-9_\-*]{4,}/g, '[key]').slice(0, 400);
}

// Shared with grok.js (xAI uses the same SDK and error classes).
function describeError(err, apiKey, vendor) {
  const OpenAI = loadSdk();
  if (err instanceof OpenAI.AuthenticationError) return `That API key was rejected by ${vendor}. Check that it is copied completely and still active.`;
  if (err instanceof OpenAI.PermissionDeniedError) return `This API key is not allowed to use that model on ${vendor}. Pick another model or check the key's permissions.`;
  if (err instanceof OpenAI.NotFoundError) return `That model was not found on ${vendor} for this key. Pick another model.`;
  if (err instanceof OpenAI.RateLimitError) return `${vendor} rate limit or quota reached. Wait a minute and try again, or check your billing.`;
  if (err instanceof OpenAI.BadRequestError) return `${vendor} rejected the request: ${scrub(err.message, apiKey)}`;
  if (err instanceof OpenAI.APIConnectionTimeoutError) return `The request to ${vendor} timed out. Try again, or pick a faster model.`;
  if (err instanceof OpenAI.APIConnectionError) return `Could not reach ${vendor}. Check your internet connection, firewall or proxy.`;
  if (err instanceof OpenAI.APIError) return `${vendor} error${err.status ? ` ${err.status}` : ''}: ${scrub(err.message, apiKey)}`;
  return `Request failed: ${scrub(err && err.message ? err.message : err, apiKey)}`;
}

function refusalText(response) {
  for (const item of response.output || []) {
    for (const part of (item && item.content) || []) {
      if (part && part.type === 'refusal' && part.refusal) return String(part.refusal);
    }
  }
  return null;
}

async function request({ apiKey, model, system, userText, maxOutputTokens, signal }) {
  const client = makeClient(apiKey, BASE_URL, TIMEOUT_MS, MAX_RETRIES);
  try {
    const params = { model, instructions: system, input: userText };
    if (maxOutputTokens) params.max_output_tokens = maxOutputTokens;
    const response = await client.responses.create(params, signal ? { signal } : undefined);
    const servedBy = response.model || model;

    if (response.error && response.error.message) {
      return { ok: false, model: servedBy, text: '', error: `OpenAI error: ${scrub(response.error.message, apiKey)}` };
    }
    let text = String(response.output_text || '').trim();
    if (!text) {
      const refusal = refusalText(response);
      if (refusal) return { ok: false, model: servedBy, text: '', error: `ChatGPT declined to answer: ${scrub(refusal)}` };
    }
    if (response.status === 'incomplete') {
      const reason = response.incomplete_details && response.incomplete_details.reason;
      if (!text) return { ok: false, model: servedBy, text: '', error: `The answer was incomplete (${reason || 'unknown reason'}).` };
      text = `${text}\n\n[The answer was cut off (${reason || 'incomplete'}). Ask a narrower question for the rest.]`;
    }
    if (!text) return { ok: false, model: servedBy, text: '', error: 'ChatGPT returned an empty answer.' };
    return { ok: true, model: servedBy, text };
  } catch (err) {
    return { ok: false, model, text: '', error: describeError(err, apiKey, 'OpenAI') };
  }
}

function ask({ apiKey, model, system, userText, signal }) {
  return request({ apiKey, model, system, userText, maxOutputTokens: 16000, signal });
}

// Reasoning models may spend the whole small budget on reasoning; a completed
// call (even "incomplete") still proves the key and model work; a "failed"
// response or one carrying an error does not.
async function test({ apiKey, model }) {
  const client = makeClient(apiKey, BASE_URL, 60 * 1000, 1);
  try {
    const response = await client.responses.create({ model, input: 'Reply with OK', max_output_tokens: 512 });
    const servedBy = response.model || model;
    if (response.status === 'failed' || (response.error && (response.error.message || response.error.code))) {
      const msg = (response.error && (response.error.message || response.error.code)) || 'the response failed';
      return { ok: false, model: servedBy, text: '', error: `OpenAI error: ${scrub(msg, apiKey)}` };
    }
    return { ok: true, model: servedBy, text: String(response.output_text || '').trim() };
  } catch (err) {
    return { ok: false, model, text: '', error: describeError(err, apiKey, 'OpenAI') };
  }
}

module.exports = { id: 'openai', name: 'ChatGPT', DEFAULT_MODEL, MODELS, ask, test, loadSdk, makeClient, describeError, scrub };
