import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

export default async function setup() {
  const root = path.resolve('dist');
  const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const server = http.createServer(async (req, res) => {
    const target = path.resolve(root, `.${decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)}`);
    if (target !== root && !target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const file = target === root ? path.join(root, 'index.html') : target;
    try { const body = await fs.readFile(file); res.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream' }).end(body); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(4184, '127.0.0.1', resolve); });
  return async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); };
}
