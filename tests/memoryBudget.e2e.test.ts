import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { toolHeavyHistory } from './fixtures/toolHeavyHistory';
import { PerformancePage } from './pages/PerformancePage';

// PERFORMANCE-PLAN.md M01: measure how much heap a chat keeps after the user leaves it.
// The client keeps the decrypted history of each visited chat in memory. The numbers go to the
// `MEMORY_BUDGET` log line for the results log. The assertions check only that the measurement works.
const CHATS = 20;
test('visited tool-heavy chats should report the heap that they keep', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium' || !!testInfo.project.use.isMobile, 'The heap reading needs desktop Chromium.');
  test.setTimeout(240000);
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  for (let index = 1; index <= CHATS; index++) {
    await server.addSession(`chat-${index}`, { summary: { text: `Chat ${index}` } }, { createdAt: 1700000005000 + index });
    await server.setMessages(toolHeavyHistory(40, `Reply in chat ${index}`), `chat-${index}`);
  }
  // One large chat: 200 turns with 1,000 tool calls. The test loads all of its history pages.
  await server.setMessages(toolHeavyHistory(200, 'Reply in the large chat'));
  const cdp = await page.context().newCDPSession(page);
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return Math.round((await cdp.send('Runtime.getHeapUsage')).usedSize / 1024);
  };
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).toBeVisible();
  const start = await heap();
  await page.getByRole('button', { name: /^Claude .*Connected workspace/ }).click();
  await expect(page.getByText('Reply in the large chat', { exact: true })).toBeVisible({ timeout: 30000 });
  await new PerformancePage(page).loadAllHistory();
  await expect(page.getByText('Task 1: check the build', { exact: true })).toBeAttached();
  const largeOpen = await heap();
  const after: number[] = [];
  // Act: open each chat from the list. A page load would clear the heap, so the test only clicks.
  for (let index = 1; index <= CHATS; index++) {
    await page.getByRole('button', { name: new RegExp(`^Claude .*Chat ${index}( |$)`) }).click();
    await expect(page.getByText(`Reply in chat ${index}`, { exact: true })).toBeVisible({ timeout: 30000 });
    after.push(await heap());
  }
  const end = await heap();
  // Assert
  expect(after).toHaveLength(CHATS);
  const perChat = Math.round((after.at(-1)! - after[0]) / (CHATS - 1));
  // After the user leaves the large chat, its loaded history stays: the first small chat adds only `perChat`.
  const result = { startKiB: start, largeOpenKiB: largeOpen, largeKeptKiB: after[0] - perChat - start,
    afterKiB: after, endKiB: end, perChatKiB: perChat };
  await testInfo.attach('memory-budget', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  console.log('MEMORY_BUDGET ' + JSON.stringify(result));
});
