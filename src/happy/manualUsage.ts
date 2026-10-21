// Adapted from Happy (MIT). See PROTOCOL-SOURCES.md.
/**
 * Reads the plan quota of Claude and Codex straight from a computer, without
 * a session. V2 uses this for the session-list status and Monitor refresh.
 *
 * The script goes through the daemon's machine-wide `bash` RPC, like the
 * battery reading. It asks each agent with the call the CLI already uses in a
 * session, so both paths report the same numbers:
 * - Claude: an SDK query that never sends a message (no model turn, no tokens)
 *   and the SDK's experimental get_usage control request.
 * - Codex: a short-lived `codex app-server` and `account/rateLimits/read`.
 */
type AgentUsage = {
  agent: 'claude' | 'codex';
  capturedAt: number;
  windows: UsageLimitWindowLike[];
};
type UsageLimitWindowLike = {
  id: string;
  utilization?: number | null;
  resetsAt?: number | null;
  status?: string;
};
const getUsageLimitRows = (limits: { capturedAt: number; windows: UsageLimitWindowLike[] }) =>
  limits.windows;

// Runs under node (ESM, top-level await). Prints one JSON line.
const READER_JS = String.raw`
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const limit = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' did not answer in ' + (ms / 1000) + ' s')), ms)),
]);

async function readClaude() {
    const dir = process.env.HAPPY_CLI_DIR;
    if (!dir) throw new Error('Happy CLI install not found');
    const require = createRequire(dir + '/package.json');
    const { query } = await import(pathToFileURL(require.resolve('@anthropic-ai/claude-agent-sdk')).href);
    let release;
    const idle = new Promise((resolve) => { release = resolve; });
    async function* noMessages() { await idle; }
    const q = query({ prompt: noMessages(), options: { cwd: process.env.HOME || '/', persistSession: false } });
    try {
        const usage = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
        if (!usage || !usage.rate_limits_available || !usage.rate_limits) throw new Error('No plan limits for this login');
        return usage.rate_limits;
    } finally {
        release();
        try { q.close(); } catch {}
    }
}

function readCodex() {
    return new Promise((resolve, reject) => {
        const child = spawn('codex', ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'ignore'] });
        const done = (error, result) => {
            try { child.kill(); } catch {}
            if (error) reject(error); else resolve(result);
        };
        child.on('error', (error) => done(error.code === 'ENOENT' ? new Error('codex is not installed') : error));
        const send = (message) => child.stdin.write(JSON.stringify(message) + '\n');
        let buffer = '';
        child.stdout.on('data', (chunk) => {
            buffer += chunk;
            let index;
            while ((index = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, index);
                buffer = buffer.slice(index + 1);
                let message;
                try { message = JSON.parse(line); } catch { continue; }
                if (message.id === 1) {
                    if (message.error) return done(new Error(message.error.message || 'initialize failed'));
                    send({ jsonrpc: '2.0', method: 'initialized' });
                    send({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read', params: {} });
                } else if (message.id === 2) {
                    return message.error ? done(new Error(message.error.message || 'read failed')) : done(null, message.result);
                }
            }
        });
        send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'happy-monitor', title: 'Happy Monitor', version: '1' } } });
    });
}

const settle = (promise) => promise.then((data) => ({ ok: true, data }), (error) => ({ ok: false, error: String(error && error.message || error) }));
const [claude, codex] = await Promise.all([
    settle(limit(readClaude(), 30000, 'Claude')),
    settle(limit(readCodex(), 20000, 'Codex')),
]);
process.stdout.write(JSON.stringify({ capturedAt: Date.now(), claude, codex }) + '\n');
process.exit(0);
`;

function toBase64(text: string): string {
  // btoa takes Latin-1 only; the script is ASCII but encode safely anyway.
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * POSIX sh. `$PPID` is the daemon: the bash RPC runs this through
 * child_process.exec, so the daemon's node and its install (the one that
 * holds the Claude SDK) are found from it. The base64 keeps the script free
 * of shell quoting.
 */
export function buildManualUsageCommand(): string {
  return [
    `NODE=$(command -v node 2>/dev/null)`,
    `[ -x "$NODE" ] || NODE=$(lsof -p $PPID 2>/dev/null | awk '$4=="txt"{print $9; exit}')`,
    `[ -x "$NODE" ] || NODE=$(readlink /proc/$PPID/exe 2>/dev/null)`,
    `ENTRY=$(ps -o args= -p $PPID | tr ' ' '\\n' | grep '/dist/index.mjs$' | head -1)`,
    `HAPPY_CLI_DIR=\${ENTRY%/dist/index.mjs} "$NODE" --input-type=module -e "$(printf %s '${toBase64(READER_JS)}' | base64 -d)"`,
  ].join('\n');
}

export type ManualUsageResult = {
  capturedAt: number;
  usages: AgentUsage[];
  /** Agents that could not be read, with the reason. */
  errors: { agent: 'claude' | 'codex'; message: string }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// The CLI marks windows the same way (synthesizeStatus in happy-cli).
function statusFor(utilization: number | null): string | undefined {
  if (utilization == null) return undefined;
  if (utilization >= 100) return 'rejected';
  if (utilization >= 90) return 'allowed_warning';
  return 'allowed';
}

function clampPercent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : null;
}

/** get_usage `rate_limits`: { five_hour: { utilization, resets_at }, seven_day: …, <unused>: null }. */
export function claudeWindows(rateLimits: unknown): UsageLimitWindowLike[] {
  if (!isRecord(rateLimits)) return [];
  const windows: UsageLimitWindowLike[] = [];
  for (const [id, value] of Object.entries(rateLimits)) {
    // Extra usage is billing state, not a plan window.
    if (id === 'extra_usage' || !isRecord(value)) continue;
    if (!('utilization' in value) && !('resets_at' in value)) continue;
    const utilization = clampPercent(value.utilization);
    const resetsAt = typeof value.resets_at === 'string' ? Date.parse(value.resets_at) : NaN;
    windows.push({
      id,
      utilization,
      resetsAt: Number.isFinite(resetsAt) ? resetsAt : null,
      status: statusFor(utilization),
    });
  }
  return windows;
}

/** account/rateLimits/read: the `codex` bucket's primary and secondary windows, by duration. */
export function codexWindows(result: unknown): UsageLimitWindowLike[] {
  if (!isRecord(result)) return [];
  const byLimitId = isRecord(result.rateLimitsByLimitId) ? result.rateLimitsByLimitId : null;
  const bucket =
    (byLimitId &&
      (isRecord(byLimitId.codex) ? byLimitId.codex : Object.values(byLimitId).find(isRecord))) ??
    (isRecord(result.rateLimits) ? result.rateLimits : null);
  if (!isRecord(bucket)) return [];
  const windows: UsageLimitWindowLike[] = [];
  for (const value of [bucket.primary, bucket.secondary]) {
    if (!isRecord(value)) continue;
    const id =
      value.windowDurationMins === 7 * 24 * 60
        ? 'seven_day'
        : value.windowDurationMins === 5 * 60
          ? 'five_hour'
          : null;
    if (!id) continue;
    const utilization = clampPercent(value.usedPercent);
    const resetsAt =
      typeof value.resetsAt === 'number' && value.resetsAt > 0
        ? Math.round(value.resetsAt < 1e12 ? value.resetsAt * 1000 : value.resetsAt)
        : null;
    windows.push({ id, utilization, resetsAt, status: statusFor(utilization) });
  }
  return windows;
}

export function parseManualUsage(stdout: string): ManualUsageResult {
  const line = stdout
    .trim()
    .split('\n')
    .reverse()
    .find((candidate) => candidate.startsWith('{'));
  if (!line) throw new Error(stdout.trim() || 'No answer from the computer');
  const raw = JSON.parse(line) as {
    capturedAt?: unknown;
    claude?: { ok: boolean; data?: unknown; error?: string };
    codex?: { ok: boolean; data?: unknown; error?: string };
  };
  const capturedAt = typeof raw.capturedAt === 'number' ? raw.capturedAt : Date.now();
  const result: ManualUsageResult = { capturedAt, usages: [], errors: [] };
  const read = [
    ['claude', raw.claude, claudeWindows],
    ['codex', raw.codex, codexWindows],
  ] as const;
  for (const [agent, answer, toWindows] of read) {
    if (!answer) continue;
    if (!answer.ok) {
      result.errors.push({ agent, message: answer.error ?? 'Unknown error' });
      continue;
    }
    const windows = getUsageLimitRows({ capturedAt, windows: toWindows(answer.data) });
    if (windows.length > 0) result.usages.push({ agent, capturedAt, windows });
  }
  return result;
}
