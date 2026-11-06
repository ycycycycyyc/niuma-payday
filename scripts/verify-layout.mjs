import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const target = path.resolve(root, `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`);
  if (target !== root && !target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  const file = target === root ? path.join(root, 'index.html') : target;
  try { const body = fs.readFileSync(file); res.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream' }).end(body); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
fs.mkdirSync('artifacts', { recursive: true });
try {
  const page = await browser.newPage();
  for (const [width, height] of [[1440, 900], [1240, 840], [1024, 768], [880, 640], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('.earnings-card').waitFor();
    await page.screenshot({ path: `artifacts/layout-${width}.png`, fullPage: true });
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    console.log(`${width}x${height}: ${fits ? 'PASS' : 'FAIL'} horizontal fit`);
    if (!fits) process.exitCode = 1;
  }
  await page.setViewportSize({ width: 1240, height: 840 });
  await page.getByRole('button', { name: '设置我的日薪' }).click();
  await page.screenshot({ path: 'artifacts/settings.png' });
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('button', { name: '开启悬浮窗' }).click();
  await page.locator('.browser-widget-host').screenshot({ path: 'artifacts/widget.png' });
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
