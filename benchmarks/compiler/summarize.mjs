import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { median, pairedStats, holm } from './stats.mjs';

const projects = ['desktop-chromium', 'mobile-chromium', 'desktop-webkit', 'mobile-webkit'];
const groups = [], runs = [];
for (const phase of ['profiled', 'production']) {
  for (const project of projects) {
    const run = JSON.parse(await readFile(`.performance/compiler-samples/${phase}-${project}.json`, 'utf8'));
    if (run.phase !== phase || run.pairs !== 8 || run.repetitions !== 7 || run.warmup !== 3 || run.sessions.length !== 16)
      throw new Error(`Incomplete run: ${phase} ${project}`);
    runs.push(run);
    for (const kind of ['live', 'option', 'input']) {
      const metrics = phase === 'profiled' ? ['renderMs', 'commits'] : ['domMs', 'nextFrameMs'];
      for (const metric of metrics) {
        const pairs = [];
        for (let index = 0; index < run.pairs; index++) {
          const values = [false, true].map(enabled => {
            const rows = run.sessions.filter(session => session.pair === index && session.enabled === enabled);
            if (rows.length !== 1) throw new Error('Missing paired page.');
            const samples = rows[0].samples.filter(sample => sample.kind === kind);
            if (samples.length !== run.repetitions) throw new Error('Missing interaction samples.');
            return median(samples.map(sample => sample[metric]));
          });
          pairs.push(values);
        }
        groups.push({ phase, project, kind, metric, ...pairedStats(pairs) });
      }
    }
  }
}
// Each metric has a 12-comparison family: four device projects times three interactions.
for (const metric of ['renderMs', 'commits', 'domMs', 'nextFrameMs']) {
  const family = groups.filter(group => group.metric === metric);
  const adjusted = holm(family.map(group => group.signFlipP));
  family.forEach((group, index) => { group.holmP = adjusted[index]; });
}
const sourceFiles = ['benchmarks/compiler/stats.mjs', 'benchmarks/compiler/summarize.mjs', 'package.json', 'pnpm-lock.yaml', 'tests/fixtures/HappyServer.ts', 'tests/fixtures/toolHeavyHistory.ts', 'vite.config.ts', 'benchmarks/compiler/plugin.ts', 'benchmarks/compiler/gate.ts',
  'benchmarks/compiler/main.tsx', 'benchmarks/compiler/metrics.ts', 'benchmarks/compiler/CompilerPage.ts', 'benchmarks/compiler/paired.e2e.test.ts'];
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file =>
  [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
const result = {
  date: '2026-10-26', baseCommit: '8400406', compilerVersion: '1.0.0', sourceHashes,
  method: {
    variants: 'Compiler runtime gating in the same build. Fresh context per variant. Adjacent paired pages alternate off/on and on/off.',
    sessions: 128, bootstrapSeed: 26319, bootstrapIterations: 20000, pairsPerProjectPerPhase: 8, warmupsPerInteractionPerPage: 3, samplesPerInteractionPerPage: 7,
    fixture: '200 turns, 1000 tool calls, full transcript, all history loaded before timing.',
    cpu: 'Production React profiling renderer. Sum of actualDuration for commits from the native event through two animation frames after DOM observation.',
    dom: 'Normal production renderer. Input/click capture or native WebSocket delivery to the matching controlled-textarea, option, or reply DOM observation.',
    frame: 'Two requestAnimationFrame callbacks after DOM observation; a rendering opportunity, not a physical display timestamp or INP.',
    statistics: 'Median within each page; paired on-minus-off median with a seeded 20000-resample paired bootstrap 95% interval. Exact sign-flip p values and Holm adjustment across 12 comparisons per metric.',
    limitations: [
      'Browser emulation on a Mac without CPU throttling; no physical iPhone, battery, or thermal measurements.',
      'Runtime gating keeps both versions in the same bundle. Cold startup and transfer cost are outside this experiment.',
      'Profiling adds overhead, so CPU and user latency use separate builds. Each build uses the same payload for its two variants.',
      'Small render times can reach the browser clock resolution. Sub-millisecond differences need caution.',
      'WebSocket timing excludes fixture encryption and transport before browser delivery, but includes client decryption and state work.',
      'Confidence intervals are descriptive and not simultaneous intervals. Use adjusted p values before any multiple-comparison significance claim.',
    ],
  }, groups, runs,
};
await writeFile('benchmarks/results/2026-10-26-react-compiler-paired.json', JSON.stringify(result, null, 2) + '\n');
for (const group of groups.filter(group => group.metric === 'renderMs' || group.metric === 'domMs')) {
  console.log(`${group.project} ${group.kind} ${group.metric}: ${group.offMedian.toFixed(3)} -> ${group.onMedian.toFixed(3)}; paired delta ${group.pairedMedianDelta.toFixed(3)} [${group.deltaCI95.map(value => value.toFixed(3)).join(', ')}]; adjusted p ${group.holmP.toFixed(4)}`);
}
