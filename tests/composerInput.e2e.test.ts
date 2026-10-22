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

test('one tap on send should send the draft and keep the keyboard field focused', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Touch keyboards use the mobile projects.');
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new PerformancePage(page);
  await workspace.openSession();
  await workspace.input().tap();
  await workspace.input().pressSequentially('Send with one tap');
  // A blur moves the composer while the phone keyboard closes, so the tap misses the button.
  await workspace.input().evaluate((element) => {
    (window as unknown as { blurs: number }).blurs = 0;
    element.addEventListener('blur', () => { (window as unknown as { blurs: number }).blurs++; });
  });
  // Act
  await page.getByRole('button', { name: 'Send message', exact: true }).tap();
  // Assert
  await expect.poll(() => server.sends.length).toBe(1);
  await workspace.expectDraft('');
  expect(await page.evaluate(() => (window as unknown as { blurs: number }).blurs)).toBe(0);
  await expect(workspace.input()).toBeFocused();
  const message = await server.encryption.decrypt<{ content: { text: string } }>(server.sends[0].content, server.dataKey);
  expect(message.content.text).toBe('Send with one tap');
});
