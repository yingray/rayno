import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { HappyServer } from '../../tests/fixtures/HappyServer';
import { toolHeavyHistory } from '../../tests/fixtures/toolHeavyHistory';
import { CompilerPage } from './CompilerPage';
import type { Sample } from './metrics';

const phase = process.env.RAYNO_COMPILER_PHASE || 'profiled';
const pairs = Number(process.env.RAYNO_COMPILER_PAIRS || 8);
const repetitions = Number(process.env.RAYNO_COMPILER_SAMPLES || 7);
const warmup = Number(process.env.RAYNO_COMPILER_WARMUP || 3);

test('paired compiler comparison should measure render CPU and browser delivery boundaries', async ({ browser, baseURL }, info) => {
  test.setTimeout(600000);
  const sessions: { pair: number; enabled: boolean; order: number; samples: Sample[] }[] = [];
  for (let pair = 0; pair < pairs; pair++) {
    // Adjacent pairs reverse their first variant: AB, BA, AB, BA.
    const order = pair % 2 ? [true, false] : [false, true];
    for (const [position, enabled] of order.entries()) {
      const device = info.project.use;
      const context = await browser.newContext({ baseURL, viewport: device.viewport, isMobile: device.isMobile,
        hasTouch: device.hasTouch, deviceScaleFactor: device.deviceScaleFactor, userAgent: device.userAgent, serviceWorkers: 'block' });
      try {
        const page = await context.newPage(), server = new HappyServer();
        await server.install(page); await server.setWorking(false);
        await server.setMessages(toolHeavyHistory(200, 'From the real protocol\n\n<options><option>Benchmark choice</option><option>Another choice</option></options>'));
        await page.route('https://api.cluster-fluster.com/v3/sessions/real-session/messages?**', route => route.fulfill({
          contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ messages: server.messages, hasMore: false }),
        }));
        const view = new CompilerPage(page);
        await view.open(enabled);
        const mounted = await page.evaluate(() => window.__raynoCompilerBench.mounted());
        expect(mounted > 0).toBe(phase === 'profiled');
        const samples: Sample[] = [];
        for (let index = 0; index < warmup + repetitions; index++) {
          const label = `Paired reply ${pair}-${position}-${index}`;
          await view.arm('live', label); await server.pushReply(label);
          const sample = await view.sample(); if (index >= warmup) samples.push(sample);
        }
        await view.prepareOptions();
        for (let index = 0; index < warmup + repetitions; index++) {
          await view.arm('option'); await view.choose(!!device.hasTouch);
          const sample = await view.sample(); if (index >= warmup) samples.push(sample);
        }
        for (let index = 0; index < warmup + repetitions; index++) {
          await view.prepareInput(); await view.arm('input'); await view.input().pressSequentially('x');
          const sample = await view.sample(); if (index >= warmup) samples.push(sample);
          await expect(view.input()).toHaveValue('Stable draft x');
        }
        expect(samples).toHaveLength(repetitions * 3);
        expect(samples.every(sample => phase === 'profiled' ? sample.commits > 0 : sample.commits === 0)).toBe(true);
        expect(server.sends).toHaveLength(0);
        sessions.push({ pair, enabled, order: position, samples });
      } finally { await context.close(); }
    }
    console.log(`COMPILER_PAIR ${phase} ${info.project.name} ${pair + 1}/${pairs}`);
  }
  const result = { phase, project: info.project.name, browserVersion: browser.version(), pairs, repetitions, warmup,
    fixture: { turns: 200, toolCalls: 1000, fullTranscript: true }, sessions };
  await mkdir('.performance/compiler-samples', { recursive: true });
  await writeFile(`.performance/compiler-samples/${phase}-${info.project.name}.json`, JSON.stringify(result, null, 2) + '\n');
  await info.attach('compiler-paired-samples', { body: JSON.stringify(result), contentType: 'application/json' });
});
