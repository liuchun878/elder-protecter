/* =============================================================================
 * serve.mjs — 本地静态服务器（零依赖）
 *   node tools/serve.mjs [port]
 * 默认 5173，服务目录为本项目根。用于本地预览与无头截图。
 * ========================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = Number(process.argv[2] || 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const target = path.join(ROOT, path.normalize(urlPath).replace(/^([/\\])+/, ''));
  if (!target.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(target, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + urlPath); return; }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store'
    }).end(buf);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('serving ' + ROOT);
  console.log('http://127.0.0.1:' + PORT + '/');
});
