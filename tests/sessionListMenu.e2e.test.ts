import { test, expect } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

test('one list menu should search, group, filter archived sessions, reset, and dismiss without changing a session', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await workspace.route('/sessions');
  await expect(workspace.sessionRow()).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Search sessions', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Session list mode', exact: true })).toHaveCount(0);

  // Act / Assert
  await workspace.openListOptions();
  await expect(workspace.listOptions()).toBeFocused();
  const search = workspace.listOptions().getByRole('textbox', { name: 'Search sessions', exact: true });
  await search.fill('No matching workspace');
  await expect(workspace.sessionRows()).toHaveCount(0);
  await workspace.listOptions().getByRole('button', { name: 'Clear session search', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(workspace.sessionRows()).toHaveCount(1);
  await workspace.listOptions().getByRole('group', { name: 'Session list mode', exact: true })
    .getByRole('button', { name: 'Projects', exact: true }).click();
  await workspace.closeListOptions();
  await expect(workspace.listOptionsButton()).toBeFocused();
  await expect(workspace.listOptionsButton().getByRole('img', { name: 'Active list filters', exact: true })).toBeVisible();
  await workspace.openListOptions();
  await expect(workspace.listOptions().getByRole('button', { name: 'Projects', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await workspace.closeListOptions();
  await workspace.showArchive(true);
  await expect(workspace.sessionRow('Older workspace')).toBeVisible();
  await expect(workspace.sessionRow('Connected workspace')).toHaveCount(0);
  await workspace.openListOptions();
  await workspace.listOptions().getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(workspace.listOptions().getByRole('button', { name: 'Flat', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(workspace.listOptions().getByRole('button', { name: 'Active', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(workspace.sessionRow('Connected workspace')).toBeVisible();
  await page.getByRole('region', { name: 'Session list', exact: true }).getByRole('heading', { name: 'Sessions', exact: true }).click();
  await expect(workspace.listOptions()).toHaveCount(0);
  await expect(workspace.listOptionsButton().getByRole('img', { name: 'Active list filters', exact: true })).toHaveCount(0);
  await workspace.capture(`${testInfo.project.name}-compact-session-list`);
  expect(server.sends).toEqual([]);
  expect(server.spawns).toEqual([]);
  expect(server.mutations).toEqual([]);
});

test('list options should fit phone and landscape viewports and open search with the keyboard shortcut', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // Act / Assert
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 430], [844, 390], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await workspace.route('/session/real-session');
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    const menu = workspace.listOptions();
    const search = menu.getByRole('textbox', { name: 'Search sessions', exact: true });
    await expect(search).toBeFocused();
    const panel = (await menu.boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(width);
    expect(panel.y + panel.height).toBeLessThanOrEqual(height);
    const field = await search.evaluate((input) => {
      const frame = getComputedStyle(input.parentElement!);
      return { font: parseFloat(getComputedStyle(input).fontSize), inner: getComputedStyle(input).outlineStyle,
        outline: frame.outlineWidth, radius: parseFloat(frame.borderRadius),
        touch: matchMedia('(pointer: coarse)').matches };
    });
    expect(field.outline).toBe('1px');
    expect(field.radius).toBeGreaterThan(0);
    expect(field.inner).toBe('none');
    if (width < 768 || field.touch) expect(field.font).toBeGreaterThanOrEqual(16);
    await search.fill('project');
    for (const control of [menu.getByRole('button', { name: 'Projects', exact: true }),
      menu.getByRole('button', { name: 'Archived', exact: true }), menu.getByRole('button', { name: 'Done', exact: true })]) {
      await control.scrollIntoViewIfNeeded();
      const target = (await control.boundingBox())!;
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.y).toBeGreaterThanOrEqual(panel.y);
      expect(target.y + target.height).toBeLessThanOrEqual(panel.y + panel.height + 1);
    }
    await search.scrollIntoViewIfNeeded();
    await search.focus();
    if (width === 390 && height === 844 || width === 844) await workspace.capture(`${testInfo.project.name}-list-menu-${width}`);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(workspace.listOptionsButton()).toBeFocused();
    if (width >= 768 && width < 1024) {
      await expect(page.getByRole('dialog', { name: 'Sessions', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Sessions', exact: true })).toHaveCount(0);
    }
    await workspace.expectNoPageOverflow();
  }
  await workspace.route('/monitor');
  await expect(page.getByRole('heading', { name: 'Monitor', exact: true })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(workspace.listOptions().getByRole('textbox', { name: 'Search sessions', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(workspace.listOptions()).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(server.mutations).toEqual([]);
});
