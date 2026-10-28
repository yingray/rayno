import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { ChatScrollPage } from './pages/ChatScrollPage';

async function arrange(page: import('@playwright/test').Page, count: number, faster = false) {
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  server.setSessionActive('older-session', true);
  await server.setMessages(Array.from({ length: count }, (_, index) => ({
    role: 'agent', content: { type: 'codex', data: { type: 'message', message:
      `### Reply ${index + 1}\n\n${'Keep the reading position across session navigation. '.repeat(8)}` } },
  })));
  await page.route('https://api.cluster-fluster.com/v3/sessions/real-session/messages?**', route => route.fulfill({
    contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ messages: server.messages, hasMore: false }),
  }));
  const view = new ChatScrollPage(page);
  if (faster) await view.enableFasterChats();
  await page.goto('/session/real-session');
  await expect(page.getByRole('heading', { name: `Reply ${count}`, exact: true })).toBeAttached();
  await expect.poll(async () => (await view.conversationPosition()).remaining).toBeLessThan(4);
  return { server, view };
}

for (const [count, faster] of [[40, false], [320, false], [320, true]] as const) {
  test(`chat should keep following after a downward gesture at latest in a ${count}-reply ${faster ? 'virtual' : 'full'} session`, async ({ page }, info) => {
    // Arrange
    const { server, view } = await arrange(page, count, faster);
    // Act
    await view.scrollDownAtLatest(info.project.name === 'mobile-webkit');
    await server.pushReply('Continue following after a gesture at the bottom.\n\n' + 'New detail.\n\n'.repeat(18));
    // Assert
    await expect(page.getByText('Continue following after a gesture at the bottom.', { exact: true })).toBeAttached();
    await expect.poll(async () => (await view.conversationPosition()).remaining).toBeLessThan(2);
    await expect(view.latestShortcut()).toHaveCount(0);
  });
  for (const size of ['desktop', '320x568', '360x640', '390x844', '430x932', '390x360', '844x390'] as const)
  test(`chat should stop following after a small upward scroll in a ${count}-reply ${faster ? 'virtual' : 'full'} session at ${size}`, async ({ page }, info) => {
    test.skip((size === 'desktop') === !!info.project.use.hasTouch, 'Run each size in its matching input projects.');
    const [width, height] = size === 'desktop' ? [1440, 900] : size.split('x').map(Number);
    await page.setViewportSize({ width, height });
    // Arrange
    const { server, view } = await arrange(page, count, faster);
    // Act: the first trackpad step can stay inside the former 90px follow threshold.
    await view.scrollUpStep(40, info.project.name === 'mobile-webkit');
    const anchor = await view.readingRow();
    const reply = 'A live reply while the reader starts to scroll up.';
    await server.pushReply(reply + '\n\n' + 'New detail.\n\n'.repeat(12));
    // Assert: check every frame, including transient downward pulls.
    await expect(page.getByText(reply, { exact: true })).toBeAttached();
    await view.expectNoDownwardPull(anchor);
    await expect(view.latestShortcut()).toBeVisible();
    if (info.project.use.hasTouch) await view.latestShortcut().tap();
    else await view.latestShortcut().click();
    await expect.poll(async () => (await view.conversationPosition()).remaining).toBeLessThan(2);
  });
}

for (const faster of [false, true]) {
  test(`chat scroll demo should keep latest gestures and new replies usable in ${faster ? 'virtual' : 'full'} mode across viewports`, async ({ page }, info) => {
    test.setTimeout(90000);
    // Arrange
    const view = new ChatScrollPage(page);
    await view.openScrollDemo(faster);
    const mobile = !!info.project.use.hasTouch;
    const keyboard = info.project.name === 'mobile-webkit';
    const sizes = mobile ? [[320, 568], [360, 640], [390, 844], [430, 932], [390, 360], [844, 390]] : [[1440, 900]];
    for (const [width, height] of sizes) {
      // Act / Assert: the same controls work with touch, short viewports and landscape.
      await page.setViewportSize({ width, height });
      await view.expectLatestHidden();
      await view.scrollDownAtLatest(keyboard);
      await view.touchDownAtLatest();
      await view.tapConversation(mobile);
      await view.scrollUpStep(40, keyboard);
      await expect(view.latestShortcut()).toBeVisible();
      await view.scrollBackToLatest(keyboard);
      await view.expectLatestReachable(mobile);
      await view.expectLatestHidden();
      await view.expectNoPageOverflow();
    }
    // New replies still follow after a gesture that does not move the viewport.
    await view.send('Keep following the demo reply.');
    await view.waitForSentMessage('Keep following the demo reply.');
    await view.scrollDownAtLatest(keyboard);
    await view.expectSimulatedReplies(1);
    await view.expectLatestHidden();
    // The example repeats, and an upward gesture retains the reading row during a reply.
    await view.send('Let me read earlier replies.');
    await view.waitForSentMessage('Let me read earlier replies.');
    await view.scrollUpStep(40, keyboard);
    const anchor = await view.readingRow();
    await view.expectSimulatedReplies(2);
    await view.expectNoDownwardPull(anchor);
    await expect(view.latestShortcut()).toBeVisible();
    await view.returnToLatest();
  });
}

test('chat scroll demo should restore its example without losing older sessions, drafts or preferences', async ({ page }) => {
  // Arrange
  const view = new ChatScrollPage(page);
  await view.openScrollDemo();
  await view.removeSavedScrollDemo();
  // Act
  await view.openScrollDemo();
  // Assert
  await view.expectSavedDemoPreserved();
});

for (const count of [40, 320]) {
  test(`chat should show the latest shortcut after a browser scroll in a ${count}-reply session`, async ({ page }, info) => {
    // Arrange
    const { view } = await arrange(page, count);
    // Act: browsers can move the scroll box without a wheel or touch event.
    await view.moveReadingPosition();
    // Assert
    await expect(view.latestShortcut()).toBeVisible();
    await view.returnToLatest();
    await view.expectLatestReachable(!!info.project.use.hasTouch);
  });

  test(`chat should retain its reading row through session switches in a ${count}-reply session`, async ({ page }) => {
    // Arrange
    const { view } = await arrange(page, count);
    await view.moveReadingPosition(true);
    const anchor = await view.readingRow();
    // Act
    await view.switchAwayAndBack();
    // Assert
    await view.expectReadingRow(anchor);
    await expect(view.latestShortcut()).toBeVisible();
    await view.returnToLatest();
    await view.switchAwayAndBack();
    await expect.poll(async () => (await view.conversationPosition()).remaining).toBeLessThan(4);
    await expect(view.latestShortcut()).toHaveCount(0);
  });

  test(`chat should restore the same reading row after reopening a ${count}-reply session at a new width`, async ({ page }, info) => {
    // Arrange
    const { view } = await arrange(page, count);
    await view.moveReadingPosition(true);
    const anchor = await view.readingRow();
    await view.showSessions();
    await view.openRow('Older workspace');
    // Act
    await page.setViewportSize(info.project.use.isMobile ? { width: 844, height: 390 } : { width: 390, height: 844 });
    await view.showSessions();
    await view.openRow();
    // Assert
    await view.expectReadingRow(anchor);
    await expect(view.latestShortcut()).toBeVisible();
  });

  test(`chat should follow new replies after reopening a ${count}-reply session that was at latest`, async ({ page }) => {
    // Arrange
    const { server, view } = await arrange(page, count);
    await view.showSessions();
    await view.openRow('Older workspace');
    // Act
    await server.pushReply('New work while this session was closed.\n\n' + 'A new paragraph.\n\n'.repeat(35));
    await view.showSessions();
    await view.openRow();
    // Assert
    await expect.poll(async () => (await view.conversationPosition()).remaining).toBeLessThan(4);
    await expect(view.latestShortcut()).toHaveCount(0);
  });

  test(`chat should retain an encrypted reading position after reloading a ${count}-reply session`, async ({ page }) => {
    // Arrange
    const { server, view } = await arrange(page, count);
    await view.moveReadingPosition(true);
    const anchor = await view.readingRow();
    await expect.poll(async () => {
      const encrypted = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.endsWith('.transcript.real-session'))?.[1]);
      if (!encrypted) return;
      expect(encrypted).not.toContain(anchor.id);
      return JSON.parse(await server.encryption.decrypt<string>(encrypted, null)).id;
    }).toBe(`message:${anchor.id}`);
    // Act
    await page.reload();
    // Assert
    await view.expectReadingRow(anchor);
    await expect(view.latestShortcut()).toBeVisible();
  });

  test(`chat should keep reading and the latest action usable across phone viewports in a ${count}-reply session`, async ({ page }, info) => {
    test.skip(!info.project.use.isMobile, 'Phone interaction matrix.');
    test.setTimeout(90000);
    // Arrange
    const { view } = await arrange(page, count);
    // Act / Assert
    for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 360], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await view.waitForLatestLayout();
      await view.expectLatestReachable(true);
      await view.moveReadingPosition(true);
      const anchor = await view.readingRow();
      await view.switchAwayAndBack();
      await view.expectReadingRow(anchor);
      await view.latestShortcut().tap();
      await expect.poll(async () => (await view.conversationPosition()).remaining).toBeLessThan(4);
      await view.expectNoPageOverflow();
    }
  });
}
