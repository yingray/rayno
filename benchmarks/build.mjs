import { build } from 'vite';
import { resolve } from 'node:path';

// These transforms exist only in the isolated benchmark builds.
const variant = process.env.RAYNO_BENCH_VARIANT || 'full';
if (!['full', 'tail'].includes(variant)) throw new Error('Use full or tail.');
await build({
  build: { outDir: resolve('.performance', variant), emptyOutDir: true },
  plugins: [{
    name: 'rayno-scaling-probe',
    enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/src/features/MessageList.tsx') && variant === 'tail') {
        const target = '{blocks.map((block) =>';
        if (!code.includes(target)) throw new Error('MessageList changed. Update the tail probe.');
        code = code.replace(target, '{blocks.slice(-60).map((block) =>');
      }
      if (id.endsWith('/src/data/subscriptions.ts')) {
        code = code.replace('const selected = selector(snapshot);',
          'globalThis.__raynoScale && globalThis.__raynoScale.selectors++; const selected = selector(snapshot);');
        code = code.replace('listeners.forEach((listener) => listener());',
          'globalThis.__raynoScale && globalThis.__raynoScale.notifications++; listeners.forEach((listener) => listener());');
      }
      if (id.endsWith('/src/happy/client.ts')) code = code.replace('this.historyRequests.set(id, promise);',
        'globalThis.__raynoHistory = promise; this.historyRequests.set(id, promise);');
      if (id.endsWith('/src/features/NewSession.tsx')) code = code.replace('const t = useText();',
        'globalThis.__raynoScale && globalThis.__raynoScale.newRenders++; const t = useText();');
      if (id.endsWith('/src/features/Sessions.tsx')) {
        code = code.replace('const { allSessions, loading, offline } =',
          'globalThis.__raynoScale && globalThis.__raynoScale.listRenders++; const { allSessions, loading, offline } =');
        code = code.replace('export const SessionList =', `
          function __group(sessions: Session[], group: string) {
            const start = performance.now();
            const result = sessions.filter(session => !group || session.project === group);
            const counters = globalThis.__raynoScale;
            if (counters) { counters.groupMs += performance.now() - start; counters.groupVisits += sessions.length; }
            return result;
          }
          export const SessionList =`);
        code = code.replace('sessions.filter((session) => session.project === group)', '__group(sessions, group)')
          .replace('sessions\n                .filter((session) => !group || session.project === group)', '__group(sessions, group)');
      }
      return code;
    },
    transformIndexHtml: { order: 'pre', handler: () => [{ tag: 'script', attrs: { type: 'module', src: '/benchmarks/search.ts' }, injectTo: 'head' }] },
  }],
});
