import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { deniedRequests, toolHeavyHistory } from './fixtures/toolHeavyHistory';
import { PerformancePage } from './pages/PerformancePage';

// The phase 0 baseline in PERFORMANCE-PLAN.md. The assertions check that the measurement works.
// The timings go to the `perf-baseline` attachment and to one `PERF_BASELINE` log line for the results log.
test('a tool-heavy chat should report stage timings for load, reconnect, and live replies', async ({ page }, testInfo) => {
  test.setTimeout(240000);
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setMessages(toolHeavyHistory());
  server.sessions[0].agentState = await server.encryption.encrypt({ completedRequests: deniedRequests() }, server.dataKey);
  const workspace = new PerformancePage(page);
  await workspace.enableStageTiming();
  await workspace.openSession();
  // Act
  await workspace.loadAllHistory();
  const load = await workspace.sample();
  await workspace.resetSample();
  await server.socket!.close();
  await workspace.waitForRecovery();
  const recovery = { timeline: await workspace.recoveryTimeline(), ...await workspace.sample() };
  await workspace.resetSample();
  const pushed = Date.now();
  for (let index = 0; index < 20; index++) {
    server.setSessionActive('real-session', true);
    await server.pushReply(`Live reply ${index}`);
  }
  // The list renders the long history again for the new replies. On a busy host this can take more than 5 s.
  await expect(page.getByText('Live reply 19', { exact: true })).toBeAttached({ timeout: 30000 });
  const live = { shownAfter: Date.now() - pushed, ...await workspace.sample() };
  // Assert
  await expect(page.getByText(/^Task \d+: check the build$/)).toHaveCount(200);
  expect(load.stages['group-chat-activity']?.count).toBeGreaterThan(0);
  expect(load.stages['visible-messages']?.count).toBeGreaterThan(0);
  expect(recovery.timeline['transport-connected']).not.toBeNull();
  expect(recovery.timeline['list-refreshed']).not.toBeNull();
  expect(live.stages.publish?.count).toBeGreaterThanOrEqual(20);
  const result = { project: testInfo.project.name, load, recovery, live };
  await testInfo.attach('perf-baseline', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  console.log('PERF_BASELINE ' + JSON.stringify(result));
});
