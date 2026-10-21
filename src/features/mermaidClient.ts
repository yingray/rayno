type Pending = { resolve: (svg: string) => void; reject: (error: Error) => void; timer: number };
let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, Pending>();
const cache = new Map<string, Promise<string>>();

function stop(error: Error) {
  worker?.terminate();
  worker = undefined;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }
  pending.clear();
  cache.clear();
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./mermaid.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<{ id: number; svg?: string; error?: string }>) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    clearTimeout(request.timer);
    if (typeof data.svg === 'string') request.resolve(data.svg);
    else request.reject(new Error(data.error || 'The diagram could not render.'));
  };
  worker.onerror = () => stop(new Error('The diagram renderer could not load.'));
  worker.onmessageerror = () => stop(new Error('The diagram renderer returned an invalid result.'));
  return worker;
}

// Share one worker and reuse diagrams without parsing them during React renders.
export function renderDiagram(source: string): Promise<string> {
  const cached = cache.get(source);
  if (cached) {
    cache.delete(source);
    cache.set(source, cached);
    return cached;
  }
  const result = new Promise<string>((resolve, reject) => {
    const renderer = getWorker();
    const id = ++nextId;
    const timer = window.setTimeout(() => stop(new Error('The diagram took too long to render.')), 10000);
    pending.set(id, { resolve, reject, timer });
    try { renderer.postMessage({ id, source }); }
    catch { stop(new Error('The diagram renderer is unavailable.')); }
  });
  cache.set(source, result);
  if (cache.size > 24) cache.delete(cache.keys().next().value!);
  void result.catch(() => { if (cache.get(source) === result) cache.delete(source); });
  return result;
}
