// Timing data for the performance checks in PERFORMANCE-PLAN.md, phase 0.
// Recovery marks are always on. They are rare, and each name keeps only its latest entry.
// Stage timings run on each update, so they run only when localStorage `rayno.perf` is `1`.

const PREFIX = 'rayno:';
// A stage shorter than this does not get a DevTools entry. It still counts in the totals.
const MEASURE_MIN = 4;

export type RecoveryMark =
  | 'transport-disconnected'
  | 'transport-connected'
  | 'list-refreshed'
  | 'active-chat-caught-up'
  | 'first-rpc-ok';

export type StageStats = { count: number; total: number; max: number; mean: number };

export function markRecovery(name: RecoveryMark) {
  try {
    performance.clearMarks(PREFIX + name);
    performance.mark(PREFIX + name);
  } catch { /* A browser without User Timing skips the mark. */ }
}

const stages = new Map<string, { count: number; total: number; max: number }>();
let enabled: boolean | undefined;

function stageTiming() {
  if (enabled === undefined) {
    try { enabled = localStorage.getItem('rayno.perf') === '1'; } catch { enabled = false; }
  }
  return enabled;
}

function record(name: string, start: number) {
  const end = performance.now(), duration = end - start;
  const stage = stages.get(name) || { count: 0, total: 0, max: 0 };
  stage.count++;
  stage.total += duration;
  stage.max = Math.max(stage.max, duration);
  stages.set(name, stage);
  if (duration >= MEASURE_MIN) {
    try { performance.measure(PREFIX + name, { start, end }); } catch { /* The totals stay available. */ }
  }
}

export function timeStage<T>(name: string, run: () => T): T {
  if (!stageTiming()) return run();
  const start = performance.now();
  try { return run(); } finally { record(name, start); }
}

export async function timeStageAsync<T>(name: string, run: () => Promise<T>): Promise<T> {
  if (!stageTiming()) return run();
  const start = performance.now();
  try { return await run(); } finally { record(name, start); }
}

export function stageStats(): Record<string, StageStats> {
  return Object.fromEntries([...stages].map(([name, { count, total, max }]) =>
    [name, { count, total: round(total), max: round(max), mean: round(count ? total / count : 0) }]));
}

export function resetStageStats() {
  stages.clear();
  try {
    for (const entry of performance.getEntriesByType('measure'))
      if (entry.name.startsWith(PREFIX)) performance.clearMeasures(entry.name);
  } catch { /* Nothing to clear. */ }
}

const round = (value: number) => Math.round(value * 100) / 100;

// The console and the browser tests read the stage totals here.
if (stageTiming()) {
  Object.assign(globalThis, {
    __raynoPerf: { stats: stageStats, reset: resetStageStats, table: () => console.table(stageStats()) },
  });
}
