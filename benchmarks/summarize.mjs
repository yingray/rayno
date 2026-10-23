import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { arch, release } from 'node:os';

const require = createRequire(import.meta.url);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const stats = values => ({ min: Math.min(...values), median: median(values), max: Math.max(...values) });
const samples = [];
for (const file of (await readdir('.performance/samples')).sort()) {
  samples.push(JSON.parse(await readFile('.performance/samples/' + file, 'utf8')));
}
const pwa = JSON.parse(await readFile('.performance/pwa-transfer.json', 'utf8'));
const report = {
  environment: {
    measuredAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    node: process.version, playwright: require('@playwright/test/package.json').version,
    os: `Darwin ${release()} ${arch()}`, build: 'minified production', workers: 1,
    cpuThrottle: 'none', phones: 'Playwright emulation on the same host, not physical phones',
    displayMetric: 'event injection to the second animation frame after the matching DOM mutation',
  },
  chat: samples.filter(row => row.turns).map(row => ({ ...row,
    liveMs: stats(row.replies.map(reply => reply.ms)),
  })),
  phone: samples.filter(row => row.phone),
  workspace: samples.filter(row => row.count).map(row => ({ ...row,
    groupingMs: stats(row.grouping.map(group => group.ms)),
    draftMs: stats(row.draft.samples),
    fileSearch: row.search.map(row => ({ size: row.size, indexed: row.indexed, parseMs: row.parseMs,
      queries: row.searches.map(query => ({ query: query.query, ms: stats(query.samples.map(sample => sample.ms)) })),
    })),
  })),
  pwa,
};
await writeFile('.performance/report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ chat: report.chat.map(row => ({ browser: row.browser, variant: row.variant, liveMs: row.liveMs, loadMs: row.load.ms })),
  workspace: report.workspace.map(row => ({ browser: row.browser, count: row.count, groupingMs: row.groupingMs, draftMs: row.draftMs })),
  pwa: pwa.totals }, null, 2));
