import { build } from 'vite';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { chromium, webkit } from '@playwright/test';

// Count HTTP response bodies at the server, including service-worker requests.
// Resource Timing on the page alone omits the service-worker install traffic.
const base = resolve('.performance/pwa-base'), next = resolve('.performance/pwa-next');
await build({ build: { outDir: base, emptyOutDir: true } });
await build({ build: { outDir: next, emptyOutDir: true }, plugins: [{
  name: 'controlled-css-update', enforce: 'pre',
  transform(code, id) {
    if (id.endsWith('/src/styles/global.css')) return code + '\n:root { --benchmark-release: 1; }\n';
  },
}] });

let root = base, phase = 'cold';
const records = [];
const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    if (path === '/__health') { res.writeHead(200).end('Rayno transfer probe'); return; }
    const file = path.includes('.') ? path : '/index.html';
    const resolved = resolve(root, '.' + file);
    if (!resolved.startsWith(root + '/')) { res.writeHead(400).end(); return; }
    const body = await readFile(resolved);
    const etag = '"' + createHash('sha256').update(body).digest('hex') + '"';
    const cached = req.headers['if-none-match'] === etag;
    const compress = /gzip/.test(req.headers['accept-encoding'] || '');
    const payload = cached ? Buffer.alloc(0) : compress ? gzipSync(body) : body;
    const immutable = /\/assets\/.+-[\w-]+\./.test(path);
    res.writeHead(cached ? 304 : 200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'ETag': etag,
      ...(compress && !cached ? { 'Content-Encoding': 'gzip' } : {}),
    });
    records.push({ phase, path, status: cached ? 304 : 200, decoded: cached ? 0 : body.length, encoded: payload.length });
    res.end(payload);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(5197, '127.0.0.1', resolve));
const results = [];
try {
  if (process.env.RAYNO_BENCH_TAILSCALE_URL) {
    const health = await fetch(process.env.RAYNO_BENCH_TAILSCALE_URL + '/__health');
    if (!health.ok || await health.text() !== 'Rayno transfer probe') throw new Error('Tailscale probe failed.');
  }
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    root = base;
    phase = `${name}-cold`;
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ serviceWorkers: 'allow' });
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:5197/sessions');
      await page.getByRole('heading', { name: 'Your agents, in a new space.', exact: true }).waitFor();
      await page.evaluate(async () => { await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker did not install.')), 30000)),
      ]); });
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      const cache = await page.evaluate(async () => {
        const entries = [];
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          for (const req of await cache.keys()) entries.push({ name, path: new URL(req.url).pathname, bytes: (await (await cache.match(req)).arrayBuffer()).byteLength });
        }
        return entries;
      });
      phase = `${name}-warm`;
      await page.reload();
      await page.getByRole('heading', { name: 'Your agents, in a new space.', exact: true }).waitFor();
      await page.evaluate(async () => { await document.fonts.ready; });
      phase = `${name}-unchanged-update`;
      await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
      root = next;
      phase = `${name}-changed-update`;
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        const installed = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Service worker did not update.')), 30000);
          reg.addEventListener('updatefound', () => {
            const worker = reg.installing;
            worker.addEventListener('statechange', () => {
              if (worker.state === 'activated') { clearTimeout(timer); resolve(); }
              if (worker.state === 'redundant') { clearTimeout(timer); reject(new Error('Update failed.')); }
            });
          }, { once: true });
        });
        await reg.update();
        await installed;
      });
      phase = `${name}-offline`;
      await context.setOffline(true);
      await page.reload();
      await page.getByRole('heading', { name: 'Your agents, in a new space.', exact: true }).waitFor();
      const updatedCss = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--benchmark-release').trim());
      if (updatedCss !== '1') throw new Error('Offline navigation did not use the updated release.');
      results.push({ browser: name, cache, offlineShell: true, updatedCss });
      await context.close();
    } finally { await browser.close(); }
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
const phases = ['chromium', 'webkit'].flatMap(browser => ['cold', 'warm', 'unchanged-update', 'changed-update', 'offline'].map(phase => `${browser}-${phase}`));
const totals = Object.fromEntries(phases.map(phase => {
  const rows = records.filter(row => row.phase === phase);
  return [phase, { requests: rows.length, encoded: rows.reduce((n, row) => n + row.encoded, 0),
    decoded: rows.reduce((n, row) => n + row.decoded, 0) }];
}));
await mkdir('.performance', { recursive: true });
await writeFile('.performance/pwa-transfer.json', JSON.stringify({ totals, results, records }, null, 2));
console.log('PWA_TRANSFER ' + JSON.stringify(totals));
