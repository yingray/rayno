/* Encrypted Recap responses only. Shared by the worker and its first-load fallback. */
(() => {
  const NAME = 'rayno-recap-audio-v1';
  const PREFIX = '/__rayno_recap_audio__/';
  const DAY = 24 * 60 * 60 * 1000;
  const BUDGET = 32 * 1024 * 1024;
  const MAX_ENTRIES = 64;
  const validScope = scope => typeof scope === 'string' && /^[\w.-]{1,180}$/.test(scope);
  const urlFor = (scope, id) => new URL(`${PREFIX}${scope}/${id}`, self.location.origin).href;
  async function entries(cache) {
    const rows = [];
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      if (!response) continue;
      const expires = Number(response.headers.get('X-Rayno-Expires'));
      const bytes = Number(response.headers.get('X-Rayno-Bytes'));
      if (!Number.isFinite(expires) || expires <= Date.now() || !Number.isFinite(bytes)) await cache.delete(request);
      else rows.push({ request, expires, bytes });
    }
    return rows;
  }
  async function run(message) {
    if (!globalThis.caches) return null;
    const cache = await caches.open(NAME);
    if (message.op === 'prune') { await entries(cache); return true; }
    if (!validScope(message.scope)) return null;
    const scopePrefix = new URL(`${PREFIX}${message.scope}/`, self.location.origin).href;
    if (message.op === 'clear') {
      for (const request of await cache.keys()) if (request.url.startsWith(scopePrefix)) await cache.delete(request);
      return true;
    }
    if (message.op === 'has') return (await entries(cache)).some(row => row.request.url.startsWith(scopePrefix));
    if (typeof message.id !== 'string' || !/^[a-f0-9]{64}$/.test(message.id)) return null;
    const url = urlFor(message.scope, message.id);
    if (message.op === 'delete') return cache.delete(url);
    if (message.op === 'get') {
      const response = await cache.match(url);
      if (!response) return null;
      const expires = Number(response.headers.get('X-Rayno-Expires'));
      if (!Number.isFinite(expires) || expires <= Date.now()) { await cache.delete(url); return null; }
      return { expires, body: await response.text() };
    }
    if (message.op === 'put') {
      if (typeof message.body !== 'string' || message.body.length > 3 * 1024 * 1024
        || !Number.isFinite(message.expires) || message.expires <= Date.now() || message.expires > Date.now() + DAY) return null;
      await cache.put(url, new Response(message.body, { headers: {
        'Content-Type': 'application/octet-stream', 'X-Rayno-Expires': String(message.expires),
        'X-Rayno-Bytes': String(message.body.length),
      } }));
      const rows = (await entries(cache)).sort((a, b) => a.expires - b.expires);
      let bytes = rows.reduce((total, row) => total + row.bytes, 0), count = rows.length;
      for (const row of rows) {
        if (bytes <= BUDGET && count <= MAX_ENTRIES) break;
        if (row.request.url === url) continue;
        await cache.delete(row.request); bytes -= row.bytes; count--;
      }
      return true;
    }
    return null;
  }
  let queue = Promise.resolve();
  self.RaynoRecapCacheStore = {
    run(message) {
      const operation = queue.then(() => run(message));
      queue = operation.catch(() => {});
      return operation;
    },
  };
})();
