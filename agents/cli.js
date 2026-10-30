'use strict';

// "Use your subscription": runs the official CLIs the user is already signed in
// to on this computer, instead of an API key.
//   claude-cli -> Claude Code (`claude -p`), billed to the user's Claude plan
//   codex-cli  -> OpenAI Codex (`codex exec`), billed to the user's ChatGPT plan
//
// Safety rules (see docs/CONTRACT.md):
// - The question and snapshot go to the CLI on stdin, never in argv. argv holds
//   only fixed flags, a validated model id and paths Bastion created itself.
// - Every tool the CLI has is switched off or denied, and the run happens in an
//   empty directory under userData, so the model can only answer in text.
// - execFile/spawn without a shell. A Windows .cmd shim is resolved to the
//   script it launches; only when that fails is it run through cmd.exe, with
//   every argument checked against cmd metacharacters first.
// - 120 s timeout; cancel kills the whole process tree.
// Every exported function resolves with data and never throws.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync, execFile } = require('node:child_process');

const ASK_TIMEOUT_MS = 120 * 1000;
const PROBE_TIMEOUT_MS = 10 * 1000;
// After a timeout or cancel, run() resolves at the latest this long after the
// kill, even if 'close' never fires (a grandchild holding the pipes open).
const KILL_GRACE_MS = 5 * 1000;
const STATUS_TTL_MS = 60 * 1000;
const MAX_OUTPUT = 4 * 1024 * 1024;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/\[\]-]{0,99}$/;
const IS_WIN = process.platform === 'win32';

const SPECS = {
  'claude-cli': {
    bin: 'claude',
    product: 'Claude Code',
    vendor: 'Anthropic',
    plan: 'Claude',
    install: 'npm install -g @anthropic-ai/claude-code',
    login: 'claude auth login',
  },
  'codex-cli': {
    bin: 'codex',
    product: 'Codex',
    vendor: 'OpenAI',
    plan: 'ChatGPT',
    install: 'npm install -g @openai/codex',
    login: 'codex login',
  },
};

// Codex features that give the model a way to act (run commands, run JS, browse,
// use apps, spawn agents, run hooks). Passed as `-c features.<name>=false`.
// Codex silently ignores names it does not know, so these flags alone prove
// nothing: codexLockdown() reads back the effective state before the first
// request and refuses to run unless the tools below really are off.
const CODEX_FEATURES_OFF = [
  'shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks', 'browser_use', 'browser_use_external',
  'browser_use_full_cdp_access', 'computer_use', 'in_app_browser', 'in_app_local_automation',
  'image_generation', 'multi_agent', 'multi_agent_v2', 'view_image', 'code_mode', 'code_mode_host',
  'sleep_tool', 'goals', 'tool_suggest', 'skill_search', 'request_permissions_tool', 'memories',
];
// Must be listed by `codex features list` and report false, or Bastion refuses
// to ask: these are the switches that give the model a command or code runner.
const CODEX_MUST_BE_OFF = ['shell_tool', 'code_mode_host'];
// Listed in CODEX_FEATURES_OFF but not switchable by config on 0.153.4
// (`features list` keeps showing true). It only picks which shell tool is
// offered when shell_tool is on; with shell_tool off no exec tool is registered
// (checked with real runs: `tools.exec_command is not a function`).
const CODEX_IGNORED_STATE = new Set(['unified_exec']);

let baseDir = path.join(os.tmpdir(), 'bastion-cli');
const statusCache = new Map(); // id -> { at, value }
const statusInFlight = new Map(); // id -> Promise
const verified = new Set(); // ids whose CLI answered a request this session
const lockdownChecked = new Map(); // `${exe}|${version}` -> null (ok) | error text
const live = new Set(); // running CLI child processes, killed on quit

function rmQuiet(p) {
  try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 2 }); } catch { /* still in use; next start cleans it */ }
}

function init(userDataDir) {
  if (typeof userDataDir === 'string' && userDataDir) baseDir = path.join(userDataDir, 'cli');
  statusCache.clear();
  lockdownChecked.clear();
  // Leftovers from a crash or an older Bastion (shared `empty` / `prompts` dirs).
  for (const name of ['runs', 'empty', 'prompts']) rmQuiet(path.join(baseDir, name));
  return { ok: true };
}

// A fresh, private directory per CLI run: `cwd` is the empty directory the CLI
// runs in (nothing for a model to read), `dir` holds Bastion's own files for
// that run (system prompt, settings). cleanup() removes both.
function runDir() {
  const runs = path.join(baseDir, 'runs');
  fs.mkdirSync(runs, { recursive: true });
  const dir = fs.mkdtempSync(path.join(runs, 'r-'));
  const cwd = path.join(dir, 'cwd');
  fs.mkdirSync(cwd);
  return { dir, cwd, cleanup: () => rmQuiet(dir) };
}

function isCli(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(SPECS, id);
}

function errMessage(err) {
  return String((err && err.message) || err || 'Unknown error').slice(0, 300);
}

// ---------------------------------------------------------------- locating

function home() {
  try { return os.homedir(); } catch { return process.env.HOME || process.env.USERPROFILE || ''; }
}

// Apps started from the Dock or Start menu get a minimal PATH, so the usual
// install locations are searched explicitly as well.
function searchDirs() {
  const dirs = [];
  const add = (d) => { if (d && !dirs.includes(d)) dirs.push(d); };
  for (const d of String(process.env.PATH || process.env.Path || '').split(path.delimiter)) add(d.trim());
  const h = home();
  if (IS_WIN) {
    const appData = process.env.APPDATA || (h && path.join(h, 'AppData', 'Roaming'));
    const local = process.env.LOCALAPPDATA || (h && path.join(h, 'AppData', 'Local'));
    if (appData) add(path.join(appData, 'npm'));
    if (h) add(path.join(h, '.local', 'bin'));
    if (local) {
      add(path.join(local, 'Programs', 'OpenAI', 'Codex', 'bin'));
      add(path.join(local, 'Programs', 'Codex', 'bin'));
      add(path.join(local, 'Programs', 'claude'));
      add(path.join(local, 'Programs', 'Claude Code'));
      add(path.join(local, 'pnpm'));
      add(path.join(local, 'Volta', 'bin'));
    }
    if (h) add(path.join(h, 'scoop', 'shims'));
    add('C:\\ProgramData\\chocolatey\\bin');
    if (process.env.ProgramFiles) add(path.join(process.env.ProgramFiles, 'nodejs'));
  } else {
    add('/opt/homebrew/bin');
    add('/usr/local/bin');
    if (h) {
      add(path.join(h, '.local', 'bin'));
      add(path.join(h, '.npm-global', 'bin'));
      add(path.join(h, '.claude', 'local'));
      add(path.join(h, '.volta', 'bin'));
      add(path.join(h, 'Library', 'pnpm'));
      add(path.join(h, '.bun', 'bin'));
      // nvm: every installed Node version's bin directory.
      try {
        const nvm = path.join(h, '.nvm', 'versions', 'node');
        for (const v of fs.readdirSync(nvm)) add(path.join(nvm, v, 'bin'));
      } catch { /* no nvm */ }
    }
    add('/usr/bin');
    add('/bin');
  }
  return dirs;
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function findExecutable(bin) {
  const names = IS_WIN ? [`${bin}.exe`, `${bin}.cmd`, `${bin}.bat`] : [bin];
  for (const dir of searchDirs()) {
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const name of names) {
      const p = path.join(dir, name);
      if (!isFile(p)) continue;
      if (!IS_WIN) {
        try { fs.accessSync(p, fs.constants.X_OK); } catch { continue; }
      }
      return p;
    }
  }
  return null;
}

function findNode(nearDir) {
  const names = IS_WIN ? ['node.exe'] : ['node'];
  const dirs = [nearDir, ...searchDirs()];
  for (const dir of dirs) {
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const n of names) if (isFile(path.join(dir, n))) return path.join(dir, n);
  }
  return null;
}

// npm/pnpm .cmd shims end with a line like
//   "%_prog%"  "%dp0%\node_modules\@openai\codex\bin\codex.js" %*
// Returns the absolute path of that target, or null.
function shimTarget(cmdPath) {
  let text = '';
  try { text = fs.readFileSync(cmdPath, 'utf8').slice(0, 64 * 1024); } catch { return null; }
  const dir = path.dirname(cmdPath);
  const re = /"%~?dp0%?\\([^"%]+\.(?:js|cjs|mjs|exe))"/gi;
  let m;
  let last = null;
  while ((m = re.exec(text))) last = m[1];
  if (!last) return null;
  const target = path.resolve(dir, last);
  return isFile(target) ? target : null;
}

// How to start the executable without a shell: { file, prefix, env, shell }.
function launchPlan(exe) {
  const ext = path.extname(exe).toLowerCase();
  if (!IS_WIN || ext === '.exe') return { file: exe, prefix: [], env: {}, shell: false };
  const target = shimTarget(exe);
  if (target && /\.exe$/i.test(target)) return { file: target, prefix: [], env: {}, shell: false };
  if (target) {
    const node = findNode(path.dirname(exe));
    if (node) return { file: node, prefix: [target], env: {}, shell: false };
    // Electron's own binary runs as plain Node with ELECTRON_RUN_AS_NODE.
    return { file: process.execPath, prefix: [target], env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}, shell: false };
  }
  return { file: exe, prefix: [], env: {}, shell: true };
}

// cmd.exe quoting for the shell fallback. Only fixed flags, validated model ids
// and Bastion's own paths ever get here; anything carrying a cmd metacharacter
// is refused rather than escaped.
function cmdQuote(arg) {
  const s = String(arg);
  if (/["%^&|<>!\r\n]/.test(s)) return null;
  if (/^[A-Za-z0-9._:\/\\=,+-]+$/.test(s)) return s;
  return `"${s}"`;
}

function childEnv(id, extra) {
  const env = { ...process.env, ...extra };
  // PATH gets the install locations too, so `#!/usr/bin/env node` shims work
  // when Bastion was started from the Dock.
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  env[key] = searchDirs().join(path.delimiter);
  env.NO_COLOR = '1';
  if (!extra || !extra.ELECTRON_RUN_AS_NODE) delete env.ELECTRON_RUN_AS_NODE;
  if (id === 'claude-cli') {
    // Use the subscription login, not an API key that happens to be in the
    // environment (Claude Code prefers ANTHROPIC_API_KEY when it is set).
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
  }
  return env;
}

// Kills the CLI and everything it started, also when the direct child has
// already exited (its group or tree can still hold grandchildren). sync is for
// app quit, where an async taskkill might not get started before exit.
function killTree(child, { sync = false } = {}) {
  if (!child || !child.pid) return;
  try {
    if (IS_WIN) {
      const args = ['/pid', String(child.pid), '/T', '/F'];
      if (sync) {
        try { spawnSync('taskkill', args, { windowsHide: true, timeout: 3000, stdio: 'ignore' }); } catch { /* gone */ }
      } else {
        execFile('taskkill', args, { windowsHide: true, timeout: 8000 }, () => {});
      }
      try { child.kill(); } catch { /* gone */ }
    } else {
      // detached: the child leads its own process group; -pid reaches all of it.
      try { process.kill(-child.pid, sync ? 'SIGKILL' : 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
      if (!sync) {
        setTimeout(() => {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
        }, 3000).unref();
      }
    }
  } catch { /* already gone */ }
}

// Called on app quit: no CLI keeps running (and using the subscription) after Bastion.
function killAll() {
  for (const child of [...live]) killTree(child, { sync: true });
  live.clear();
  return { ok: true };
}

// Runs the CLI. Resolves { code, stdout, stderr, timedOut, aborted, error }.
function run(id, exe, args, { input = null, timeoutMs = PROBE_TIMEOUT_MS, cwd, signal } = {}) {
  return new Promise((resolve) => {
    const plan = launchPlan(exe);
    let file = plan.file;
    let argv = [...plan.prefix, ...args];
    const opts = {
      cwd: cwd || os.tmpdir(),
      env: childEnv(id, plan.env),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: !IS_WIN, // own process group, so killTree reaches grandchildren
    };
    if (plan.shell) {
      const quoted = [file, ...argv].map(cmdQuote);
      if (quoted.some((q) => q == null)) {
        resolve({ code: null, stdout: '', stderr: '', error: 'Refused to start the CLI: an argument contained a shell character.' });
        return;
      }
      file = quoted[0];
      argv = quoted.slice(1);
      opts.shell = true;
      opts.windowsVerbatimArguments = true;
    }

    let child;
    try {
      child = spawn(file, argv, opts);
    } catch (err) {
      resolve({ code: null, stdout: '', stderr: '', error: errMessage(err), errCode: err && err.code });
      return;
    }

    live.add(child);
    let stdout = '';
    let stderr = '';
    let done = false;
    let timedOut = false;
    let aborted = false;
    let grace = null;
    const finish = (r) => {
      if (done) return;
      done = true;
      live.delete(child);
      clearTimeout(timer);
      clearTimeout(grace);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ stdout, stderr, timedOut, aborted, ...r });
    };
    const stop = () => {
      killTree(child);
      if (!grace) grace = setTimeout(() => finish({ code: null }), KILL_GRACE_MS);
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const onAbort = () => { aborted = true; stop(); };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { if (stdout.length < MAX_OUTPUT) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < MAX_OUTPUT) stderr += d; });
    child.on('error', (err) => finish({ code: null, error: errMessage(err), errCode: err && err.code }));
    child.on('close', (code) => finish({ code }));
    child.stdin.on('error', () => { /* the CLI may exit before reading stdin */ });
    if (input != null) child.stdin.end(input, 'utf8');
    else child.stdin.end();
  });
}

// ---------------------------------------------------------------- status

function firstVersion(text) {
  const m = /\d+\.\d+\.\d+[0-9A-Za-z.+-]*/.exec(String(text || ''));
  return m ? m[0] : null;
}

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return String(s || '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
}

async function detect(id) {
  const spec = SPECS[id];
  const exe = findExecutable(spec.bin);
  const base = { installed: false, version: null, loggedIn: null, path: null, authMethod: null, models: null, error: null, hint: null };
  if (!exe) {
    return { ...base, error: `${spec.product} isn't installed. Install it with: ${spec.install}`, hint: spec.install };
  }
  // Probes run in their own empty directory too, never in a shared temp dir.
  const rd = runDir();
  try {
    return await detectIn(id, spec, exe, base, rd.cwd);
  } finally {
    rd.cleanup();
  }
}

async function detectIn(id, spec, exe, base, cwd) {
  const v = await run(id, exe, ['--version'], { cwd });
  if (v.code !== 0) {
    const why = v.timedOut ? 'it did not respond' : (v.error || stripAnsi(v.stderr).trim().split('\n')[0] || `exit code ${v.code}`);
    return { ...base, path: exe, error: `${spec.product} was found at ${exe} but could not start (${String(why).slice(0, 160)}).`, hint: spec.install };
  }
  const out = { ...base, installed: true, path: exe, version: firstVersion(v.stdout) || firstVersion(v.stderr) };

  if (id === 'codex-cli') {
    const s = await run(id, exe, ['login', 'status'], { cwd });
    const text = stripAnsi(`${s.stdout}\n${s.stderr}`);
    if (s.code === 0 && /logged in/i.test(text) && !/not logged in/i.test(text)) {
      out.loggedIn = true;
      out.authMethod = /chatgpt/i.test(text) ? 'chatgpt' : /api key/i.test(text) ? 'api_key' : 'other';
    } else if (/not logged in/i.test(text) || s.code === 1) {
      out.loggedIn = false;
    }
    out.models = await codexModels(id, exe, cwd);
  } else {
    // `claude auth status`: JSON, exit 0 when signed in, 1 when not (Claude
    // Code docs, CLI reference). It is run only when `claude --help` lists an
    // `auth` command: an older Claude Code would take "auth status" as a
    // prompt. Without it the answer stays unknown until the first request.
    const h = await run(id, exe, ['--help'], { cwd });
    const hasAuth = h.code === 0 && /^\s+auth\b/m.test(stripAnsi(h.stdout));
    const s = hasAuth ? await run(id, exe, ['auth', 'status'], { cwd }) : { code: null, stdout: '', stderr: '' };
    let json = null;
    try { json = JSON.parse(String(s.stdout || '').trim()); } catch { json = null; }
    if (json && typeof json === 'object') {
      out.authMethod = typeof json.authMethod === 'string' ? json.authMethod : null;
      if (s.code === 0 && out.authMethod !== 'none' && json.loggedIn !== false) out.loggedIn = true;
      else out.loggedIn = false;
    } else if (s.code === 1 && /not (logged|signed) in|log ?in/i.test(stripAnsi(`${s.stdout}\n${s.stderr}`))) {
      out.loggedIn = false;
    }
    if (out.loggedIn !== true && verified.has(id)) out.loggedIn = true;
  }

  if (out.loggedIn === false) {
    out.error = `${spec.product} is installed but not signed in. Run \`${spec.login}\` in a terminal first.`;
    out.hint = spec.login;
  } else if (out.authMethod === 'api_key' || out.authMethod === 'api_key_helper') {
    out.hint = null;
    out.note = `${spec.product} is signed in with an API key, so answers are billed to that key, not to a ${spec.plan} subscription.`;
  }
  return out;
}

// The models this Codex ships with (`codex debug models --bundled`, visibility
// "list"). --bundled skips the refresh from OpenAI: status checks run on their
// own timer and must never contact a provider.
async function codexModels(id, exe, cwd) {
  const r = await run(id, exe, ['debug', 'models', '--bundled'], { cwd });
  if (r.code !== 0) return null;
  try {
    const j = JSON.parse(r.stdout);
    const arr = Array.isArray(j) ? j : Array.isArray(j && j.models) ? j.models : [];
    const list = arr
      .filter((m) => m && (m.visibility == null || m.visibility === 'list'))
      .map((m) => String(m.slug || m.id || ''))
      .filter((s) => MODEL_RE.test(s));
    return list.length ? list.slice(0, 12) : null;
  } catch {
    return null;
  }
}

async function status(id, { force = false } = {}) {
  try {
    if (!isCli(id)) return { installed: false, version: null, loggedIn: null, path: null, error: 'Unknown provider.' };
    const cached = statusCache.get(id);
    // A CLI that is not ready is looked for again sooner, so installing or signing in
    // shows up after "Check again" without restarting Bastion.
    const ttl = cached && cached.value.installed && cached.value.loggedIn !== false ? STATUS_TTL_MS : 5000;
    if (!force && cached && Date.now() - cached.at < ttl) return cached.value;
    if (statusInFlight.has(id)) return await statusInFlight.get(id);
    const p = detect(id).catch((err) => ({ installed: false, version: null, loggedIn: null, path: null, error: errMessage(err) }));
    statusInFlight.set(id, p);
    try {
      const value = await p;
      statusCache.set(id, { at: Date.now(), value });
      return value;
    } finally {
      statusInFlight.delete(id);
    }
  } catch (err) {
    return { installed: false, version: null, loggedIn: null, path: null, error: errMessage(err) };
  }
}

// The model in the user's own ~/.codex/config.toml. Bastion starts Codex with
// --ignore-user-config (so the user's MCP servers and tool settings never
// load), which would also drop their chosen model, so it is passed back with -m.
function codexConfiguredModel() {
  try {
    const dir = process.env.CODEX_HOME || path.join(home(), '.codex');
    const text = fs.readFileSync(path.join(dir, 'config.toml'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*\[/.test(line)) break; // top-level keys only
      const m = /^\s*model\s*=\s*"([^"]+)"\s*(#.*)?$/.exec(line);
      if (m && MODEL_RE.test(m[1])) return m[1];
    }
  } catch { /* no config */ }
  return null;
}

// ---------------------------------------------------------------- asking

function scrub(text) {
  return stripAnsi(text)
    .replace(/\b(sk-ant-|sk-|xai-)[A-Za-z0-9_\-*]{4,}/g, '[key]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

function explainFailure(id, r, detail) {
  const spec = SPECS[id];
  if (r.aborted) return 'Cancelled.';
  if (r.timedOut) return `${spec.product} did not answer within ${ASK_TIMEOUT_MS / 1000} seconds. Try again, or pick a faster model.`;
  if (r.errCode === 'ENOENT') return `${spec.product} isn't installed. Install it with: ${spec.install}`;
  if (r.error) return `Could not start ${spec.product}: ${scrub(r.error)}`;
  const text = `${detail || ''} ${r.stderr || ''} ${r.stdout || ''}`;
  if (/not (logged|signed) in|please (log|sign) in|unauthori[sz]ed|\b401\b|invalid (api key|token|credentials)|authentication|login required|\/login/i.test(text)) {
    return `${spec.product} is not signed in. Run \`${spec.login}\` in a terminal, then try again.`;
  }
  if (/usage limit|rate limit|quota|too many requests|\b429\b|limit reached|hit your limit/i.test(text)) {
    return `Your ${spec.plan} plan's usage limit was reached. Wait for it to reset, or use an API key instead.`;
  }
  if (/model/i.test(text) && /(not found|not supported|does not exist|invalid|unknown|not available)/i.test(text)) {
    return `${spec.product} rejected that model. Pick another one in Settings, or "default".`;
  }
  const msg = scrub(detail || r.stderr || r.stdout);
  return msg ? `${spec.product} failed: ${msg}` : `${spec.product} exited with code ${r.code} and no answer.`;
}

async function askClaude(exe, { model, system, userText, signal }) {
  const rd = runDir();
  try {
    return await askClaudeIn(exe, rd, { model, system, userText, signal });
  } finally {
    rd.cleanup();
  }
}

async function askClaudeIn(exe, rd, { model, system, userText, signal }) {
  const promptFile = path.join(rd.dir, 'system.txt');
  const settingsFile = path.join(rd.dir, 'settings.json');
  fs.writeFileSync(promptFile, system, 'utf8');
  fs.writeFileSync(settingsFile, JSON.stringify({ disableAllHooks: true }), 'utf8');
  // Flags per the Claude Code CLI reference (code.claude.com/docs/en/cli-reference).
  // NOT YET RUN against a real Claude Code (it was not installed on the dev
  // machine); verify this argv before shipping.
  // - `--tools ""` removes every built-in tool; `--disallowedTools "*"` also
  //   removes MCP tools; `--strict-mcp-config` with no --mcp-config loads no
  //   MCP servers; `--permission-mode dontAsk` denies anything left that would
  //   need approval. Belt and braces: any one of them alone keeps Bash, Edit,
  //   WebFetch etc. away from the model.
  // - Hooks are shell commands and are not tools, so the flags above do not
  //   stop them. `--setting-sources project` skips the user's
  //   ~/.claude/settings.json (its hooks and enabled plugins); the project is
  //   the empty run dir, so nothing loads from there. `--settings` adds
  //   `disableAllHooks: true` on top. The sign-in is stored apart from
  //   settings, so the subscription login still works.
  // - `--system-prompt-file` replaces Claude Code's coding-agent prompt with
  //   Bastion's (the file form avoids command-line length limits).
  // - Not `--bare`: bare mode never reads the subscription (OAuth) login.
  const args = [
    '-p',
    '--output-format', 'json',
    '--tools', '',
    '--disallowedTools', '*',
    '--strict-mcp-config',
    '--permission-mode', 'dontAsk',
    '--setting-sources', 'project',
    '--settings', settingsFile,
    '--disable-slash-commands',
    '--no-session-persistence',
    '--system-prompt-file', promptFile,
  ];
  if (model) args.push('--model', model);
  const r = await run('claude-cli', exe, args, { input: userText, timeoutMs: ASK_TIMEOUT_MS, cwd: rd.cwd, signal });

  let result = null;
  const lines = String(r.stdout || '').trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    try {
      const j = JSON.parse(line);
      if (j && typeof j === 'object' && (j.type === 'result' || 'result' in j)) { result = j; break; }
    } catch { /* not JSON */ }
  }
  if (!result) {
    try { const j = JSON.parse(String(r.stdout || '').trim()); if (j && typeof j === 'object') result = j; } catch { /* no JSON */ }
  }
  const usage = result && result.modelUsage && typeof result.modelUsage === 'object' ? Object.keys(result.modelUsage) : [];
  const servedBy = usage.find((k) => !/haiku/i.test(k)) || usage[0] || model || 'default';
  if (r.aborted || r.timedOut || r.error || !result) {
    return { ok: false, model: servedBy, text: '', error: explainFailure('claude-cli', r) };
  }
  const text = typeof result.result === 'string' ? result.result.trim() : '';
  if (result.is_error || (result.subtype && result.subtype !== 'success') || r.code !== 0) {
    return { ok: false, model: servedBy, text: '', error: explainFailure('claude-cli', r, text || result.subtype || '') };
  }
  return { ok: true, model: servedBy, text };
}

const CODEX_FEATURE_ARGS = CODEX_FEATURES_OFF.flatMap((f) => ['-c', `features.${f}=false`]);

// Reads back the effective feature state with the same overrides `codex exec`
// gets, once per Codex binary and version. Resolves null when the command and
// code runners are confirmed off, or the reason Bastion refuses to ask.
async function codexLockdown(exe, version, cwd, signal) {
  const key = `${exe}|${version || '?'}`;
  if (lockdownChecked.has(key)) return lockdownChecked.get(key);
  const r = await run('codex-cli', exe, ['features', 'list', ...CODEX_FEATURE_ARGS], { cwd, signal });
  if (r.aborted) return 'Cancelled.';
  const state = new Map();
  for (const line of stripAnsi(r.stdout).split(/\r?\n/)) {
    const m = /^([a-z0-9_]+)\s+.*?\s(true|false)\s*$/.exec(line.trim());
    if (m) state.set(m[1], m[2] === 'true');
  }
  let problem = null;
  if (r.code !== 0 || state.size < 10) {
    problem = 'Bastion could not confirm that this Codex version runs without tools (`codex features list` failed). Update Codex, or use another agent.';
  } else {
    const on = [];
    for (const name of CODEX_MUST_BE_OFF) if (state.get(name) !== false) on.push(name);
    for (const name of CODEX_FEATURES_OFF) if (state.get(name) === true && !CODEX_IGNORED_STATE.has(name) && !on.includes(name)) on.push(name);
    if (on.length) {
      problem = `This Codex version keeps tools on that Bastion cannot switch off (${on.join(', ')}), so it was not asked. Use another agent, or a Codex version Bastion supports.`;
    }
  }
  lockdownChecked.set(key, problem);
  return problem;
}

async function askCodex(exe, opts) {
  const rd = runDir();
  try {
    return await askCodexIn(exe, rd, opts);
  } finally {
    rd.cleanup();
  }
}

async function askCodexIn(exe, rd, { model, system, userText, signal, version }) {
  const useModel = model || codexConfiguredModel();
  const servedBy = useModel || 'default';
  const blocked = await codexLockdown(exe, version, rd.cwd, signal);
  if (blocked) return { ok: false, model: servedBy, text: '', error: blocked };
  // Flags checked against `codex exec --help` (codex-cli 0.153.4):
  // read-only sandbox, approvals never (a command that needs approval fails
  // instead of running), command/code/browser/app tools off (confirmed by
  // codexLockdown), no web search, the user's config.toml (MCP servers, hooks)
  // and exec rules not loaded, no session saved, prompt read from stdin ("-"),
  // JSONL events on stdout.
  const args = [
    'exec',
    '--json',
    '--color', 'never',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox', 'read-only',
    '-c', 'approval_policy=never',
    '-c', 'web_search=disabled',
    ...CODEX_FEATURE_ARGS,
  ];
  if (useModel) args.push('-m', useModel);
  args.push('-');
  // `codex exec` has no system-prompt flag that takes text, so Bastion's
  // instructions lead the stdin prompt.
  const input = `<instructions>\n${system}\n</instructions>\n\n${userText}`;
  const r = await run('codex-cli', exe, args, { input, timeoutMs: ASK_TIMEOUT_MS, cwd: rd.cwd, signal });

  // Codex may send commentary agent_messages before the answer, so only the
  // last message of a turn that completed counts.
  let text = '';
  let failure = '';
  let lastError = '';
  let completed = false;
  for (const line of String(r.stdout || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (!ev || typeof ev !== 'object') continue;
    if (ev.type === 'item.completed' && ev.item && ev.item.type === 'agent_message' && typeof ev.item.text === 'string') text = ev.item.text;
    else if (ev.type === 'turn.completed') completed = true;
    else if (ev.type === 'turn.failed') failure = String((ev.error && ev.error.message) || 'the turn failed');
    // `error` events also report retries that later succeed ("Reconnecting…"),
    // so they only explain a turn that did not complete.
    else if (ev.type === 'error' && ev.message) lastError = String(ev.message);
  }
  text = text.trim();
  if (r.aborted || r.timedOut || r.error) return { ok: false, model: servedBy, text: '', error: explainFailure('codex-cli', r) };
  if (!completed || failure || r.code !== 0 || !text) {
    return { ok: false, model: servedBy, text: '', error: explainFailure('codex-cli', r, failure || lastError || (completed || scrub(r.stderr) ? '' : 'the turn did not finish')) };
  }
  return { ok: true, model: servedBy, text };
}

// model: '' / 'default' -> the CLI's own default.
async function ask(id, { model, system, userText, signal }) {
  try {
    if (!isCli(id)) return { ok: false, model: '', text: '', error: 'Unknown provider.' };
    const spec = SPECS[id];
    const st = await status(id);
    if (!st.installed) return { ok: false, model: model || 'default', text: '', error: st.error || `${spec.product} isn't installed. Install it with: ${spec.install}` };
    if (st.loggedIn === false) return { ok: false, model: model || 'default', text: '', error: st.error };
    const m = model && model !== 'default' && MODEL_RE.test(model) ? model : '';
    const fn = id === 'claude-cli' ? askClaude : askCodex;
    const r = await fn(st.path, { model: m, system: String(system || ''), userText: String(userText || ''), signal, version: st.version });
    if (r.ok) {
      verified.add(id);
      const cached = statusCache.get(id);
      if (cached && cached.value.loggedIn !== true) cached.value = { ...cached.value, loggedIn: true, error: null, hint: null };
    } else if (/not signed in/.test(r.error || '')) {
      statusCache.delete(id);
    }
    return r;
  } catch (err) {
    return { ok: false, model: model || 'default', text: '', error: errMessage(err) };
  }
}

async function test(id, model, signal) {
  await status(id, { force: true });
  return ask(id, { model, system: 'You are a connectivity check. Reply with the single word OK.', userText: 'Reply with OK', signal });
}

module.exports = { SPECS, init, isCli, status, ask, test, killAll, findExecutable, launchPlan, MODEL_RE };
