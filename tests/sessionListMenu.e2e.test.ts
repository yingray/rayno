import { test, expect } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

test('session controls should search in the title and switch grouping and visibility without mutations', async ({ page }) => {
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await workspace.route('/sessions');
  await expect(workspace.sessionRow()).toBeVisible();
  await expect(workspace.sessionSearch()).toHaveCount(0);
  const list = workspace.sessionList();
  await expect(list.getByRole('group', { name: 'Session list mode', exact: true })).toBeVisible();
  await expect(list.getByRole('group', { name: 'Session visibility', exact: true })).toHaveCount(0);
  await expect(list.getByRole('button', { name: 'Collapse session list', exact: true })).toHaveCount(0);

  await workspace.openSessionSearch();
  await expect(list.getByRole('heading', { name: 'Sessions', exact: true })).toHaveCount(0);
  await workspace.sessionSearch().fill('No matching workspace');
  await expect(workspace.sessionRows()).toHaveCount(0);
  await workspace.sessionSearch().fill('');
  await expect(workspace.sessionRows()).toHaveCount(1);
  await list.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(list.getByRole('button', { name: 'Projects', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await workspace.closeSessionSearch();
  await expect(workspace.searchButton()).toBeFocused();
  await workspace.showArchive(true);
  await expect(workspace.sessionRow('Older workspace')).toBeVisible();
  await expect(workspace.sessionRow('Connected workspace')).toHaveCount(0);
  await list.getByRole('button', { name: 'Flat', exact: true }).click();
  await workspace.archiveToggle().press('Space');
  await expect(workspace.archiveToggle()).toHaveAttribute('aria-pressed', 'false');
  await expect(workspace.sessionRow('Connected workspace')).toBeVisible();
  expect(server.sends).toEqual([]);
  expect(server.spawns).toEqual([]);
  expect(server.mutations).toEqual([]);
});

test('header search should support the shortcut, rounded focus, and Escape in phone and landscape viewports', async ({ page }, testInfo) => {
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 360], [844, 390], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await workspace.route('/session/real-session');
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    const search = workspace.sessionSearch();
    await expect(search).toBeFocused();
    const field = await search.evaluate(input => ({ font: parseFloat(getComputedStyle(input).fontSize),
      inner: getComputedStyle(input).outlineStyle, outline: getComputedStyle(input.parentElement!).outlineWidth }));
    expect(field).toEqual({ font: 16, inner: 'none', outline: '1px' });
    await search.fill('project');
    for (const control of [workspace.sessionList().getByRole('button', { name: 'Projects', exact: true }),
      workspace.archiveToggle(),
      workspace.sessionList().getByRole('button', { name: 'Close session search', exact: true })]) {
      await control.scrollIntoViewIfNeeded();
      const box = (await control.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(height);
    }
    if (width === 390 && height === 844) await workspace.capture(`${testInfo.project.name}-header-search`);
    await search.focus();
    await search.press('Escape');
    await expect(search).toHaveCount(0);
    await expect(workspace.searchButton()).toBeFocused();
    await workspace.expectNoPageOverflow();
  }
});
