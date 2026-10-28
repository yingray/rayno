import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { WorkspaceLayoutPage } from './pages/WorkspaceLayoutPage';

for (const mode of ['live', 'demo']) {
  test(`session list should resize in both directions and save its width without changing drafts in ${mode} mode`, async ({ page, browserName }) => {
    // Arrange
    let server: HappyServer | undefined;
    if (mode === 'live') { server = new HappyServer(); await server.install(page); }
    const view = new WorkspaceLayoutPage(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(mode === 'live' ? '/session/real-session' : '/session/workspace-layout-demo?demo=1');
    const draft = view.mainChat().getByRole('textbox', { name: 'Message', exact: true });
    await draft.fill('Keep this draft while the list changes');
    await view.expectPanelWidth('sessions', 360);

    // Act / Assert
    await view.drag('sessions', 80, browserName);
    await view.expectPanelWidth('sessions', 440);
    await view.drag('sessions', -60, browserName);
    await view.expectPanelWidth('sessions', 380);
    await view.separator('sessions').press('ArrowLeft');
    await view.expectPanelWidth('sessions', 370);
    await view.separator('sessions').press('Shift+ArrowRight');
    await view.expectPanelWidth('sessions', 420);
    await view.toggleSessions(false);
    await expect(view.separator('sessions')).toBeHidden();
    await view.toggleSessions(true);
    await view.expectPanelWidth('sessions', 420);
    await expect(draft).toHaveValue('Keep this draft while the list changes');
    await page.reload();
    await view.expectPanelWidth('sessions', 420);
    await expect(draft).toHaveValue('Keep this draft while the list changes');
    await view.separator('sessions').press('Home');
    await view.expectPanelWidth('sessions', 280);
    if (mode === 'demo') await view.expectSessionsUsable();
    await view.expectMainUsable();
    await view.separator('sessions').press('End');
    await view.expectPanelWidth('sessions', 520);
    await view.expectMainUsable();
    await view.separator('sessions').dblclick();
    await view.expectPanelWidth('sessions', 360);
    await view.separator('sessions').press('ArrowRight');
    await view.separator('sessions').press('Enter');
    await view.expectPanelWidth('sessions', 360);
    if (server) { expect(server.sends).toEqual([]); expect(server.spawns).toEqual([]); expect(server.mutations).toEqual([]); }
  });
}

test('session list should keep both chat ratios usable and restore its preferred width after viewport changes', async ({ page, browserName }) => {
  // Arrange
  const view = new WorkspaceLayoutPage(page);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await view.openDemo(true);
  await view.mainChat().getByRole('textbox', { name: 'Message', exact: true }).fill('Keep the main draft');
  await view.sideChat().getByRole('textbox', { name: 'Message', exact: true }).fill('Keep the side draft');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  // Act / Assert
  for (const edge of ['Home', 'End']) {
    await view.separator('sessions').press(edge);
    await view.expectPanelWidth('sessions', edge === 'Home' ? 280 : 520);
    await view.expectSessionsUsable();
    for (const limit of ['Home', 'End']) {
      await view.separator('side').press(limit);
      await view.expectRatio(limit === 'Home' ? 0.3 : 0.7);
    }
  }
  await view.drag('sessions', -40, browserName);
  await view.expectPanelWidth('sessions', 480);
  await view.toggleSessions(false); await view.toggleSessions(true);
  await view.expectPanelWidth('sessions', 480);
  await expect(view.mainChat().getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep the main draft');
  await expect(view.sideChat().getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep the side draft');
  await page.setViewportSize({ width: 1280, height: 800 });
  await view.activate(page.getByRole('button', { name: 'Expand navigation', exact: true }));
  await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).toHaveCSS('width', '220px');
  for (const limit of ['Home', 'End']) {
    await view.separator('side').press(limit);
    await view.expectRatio(limit === 'Home' ? 0.3 : 0.7);
  }
  await page.goto('/session/workspace-layout-demo?demo=1');
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect.poll(() => view.panelWidth('sessions')).toBeLessThan(480);
  await view.expectMainUsable();
  await page.setViewportSize({ width: 1920, height: 1000 });
  await view.activate(page.getByRole('button', { name: 'Collapse navigation', exact: true }));
  await view.expectPanelWidth('sessions', 480);
  await view.resizeSessionsWithEscape();
  await view.expectPanelWidth('sessions', 480);
  await page.reload();
  await view.expectPanelWidth('sessions', 480);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/session/workspace-layout-demo/info?demo=1');
  await expect(view.separator('info')).toBeVisible();
  for (const edge of ['End', 'Home']) {
    await view.separator('sessions').press(edge);
    await view.separator('info').press('End');
    await view.expectMainUsable();
  }
  expect(errors).toEqual([]);
});

test('saved desktop list widths should preserve phone and landscape search, navigation, and touch controls', async ({ page }) => {
  test.setTimeout(60000);
  // Arrange
  await page.addInitScript(() => localStorage.setItem('rayno.demo.panelWidth.sessions', '520'));
  const view = new WorkspaceLayoutPage(page);

  // Act / Assert
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 932], [390, 360], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await view.openDemo();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(view.separator('sessions')).toHaveCount(0);
    const search = view.sessionSearch();
    await expect(search).toBeFocused();
    await search.fill('Workspace layout');
    await expect(view.sessionRow('Workspace layout · Interactive demo')).toBeVisible();
    for (const control of [view.sessionList().getByRole('button', { name: 'Projects', exact: true }),
      view.sessionList().getByRole('button', { name: 'Close session search', exact: true })]) {
      await view.expectInViewport(control); await view.expectTouchTarget(control);
    }
    await view.closeSessionSearch();
    await view.activate(view.sessionRow('Workspace layout · Interactive demo'));
    await expect(view.mainChat()).toBeVisible();
    await view.mainChat().getByRole('textbox', { name: 'Message', exact: true }).fill(`Draft at ${width}x${height}`);
    await view.expectInViewport(view.mainChat().getByRole('button', { name: 'Send message', exact: true }));
    await view.expectNoPageOverflow();
  }
  await page.setViewportSize({ width: 1920, height: 1000 });
  await view.expectPanelWidth('sessions', 520);
});
