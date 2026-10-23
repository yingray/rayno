import { expect, test } from '@playwright/test';
import { NavigationStatusPage } from './pages/NavigationStatusPage';
import { HappyServer } from './fixtures/HappyServer';

const newer = { commit: 'nav-new', builtAt: '2026-10-24T00:00:00.000Z' };

test('a new release should prompt without interrupting a draft and update only after the user clicks', async ({ page }) => {
  const current = await (await page.request.get('/version.json')).json();
  let version = current;
  await page.route('**/version.json', route => route.fulfill({ json: version }));
  const workspace = new NavigationStatusPage(page);
  await page.goto('/session/floating-panels?demo=1');
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('Keep this unsent draft'); await input.focus();
  await workspace.markPage();
  version = newer;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(workspace.updateNotice()).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Keep this unsent draft');
  expect(await workspace.pageKept()).toBe(true);
  await workspace.installUpdate();
  await expect.poll(() => workspace.pageKept()).toBe(false);
  await expect(input).toHaveValue('Keep this unsent draft');
});

test('a dismissed update should stay dismissed for that version while the icon can still install it', async ({ page }) => {
  let requests = 0, version = newer;
  await page.route('**/version.json', route => { requests++; return route.fulfill({ json: version }); });
  const workspace = new NavigationStatusPage(page);
  await page.goto('/sessions?demo=1');
  await expect(workspace.updateNotice()).toBeVisible();
  await workspace.dismissUpdate();
  const before = requests;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => requests).toBeGreaterThan(before);
  await expect(workspace.updateIcon()).toHaveAttribute('data-update-available', 'true');
  await expect(workspace.updateNotice()).toHaveCount(0);
  await page.reload();
  await expect(workspace.updateIcon()).toBeEnabled();
  await expect(workspace.updateNotice()).toHaveCount(0);
  version = { ...newer, commit: 'nav-next' };
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(workspace.updateNotice()).toBeVisible();
  await workspace.dismissUpdate();
  await workspace.markPage();
  await workspace.activate(workspace.updateIcon());
  await expect.poll(() => workspace.pageKept()).toBe(false);
});

test('background checks should discover a new release without a click', async ({ page }) => {
  await page.clock.install();
  const current = await (await page.request.get('/version.json')).json();
  let version = current;
  await page.route('**/version.json', route => route.fulfill({ json: version }));
  const workspace = new NavigationStatusPage(page);
  await page.goto('/sessions?demo=1');
  await expect(workspace.updateIcon()).toBeEnabled();
  await expect(workspace.updateNotice()).toHaveCount(0);
  version = newer;
  await page.clock.fastForward(5 * 60 * 1000 + 1);
  await expect(workspace.updateNotice()).toBeVisible();
});

test('failed background checks should stay quiet and a failed install should keep the page and allow retry', async ({ page }) => {
  let online = false;
  await page.route('**/version.json', route => online ? route.fulfill({ json: newer }) : route.abort('internetdisconnected'));
  const workspace = new NavigationStatusPage(page);
  await page.goto('/sessions?demo=1');
  await expect(workspace.updateIcon()).toBeEnabled();
  await expect(workspace.updateNotice()).toHaveCount(0);
  await expect(page.getByText('Cannot check for updates. Check your connection.', { exact: true })).toHaveCount(0);
  online = true;
  await workspace.activate(workspace.updateIcon());
  await expect(workspace.updateNotice()).toBeVisible();
  online = false;
  await workspace.markPage();
  await workspace.installUpdate();
  await expect(page.getByText('Cannot check for updates. Check your connection.', { exact: true })).toBeVisible();
  expect(await workspace.pageKept()).toBe(true);
  await expect(workspace.updateNotice().getByRole('button', { name: 'Reload and update', exact: true })).toBeEnabled();
  online = true;
  await workspace.installUpdate();
  await expect.poll(() => workspace.pageKept()).toBe(false);
});

test('navigation updates and unread dots should fit phone widths, short viewports, landscape, and expanded navigation', async ({ page }) => {
  const workspace = new NavigationStatusPage(page);
  await page.route('**/version.json', route => route.fulfill({ json: newer }));
  for (const [width, height] of [[1440, 900], [320, 640], [360, 740], [390, 844], [430, 900], [390, 360], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/sessions?demo=1');
    await workspace.expectUpdateUsable();
    await expect(workspace.unreadBadge()).toHaveCount(1);
    await expect(workspace.unreadBadge()).toHaveText('');
    await expect(workspace.sessionsButton()).toHaveAttribute('aria-description', 'Unread messages');
    if (width === 390 && height === 844) await workspace.capture('navigation-update-prompt-390');
    await workspace.dismissUpdate();
    if (width >= 768) {
      const expand = page.getByRole('button', { name: 'Expand navigation', exact: true });
      if (await expand.isVisible()) await workspace.activate(expand);
      await workspace.markPage();
      await workspace.activate(workspace.updateIcon());
      // The icon is a direct update action when a release is already available.
      await expect.poll(() => workspace.pageKept()).toBe(false);
      await expect(workspace.updateIcon()).toBeEnabled();
    }
    if (width === 390 && height === 844) await workspace.capture('navigation-update-390');
    // The next viewport starts with an undisclosed release so that the notification opens again.
    await page.evaluate(() => sessionStorage.removeItem('rayno.dismissedUpdate'));
  }
});

test('the Sessions dot should follow unread background replies and clear after they are read', async ({ page }) => {
  const server = new HappyServer(); await server.install(page); await server.setWorking(false);
  const workspace = new NavigationStatusPage(page);
  await page.goto('/monitor');
  await expect.poll(() => !!server.socket).toBe(true);
  await expect(workspace.sessionsButton()).toBeVisible();
  await expect(workspace.unreadBadge()).toHaveCount(0);
  await server.pushReply('Background unread update');
  await expect(workspace.unreadBadge()).toHaveCount(1);
  await expect(workspace.unreadBadge()).toHaveText('');
  await page.goto('/session/real-session');
  await expect(page.getByText('Background unread update', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message', exact: true }).click();
  await page.goto('/monitor');
  await expect(workspace.unreadBadge()).toHaveCount(0);
});

test('read permission requests and hidden side chats should not create an unread Sessions dot', async ({ page }) => {
  const server = new HappyServer(); await server.install(page); await server.setWorking(false);
  await server.addSession('side-nav', { parentSessionId: 'real-session', isSideChat: true });
  const workspace = new NavigationStatusPage(page);
  await page.goto('/monitor');
  await expect(workspace.sessionsButton()).toBeVisible();
  await expect.poll(() => !!server.socket).toBe(true);
  await server.updateAgentState({ requests: { request: { tool: 'Read', arguments: { file: 'README.md' } } } });
  await server.pushEvent({ role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'Hidden side reply' } } }, 'side-nav');
  await expect(workspace.unreadBadge()).toHaveCount(0);
});
