import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

// happy-cli api/apiSession.ts sendSessionEvent writes these records. runClaude.ts sends `switch` on each mode change.
const sessionEvent = (data: object) => ({ role: 'agent', content: { id: crypto.randomUUID(), type: 'event', data } });
const reply = (text: string) => ({ role: 'agent', content: { type: 'codex', data: { type: 'message', message: text } } });
const choices = '<options><option>Keep going</option><option>Stop here</option></options>';

test('agent events should show compact rows that do not answer options, take the recap, or mark the session unread', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  await server.setMessages([
    { role: 'user', content: { type: 'text', text: 'Check the build' } },
    reply('From the real protocol\n\nChoose the next step.\n\n' + choices),
    sessionEvent({ type: 'switch', mode: 'local' }),
    sessionEvent({ type: 'ready' }),
    sessionEvent({ type: 'message', message: 'Turn started' }),
    sessionEvent({ type: 'switch', mode: 'remote' }),
  ]);
  const workspace = new LiveWorkspacePage(page);
  const events = page.locator('[data-role="event"]');
  // Act
  await workspace.openSession();
  // Assert
  await expect(events).toHaveText(['Switched to local mode', 'Switched to remote mode']);
  await expect(page.locator('article [data-role="event"]')).toHaveCount(0);
  await expect(workspace.replyOptions().getByRole('button')).toHaveText(['Keep going', 'Stop here']);
  for (const button of await workspace.replyOptions().getByRole('button').all()) await expect(button).toBeEnabled();
  const recap = page.getByRole('button', { name: 'Recap this reply', exact: true });
  await expect(recap).toBeVisible();
  expect((await recap.boundingBox())!.y).toBeLessThan((await events.first().boundingBox())!.y);
  const style = await events.first().evaluate((element) => {
    const css = getComputedStyle(element);
    return { size: parseFloat(css.fontSize), align: css.textAlign };
  });
  expect(style.size).toBeLessThanOrEqual(13);
  expect(style.align).toBe('center');
  await workspace.capture(`${testInfo.project.name}-agent-events`);
  // Act
  await server.pushEvent(sessionEvent({ type: 'message', message: 'Aborted by user' }));
  // Assert
  await expect(events).toHaveText(['Switched to local mode', 'Switched to remote mode', 'Aborted by user']);
  await expect(workspace.replyOptions().getByRole('button').first()).toBeEnabled();
  // Act
  await workspace.openOtherSession();
  await server.pushEvent(sessionEvent({ type: 'switch', mode: 'local' }));
  await workspace.showSessions();
  // Assert
  await expect(workspace.sessionRow('Connected workspace')).toBeVisible();
  await expect(workspace.indicator('Unread')).toHaveCount(0);
  // Act
  await server.pushReply('A real reply');
  // Assert
  await expect(workspace.indicator('Unread')).toBeVisible();
  expect(server.sends).toEqual([]);
});

test('agent event rows should fit phones, short screens, and landscape', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setMessages([
    { role: 'user', content: { type: 'text', text: 'Check the build' } },
    reply('From the real protocol'),
    sessionEvent({ type: 'switch', mode: 'local' }),
    sessionEvent({ type: 'message', message: 'Codex error: stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)' }),
  ]);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  const events = page.locator('[data-role="event"]');
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 420], [844, 390]]) {
    // Act
    await page.setViewportSize({ width, height });
    await events.last().scrollIntoViewIfNeeded();
    // Assert
    await expect(events).toHaveCount(2);
    for (const event of await events.all()) {
      const box = (await event.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await expect(events.last()).toBeInViewport();
    await workspace.expectNoPageOverflow();
  }
});
