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

test('Chinese composition should retain text during live updates and send only after an explicit action', async ({ page }, info) => {
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
  if (info.project.use.hasTouch) {
    await workspace.expectDraft('中文輸入不中斷\nnext line\n');
    expect(server.sends).toHaveLength(0);
    await workspace.input().press('Backspace');
    await workspace.sendButton().tap();
  }
  // Assert
  await workspace.expectDraft('');
  if (!info.project.use.hasTouch) await expect(workspace.input()).toBeFocused();
  expect(server.sends).toHaveLength(1);
  const message = await server.encryption.decrypt<{ content: { text: string } }>(server.sends[0].content, server.dataKey);
  expect(message.content.text).toBe('中文輸入不中斷\nnext line');
});

test('send confirmation should keep a newer draft typed while the request is pending', async ({ page }, info) => {
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
  if (info.project.use.hasTouch) await workspace.sendButton().tap();
  else await workspace.input().press('Enter');
  await expect(page.getByText('Wait for Happy to confirm this message…', { exact: true })).toBeVisible();
  await workspace.input().fill('保留下一則草稿');
  release();
  // Assert
  await expect.poll(() => server.sends.length).toBe(1);
  await expect(page.getByText('Wait for Happy to confirm this message…', { exact: true })).toHaveCount(0);
  await workspace.expectDraft('保留下一則草稿');
  await workspace.expectDraftAfterReload('保留下一則草稿');
});

test('one tap on send should dismiss the phone keyboard before confirmation and keep it closed after confirmation at every phone size', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Touch keyboards use the mobile projects.');
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new PerformancePage(page);
  await workspace.openSession();
  let release!: () => void;
  let gate = Promise.resolve();
  await page.route('**/v3/sessions/*/messages', async (route) => {
    if (route.request().method() === 'POST') await gate;
    await route.fallback();
  });
  // Act / Assert
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 430], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await workspace.input().tap();
    const text = `Send with one tap at ${width}x${height}`;
    await workspace.input().pressSequentially(text);
    await workspace.watchSendFocus();
    await workspace.expectSendReachable();
    const count = server.sends.length;
    gate = new Promise<void>((resolve) => { release = resolve; });
    try {
      await workspace.sendButton().tap();
      await workspace.expectKeyboardDismissedAfterClick();
      await expect(page.getByText('Wait for Happy to confirm this message…', { exact: true })).toBeVisible();
      await expect(workspace.sendButton()).toBeDisabled();
      expect(server.sends).toHaveLength(count);
    } finally {
      release();
    }
    await expect.poll(() => server.sends.length).toBe(count + 1);
    await workspace.expectDraft('');
    await expect(page.getByText('Wait for Happy to confirm this message…', { exact: true })).toHaveCount(0);
    await workspace.expectKeyboardDismissedAfterClick();
    await workspace.expectSendReachable();
    await workspace.expectNoPageOverflow();
    const message = await server.encryption.decrypt<{ content: { text: string } }>(server.sends[count].content, server.dataKey);
    expect(message.content.text).toBe(text);
  }
});

test('a failed phone send should keep the keyboard closed and retain the draft for a one-tap retry', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Touch keyboards use the mobile projects.');
  // Arrange
  const server = new HappyServer();
  server.failFirstSend = true;
  await server.install(page);
  const workspace = new PerformancePage(page);
  await workspace.openSession();
  await workspace.input().tap();
  await workspace.input().pressSequentially('Keep this draft for retry');
  await workspace.watchSendFocus();
  // Act
  await workspace.sendButton().tap();
  // Assert
  await expect(page.getByRole('alert')).toContainText('confirmation lost');
  await workspace.expectKeyboardDismissedAfterClick();
  await workspace.expectDraft('Keep this draft for retry');
  // Act
  await workspace.sendButton().tap();
  // Assert
  await workspace.expectDraft('');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(workspace.input()).not.toBeFocused();
  expect(server.sends).toHaveLength(2);
  expect(server.sends[1]).toEqual(server.sends[0]);
});

test('a desktop send button should restore input focus after confirmation', async ({ page }, testInfo) => {
  test.skip(!!testInfo.project.use.hasTouch, 'Desktop mouse users keep input focus.');
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new PerformancePage(page);
  await workspace.openSession();
  await workspace.input().fill('Keep typing on desktop');
  // Act
  await workspace.sendButton().click();
  // Assert
  await workspace.expectDraft('');
  await expect(workspace.input()).toBeFocused();
  expect(server.sends).toHaveLength(1);
});
