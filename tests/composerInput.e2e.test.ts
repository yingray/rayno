import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { PerformancePage } from './pages/PerformancePage';

for (const legacy of [false, true]) {
  test(`typing should keep the input height stable and resize long drafts (${legacy ? 'legacy' : 'native'} sizing)`, async ({ page }, testInfo) => {
    // Arrange
    const server = new HappyServer();
    await server.install(page);
    const workspace = new PerformancePage(page);
    if (legacy) await workspace.useLegacyTextareaSizing();
    await workspace.openSession();
    // Act
    await workspace.watchInputSize();
    await workspace.input().pressSequentially('bcdefghijk');
    // Assert
    await workspace.expectNoInputHeightReset();
    const sizes = testInfo.project.name.startsWith('mobile')
      ? [[320, 700], [360, 700], [390, 844], [430, 844], [390, 430], [844, 390]]
      : [[1440, 900]];
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await workspace.expectGrowingDraftUsable();
    }
    await workspace.expectNoChatStyleInvalidation();
    await workspace.expectDraftAfterReload('縮短後仍可編輯');
    expect(server.sends).toHaveLength(0);
  });
}

test('Chinese composition should retain text during live updates and send only after an explicit Enter', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new PerformancePage(page);
  await workspace.openSession();
  // Act
  await workspace.startComposition('中文輸入不中斷');
  await server.setWorking(true);
  await server.pushReply('The agent replies during composition');
  await expect(page.getByText('The agent replies during composition', { exact: true })).toBeAttached();
  await workspace.finishComposition('中文輸入不中斷');
  // Assert
  await workspace.expectDraft('中文輸入不中斷');
  expect(server.sends).toHaveLength(0);
  // Act
  await workspace.input().press('Shift+Enter');
  await workspace.input().pressSequentially('next line');
  await workspace.input().press('Enter');
  // Assert
  await workspace.expectDraft('');
  expect(server.sends).toHaveLength(1);
  const message = await server.encryption.decrypt<{ content: { text: string } }>(server.sends[0].content, server.dataKey);
  expect(message.content.text).toBe('中文輸入不中斷\nnext line');
});

test('send confirmation should keep a newer draft typed while the request is pending', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new PerformancePage(page);
  await workspace.openSession();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/v3/sessions/*/messages', async (route) => {
    if (route.request().method() === 'POST') await gate;
    await route.fallback();
  });
  // Act
  await workspace.input().fill('Send this first');
  await workspace.input().press('Enter');
  await expect(page.getByText('Wait for Happy to confirm this message…', { exact: true })).toBeVisible();
  await workspace.input().fill('保留下一則草稿');
  release();
  // Assert
  await expect.poll(() => server.sends.length).toBe(1);
  await expect(page.getByText('Wait for Happy to confirm this message…', { exact: true })).toHaveCount(0);
  await workspace.expectDraft('保留下一則草稿');
  await workspace.expectDraftAfterReload('保留下一則草稿');
});
