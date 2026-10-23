import { expect, test } from '@playwright/test';
import { HappyServer } from '../tests/fixtures/HappyServer';
import { toolHeavyHistory } from '../tests/fixtures/toolHeavyHistory';
import { ScalingPage } from './ScalingPage';
import { mkdir, writeFile } from 'node:fs/promises';

async function record(name: string, result: unknown) {
  await mkdir('.performance/samples', { recursive: true });
  await writeFile(`.performance/samples/${name}.json`, JSON.stringify(result, null, 2) + '\n');
}

test('chat rendering should report the cost of a full list and a bounded tail', async ({ page }, info) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  const turns = Number(process.env.RAYNO_BENCH_TURNS || 600);
  await server.setMessages(toolHeavyHistory(turns));
  const view = new ScalingPage(page);
  await view.openSession();
  // Act
  const load = await view.loadHistory();
  const replies = [];
  for (let i = 0; i < 7; i++) {
    const text = `Benchmark reply ${i}`;
    await view.armReply(text);
    await server.pushReply(text);
    replies.push(await view.replySample());
  }
  // Assert: validate the probe, not a host-dependent speed threshold.
  expect(load.pages).toBeGreaterThan(0);
  expect(replies.every(reply => reply.ms > 0 && reply.bottomGap < 4)).toBe(true);
  const result = { browser: info.project.name, variant: process.env.RAYNO_BENCH_VARIANT || 'full', turns, load, replies };
  await info.attach('chat-scaling', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  await record(`chat-${result.variant}-${info.project.name}-${turns}`, result);
  console.log('CHAT_SCALING ' + JSON.stringify(result));
});

test('workspace controls should report grouping, draft input, and file search at scale', async ({ page }, info) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  const count = Number(process.env.RAYNO_BENCH_SESSIONS || 1000);
  server.sessions = server.sessions.slice(0, 1);
  for (let i = 0; i < count - 1; i++) await server.addSession(`scale-${i}`, {
    path: `/real/project-${i % 100}`, summary: { text: `Scale chat ${i}` },
  });
  const view = new ScalingPage(page);
  await view.installCounters();
  await page.goto('/sessions');
  await page.waitForFunction(() => document.querySelector('button[aria-label="Actions for Scale chat 0"]'));
  await view.settle();
  // Act
  const grouping = await view.groupProjects();
  const draft = await view.typeNewDraft();
  const search = await view.fileSearch();
  // Assert
  expect(draft.value).toBe('measure draft input');
  expect(draft.counts.notifications).toBeGreaterThan(0);
  expect(search.every(row => row.indexed >= row.size)).toBe(true);
  const result = { browser: info.project.name, count, grouping, draft, search };
  await info.attach('workspace-scaling', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  await record(`workspace-${info.project.name}-${count}`, result);
  console.log('WORKSPACE_SCALING ' + JSON.stringify(result));
});
