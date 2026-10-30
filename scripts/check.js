'use strict';

// Syntax-checks every .js file in the app with `node --check`, then loads
// engine/ and agents/ to catch missing modules and missing methods.
// Usage: npm run check

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['electron', 'engine', 'agents', 'scripts', path.join('renderer', 'js')];

function collect(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = [];
for (const dir of DIRS) collect(path.join(ROOT, dir), files);

let failed = 0;
for (const file of files) {
  const rel = path.relative(ROOT, file);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe', timeout: 30000 });
    console.log(`ok    ${rel}`);
  } catch (err) {
    failed += 1;
    const detail = String((err.stderr && err.stderr.toString()) || err.message).trim();
    console.error(`FAIL  ${rel}\n${detail}\n`);
  }
}

console.log(`\n${files.length - failed}/${files.length} files passed`);

// Load smoke test: `node --check` does not resolve requires, so load the
// Node-side modules that electron/main.js requires and confirm every method
// it calls exists. Runs in a child process so a hanging import cannot stall CI.
const REQUIRED = {
  engine: ['overview', 'devices', 'connections', 'scan', 'wifiInfo', 'wifiSurvey', 'dnsStatus', 'speedTest', 'cancelSpeedTest', 'openFix'],
  agents: ['init', 'providers', 'setKey', 'clearKey', 'setModel', 'test', 'ask'],
};

const probe = `
const required = ${JSON.stringify(REQUIRED)};
const problems = [];
for (const [name, methods] of Object.entries(required)) {
  let mod;
  try {
    mod = require(${JSON.stringify(ROOT)} + '/' + name);
  } catch (err) {
    problems.push(name + ': cannot load (' + (err && err.message ? err.message.split('\\n')[0] : err) + ')');
    continue;
  }
  for (const m of methods) {
    if (typeof mod[m] !== 'function') problems.push(name + '.' + m + ' is missing or not a function');
  }
}
if (problems.length) { console.error(problems.join('\\n')); process.exit(1); }
console.log('ok    engine and agents load; all methods used by electron/main.js exist');
process.exit(0);
`;

let smokeFailed = false;
try {
  const out = execFileSync(process.execPath, ['-e', probe], { cwd: ROOT, stdio: 'pipe', timeout: 30000 });
  console.log(out.toString().trim());
} catch (err) {
  smokeFailed = true;
  const detail = String((err.stderr && err.stderr.toString()) || err.message).trim();
  console.error(`FAIL  load smoke test\n${detail}`);
}

process.exit(failed > 0 || files.length === 0 || smokeFailed ? 1 : 0);
