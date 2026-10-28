import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AppError } from './model.mjs';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const assets = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/styles.css': ['styles.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/markdown.js': ['markdown.js', 'text/javascript'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'], '/noto-sans-sc.ttf': ['noto-sans-sc.ttf', 'font/ttf'] };
const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" };
assets['/theme.js'] = ['theme.js', 'text/javascript'];
assets['/refinement.css'] = ['refinement.css', 'text/css'];
assets['/documents.js'] = ['documents.js', 'text/javascript'];
assets['/acceptance.js'] = ['acceptance.js', 'text/javascript'];
assets['/dropdowns.js'] = ['dropdowns.js', 'text/javascript'];
async function body(request) {
  if (!(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new AppError('请使用 application/json', 415);
  let total = 0; const chunks = [];
  for await (const chunk of request) { total += chunk.length; if (total > 8 * 1024 * 1024) throw new AppError('请求超过 8 MB 限制', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('JSON 格式不合法'); }
}
export function createApp(store) {
  return createServer(async (request, response) => {
    const send = (status, value, extra = {}) => { response.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra }); response.end(JSON.stringify(value)); };
    try {
      const host = request.headers.host ?? '';
      const hostName = host.split(':')[0];
      if (!['127.0.0.1', 'localhost'].includes(hostName)) throw new AppError('只允许通过本机地址访问', 403);
      const path = new URL(request.url, `http://${host}`).pathname;
      if (request.method === 'POST') {
        if (request.headers.origin && request.headers.origin !== `http://${host}`) throw new AppError('不允许跨站写入', 403);
        if (request.headers['sec-fetch-site'] === 'cross-site') throw new AppError('不允许跨站写入', 403);
        const value = await body(request);
        if (path === '/api/projects') return send(201, await store.create(value));
        if (path === '/api/import') return send(201, await store.import(value));
        const match = path.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/commands$/);
        if (match) { if (!value || typeof value !== 'object') throw new AppError('请求格式不合法'); return send(200, await store.command(match[1], value.revision, value.command)); }
      }
      if (request.method === 'GET') {
        if (path === '/api/projects') return send(200, await store.list());
        const storage = path.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/storage$/);
        if (storage) return send(200, await store.storage(storage[1]));
        const match = path.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)(\/export)?$/);
        if (match) return send(200, await store.get(match[1]), match[2] ? { 'Content-Disposition': `attachment; filename="${match[1]}.json"` } : {});
        if (assets[path]) {
          const [file, type] = assets[path]; response.writeHead(200, { ...headers, 'Content-Type': type + '; charset=utf-8' }); response.end(await readFile(root + file)); return;
        }
      }
      send(404, { error: '找不到这个地址' });
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const status = error instanceof AppError ? error.status : 500;
      if (status === 500) console.error(error);
      send(status, { error: status === 500 ? '服务发生错误，原有数据未被覆盖。请查看服务日志。' : error.message });
    }
  });
}
