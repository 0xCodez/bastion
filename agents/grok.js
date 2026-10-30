'use strict';

// Grok (xAI). The xAI API is OpenAI-compatible, so it uses the official
// `openai` SDK pointed at https://api.x.ai/v1 with Chat Completions.

const { makeClient, describeError, scrub } = require('./openai');

const DEFAULT_MODEL = 'grok-4';
const MODELS = ['grok-4', 'grok-4-fast'];
const BASE_URL = 'https://api.x.ai/v1';

// Per attempt; index.js also enforces an overall deadline.
const TIMEOUT_MS = 3 * 60 * 1000;

async function request({ apiKey, model, system, userText, timeout = TIMEOUT_MS, maxRetries = 1, signal }) {
  const client = makeClient(apiKey, BASE_URL, timeout, maxRetries);
  try {
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: userText });
    const completion = await client.chat.completions.create({ model, messages }, signal ? { signal } : undefined);
    const servedBy = completion.model || model;
    const choice = (completion.choices || [])[0];
    const message = (choice && choice.message) || {};

    if (message.refusal) return { ok: false, model: servedBy, text: '', error: `Grok declined to answer: ${scrub(message.refusal)}` };
    let text = typeof message.content === 'string' ? message.content.trim() : '';
    if (choice && choice.finish_reason === 'length' && text) {
      text = `${text}\n\n[The answer was cut off at the length limit. Ask a narrower question for the rest.]`;
    }
    if (!text) return { ok: false, model: servedBy, text: '', error: 'Grok returned an empty answer.' };
    return { ok: true, model: servedBy, text };
  } catch (err) {
    return { ok: false, model, text: '', error: describeError(err, apiKey, 'xAI') };
  }
}

function ask({ apiKey, model, system, userText, signal }) {
  return request({ apiKey, model, system, userText, signal });
}

function test({ apiKey, model }) {
  return request({ apiKey, model, system: '', userText: 'Reply with OK', timeout: 60 * 1000, maxRetries: 1 });
}

module.exports = { id: 'grok', name: 'Grok', DEFAULT_MODEL, MODELS, ask, test };
