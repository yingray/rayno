export type AudioStorageMessage = { op: 'get' | 'put' | 'delete' | 'has' | 'clear'; scope: string; id?: string; body?: string; expires?: number };

declare global {
  interface Window { RaynoRecapCacheStore?: { run(message: AudioStorageMessage): Promise<unknown> } }
}
let fallback: Promise<unknown> | undefined;
async function inPage(message: AudioStorageMessage): Promise<unknown> {
  if (!globalThis.caches) return null;
  // The same CacheStorage remains available before a worker controls the first page.
  const script = '/recap-audio-cache-store.js';
  await (fallback ??= import(/* @vite-ignore */ script).catch(() => { fallback = undefined; }));
  return window.RaynoRecapCacheStore?.run(message) ?? null;
}
export async function audioStorage(message: AudioStorageMessage): Promise<unknown> {
  try {
    const worker = navigator.serviceWorker?.controller;
    if (worker) {
      const result = await new Promise<{ ok: boolean; value?: unknown }>((resolve) => {
        const channel = new MessageChannel();
        const finish = (value: { ok: boolean; value?: unknown }) => {
          clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(value);
        };
        const timer = setTimeout(() => finish({ ok: false }), 750);
        channel.port1.onmessage = event => finish(event.data);
        try { worker.postMessage({ type: 'RAYNO_RECAP_AUDIO_V1', ...message }, [channel.port2]); }
        catch { finish({ ok: false }); }
      });
      if (result.ok) return result.value;
    }
    return await inPage(message);
  } catch { return null; }
}
