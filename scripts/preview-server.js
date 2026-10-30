'use strict';

// Zero-dependency static server for previewing the renderer in a normal browser.
// The renderer falls back to renderer/js/mock-api.js when window.bastion is missing.
// Usage: npm run preview  ->  http://127.0.0.1:5174/

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 5174;
const ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function sendText(res, status, text, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(text);
}

// Only these top-level folders are served; the rest of the repo (.env, .git, keys) never is.
const SERVED_DIRS = ['renderer', 'node_modules'];
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

// Resolves a URL path to a file inside a served folder, or null if it is not allowed.
function resolveSafe(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const target = path.resolve(ROOT, '.' + path.posix.normalize('/' + decoded.split('\\').join('/')));
  const rel = path.relative(ROOT, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (!SERVED_DIRS.includes(parts[0])) return null;
  // No dotfiles or dot-directories anywhere in the path.
  if (parts.some((part) => part.startsWith('.'))) return null;
  return target;
}

const server = http.createServer((req, res) => {
  // DNS rebinding guard: a hostile page re-pointed at 127.0.0.1 still sends its own Host.
  if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase())) {
    sendText(res, 421, 'Misdirected request');
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    return;
  }

  let pathname;
  try {
    pathname = new URL(req.url, `http://${HOST}:${PORT}`).pathname;
  } catch {
    sendText(res, 400, 'Bad request');
    return;
  }

  if (pathname === '/' || pathname === '/renderer' || pathname === '/renderer/') {
    res.writeHead(302, { Location: '/renderer/index.html' });
    res.end();
    return;
  }

  const file = resolveSafe(pathname);
  if (!file) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.stat(file, (err, stat) => {
    // No directory listings: directories are treated as not found.
    if (err || !stat.isFile()) {
      sendText(res, 404, 'Not found');
      return;
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
});

server.on('error', (err) => {
  console.error(`preview: ${err.code === 'EADDRINUSE' ? `port ${PORT} is already in use` : err.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Bastion preview: http://${HOST}:${PORT}/  (mock data, browser only)`);
});
