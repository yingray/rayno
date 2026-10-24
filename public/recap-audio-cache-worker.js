/* The worker never receives account keys, recap text, or unencrypted audio. */
self.addEventListener('activate', event => {
  event.waitUntil(self.RaynoRecapCacheStore.run({ op: 'prune' }).catch(() => {}));
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'RAYNO_RECAP_AUDIO_V1' || !event.ports[0]) return;
  event.waitUntil(self.RaynoRecapCacheStore.run(event.data)
    .then(value => event.ports[0].postMessage({ ok: true, value }))
    .catch(() => event.ports[0].postMessage({ ok: false })));
});
