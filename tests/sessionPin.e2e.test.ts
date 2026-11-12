import { expect, test } from '@playwright/test';
import { SessionPinPage } from './pages/SessionPinPage';

for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 932], [390, 360], [844, 390], [1440, 900]]) {
  test(`session pin - ${width}x${height} - should keep a pinned session first across modes and reload`, async ({ page }) => {
    // Arrange
    await page.setViewportSize({ width, height });
    const list = new SessionPinPage(page, 'demo');
    await list.openList();
    await list.expectFirst(false);
    await expect(list.pinMark()).toHaveCount(0);

    // Act / Assert
    await list.toggleFromRow('Pin session');
    await list.expectFirst(true);
    await expect(list.pinMark()).toBeVisible();
    await list.expectNoPageOverflow();

    await page.reload();
    await list.expectFirst(true);
    await list.activate(list.grouping('projects'));
    await list.expectFirst(true);
    await expect(list.pinMark()).toBeVisible();
    await list.activate(list.grouping('flat'));

    await list.toggleFromRow('Unpin session');
    await list.expectFirst(false);
    await expect(list.pinMark()).toHaveCount(0);
    await list.toggleFromRow('Pin session');
    await list.expectFirst(true);
    await list.expectNoPageOverflow();
  });
}

test('session pin - older demo data - should open the direct link and pin from the chat menu', async ({ page }) => {
  // Arrange
  const list = new SessionPinPage(page, 'demo');
  await list.openList();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('rayno.demo.v1'))).toBeTruthy();
  const sessionCount = await page.evaluate(() => {
    const key = 'rayno.demo.v1';
    const saved = JSON.parse(localStorage.getItem(key)!);
    saved.sessions = saved.sessions.filter((session: { id: string }) => session.id !== 'pin-sessions-demo');
    delete saved.preferences.pinnedSessions;
    saved.preferences.sessionListMode = 'projects';
    saved.drafts.untouched = 'Keep this draft';
    localStorage.setItem(key, JSON.stringify(saved));
    return saved.sessions.length;
  });

  // Act
  await page.goto('/session/pin-sessions-demo?demo=1');
  await expect(page.getByRole('heading', { name: 'Pin sessions', exact: true })).toBeVisible();
  await list.toggleFromChat('Pin session');

  // Assert
  await expect.poll(() => list.savedPins()).toEqual(['pin-sessions-demo']);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rayno.demo.v1')!));
  expect(saved.sessions).toHaveLength(sessionCount + 1);
  expect(saved.drafts.untouched).toBe('Keep this draft');
  expect(saved.preferences.sessionListMode).toBe('projects');
  await list.openList();
  await list.expectFirst(true);
  await page.goto('/session/pin-sessions-demo?demo=1');
  await list.toggleFromChat('Unpin session');
  await expect.poll(() => list.savedPins()).toEqual([]);
});
