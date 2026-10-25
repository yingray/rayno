import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { ChatScrollPage } from './pages/ChatScrollPage';

async function arrange(page: import('@playwright/test').Page, count: number) {
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
  await page.goto('/session/real-session');
  await expect(page.getByRole('heading', { name: `Reply ${count}`, exact: true })).toBeAttached();
  await expect.poll(async () => (await view.conversationPosition()).remaining).toBeLessThan(4);
  return { server, view };
}

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
