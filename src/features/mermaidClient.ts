// One shared worker renders the diagrams, one job at a time (PERFORMANCE-PLAN.md 6.5).
// A job waits in this queue until the worker is free. Its timeout starts when it runs, not while it waits.
// A timeout or a worker failure ends only the running job; the next job gets a new worker.
// A caller that no longer needs a diagram aborts, and a job that nobody waits for leaves the queue.
export const MAX_QUEUED_DIAGRAMS = 8;
export const DIAGRAM_RUN_TIMEOUT = 10000;

type Job = { id: number; source: string; resolve: (svg: string) => void; reject: (error: Error) => void; waiters: number; timer?: ReturnType<typeof setTimeout> };
let worker: Worker | undefined;
let nextId = 0;
let running: Job | undefined;
const queue: Job[] = [];
const cache = new Map<string, { result: Promise<string>; job: Job }>();

function restart() {
  worker?.terminate();
  worker = undefined;
}

function finish(job: Job, svg: string | undefined, error?: Error) {
  if (running === job) {
    clearTimeout(job.timer);
    running = undefined;
  }
  if (typeof svg === 'string') job.resolve(svg);
  else job.reject(error || new Error('The diagram could not render.'));
  startNext();
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./mermaid.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<{ id: number; svg?: string; error?: string }>) => {
    if (running?.id === data.id) finish(running, data.svg, data.error ? new Error(data.error) : undefined);
  };
  const fail = (message: string) => () => {
    restart();
    if (running) finish(running, undefined, new Error(message));
  };
  worker.onerror = fail('The diagram renderer could not load.');
  worker.onmessageerror = fail('The diagram renderer returned an invalid result.');
  return worker;
}

function startNext() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = job;
  job.timer = setTimeout(() => { restart(); finish(job, undefined, new Error('The diagram took too long to render.')); }, DIAGRAM_RUN_TIMEOUT);
  try { getWorker().postMessage({ id: job.id, source: job.source }); }
  catch { restart(); finish(job, undefined, new Error('The diagram renderer is unavailable.')); }
}

function leaveQueue(job: Job, error: Error) {
  const index = queue.indexOf(job);
  if (index === -1) return;
  queue.splice(index, 1);
  job.reject(error);
}

// Share one worker and reuse diagrams without parsing them during React renders.
export function renderDiagram(source: string, signal?: AbortSignal): Promise<string> {
  let entry = cache.get(source);
  if (entry) {
    cache.delete(source);
    cache.set(source, entry);
  } else {
    let job!: Job;
    const result = new Promise<string>((resolve, reject) => { job = { id: ++nextId, source, resolve, reject, waiters: 0 }; });
    entry = { result, job };
    cache.set(source, entry);
    if (cache.size > 24) cache.delete(cache.keys().next().value!);
    void result.catch(() => { if (cache.get(source)?.result === result) cache.delete(source); });
    // A full queue drops its oldest job. That diagram can ask again when it is on screen.
    if (queue.length >= MAX_QUEUED_DIAGRAMS) leaveQueue(queue[0], new Error('The diagram renderer is busy. Try again.'));
    queue.push(job);
    startNext();
  }
  const { job, result } = entry;
  job.waiters++;
  signal?.addEventListener('abort', () => {
    if (--job.waiters === 0) leaveQueue(job, new DOMException('The diagram is no longer needed.', 'AbortError'));
  }, { once: true });
  return result;
}
