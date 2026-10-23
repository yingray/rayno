import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { ResizablePanelsPage } from './pages/ResizablePanelsPage';
import { PANEL_WIDTHS, defaultPanelWidth, type PanelKind } from '../src/app/panelWidths';

async function setup(page: import('@playwright/test').Page) {
  const server = new HappyServer();
  await server.install(page);
  await server.addSession('side-1', { parentSessionId: 'real-session', isSideChat: true, claudeSessionId: 'side-provider' });
  await server.setMessages([{ role: 'session', content: { role: 'agent', turn: 'side-turn', ev: { t: 'text', text: 'Side answer' } } }], 'side-1');
  return { server, workspace: new ResizablePanelsPage(page) };
}

for (const kind of ['info', 'side'] as PanelKind[]) {
  test(`${kind} panel should resize with pointer and keyboard, retain drafts, save its width, and reset`, async ({ page, browserName }) => {
    const { workspace, server } = await setup(page);
    await page.setViewportSize({ width: 1920, height: 1000 });
    await workspace.openPanel(kind);
    const initial = defaultPanelWidth(kind, 1920);
    await workspace.expectPanelWidth(kind, initial);
    await workspace.mainChat().getByRole('textbox', { name: 'Message', exact: true }).fill('Keep the main draft');
    if (kind === 'side') await workspace.sideChat().getByRole('textbox', { name: 'Message', exact: true }).fill('Keep the side draft');
    await workspace.drag(kind, -80, browserName);
    await workspace.expectPanelWidth(kind, initial + 80);
    await workspace.separator(kind).focus();
    await workspace.separator(kind).press('ArrowRight');
    await workspace.expectPanelWidth(kind, initial + 70);
    await workspace.separator(kind).press('Home');
    await workspace.expectPanelWidth(kind, PANEL_WIDTHS[kind].min);
    if (kind === 'side') await workspace.expectComposerFits();
    await workspace.separator(kind).press('End');
    await workspace.expectPanelWidth(kind, PANEL_WIDTHS[kind].max);
    await workspace.expectMainUsable();
    await expect(workspace.mainChat().getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep the main draft');
    if (kind === 'side') await expect(workspace.sideChat().getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep the side draft');
    expect(server.sends).toHaveLength(0);
    await page.reload();
    await workspace.expectPanelWidth(kind, PANEL_WIDTHS[kind].max);
    await workspace.separator(kind).dblclick();
    await workspace.expectPanelWidth(kind, initial);
    await workspace.separator(kind).press('Shift+ArrowLeft');
    await workspace.expectPanelWidth(kind, initial + 50);
    await workspace.separator(kind).press('Enter');
    await workspace.expectPanelWidth(kind, initial);
    await workspace.expectMainUsable();
  });

  test(`${kind} panel should adapt its limit to viewport and navigation changes without overwriting the saved width`, async ({ page }) => {
    const { workspace } = await setup(page);
    await page.setViewportSize({ width: 1920, height: 1000 });
    await workspace.openPanel(kind);
    await workspace.separator(kind).focus(); await workspace.separator(kind).press('End');
    await page.setViewportSize({ width: 1280, height: 800 });
    await workspace.expectMainUsable();
    await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
    await expect.poll(async () => Number(await workspace.separator(kind).getAttribute('aria-valuemax'))).toBeLessThan(PANEL_WIDTHS[kind].max);
    await workspace.expectMainUsable();
    await page.setViewportSize({ width: 1920, height: 1000 });
    await workspace.expectPanelWidth(kind, PANEL_WIDTHS[kind].max);
    await workspace.expectMainUsable();
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(workspace.separator(kind)).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: kind === 'info' ? 'Session info' : 'Side chats', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1920, height: 1000 });
    await workspace.expectPanelWidth(kind, PANEL_WIDTHS[kind].max);
  });
}

test('Escape should cancel a resize without closing the panel or saving a partial width', async ({ page }) => {
  const { workspace } = await setup(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await workspace.openPanel('info');
  const box = (await workspace.separator('info').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x - 100, box.y + box.height / 2, { steps: 6 });
  await workspace.separator('info').press('Escape'); await page.mouse.up();
  await expect(page).toHaveURL(/\/session\/real-session\/info$/);
  await workspace.expectPanelWidth('info', 380);
  await page.reload();
  await workspace.expectPanelWidth('info', 380);
});

test('phone and tablet side chats and info should remain usable without a resize handle', async ({ page }) => {
  test.setTimeout(90000);
  const { workspace } = await setup(page);
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 900], [390, 360], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/session/real-session/info');
    await expect(page.getByRole('separator')).toHaveCount(0);
    const info = workspace.details();
    await info.getByRole('button', { name: /^Rename/ }).click();
    const name = info.getByRole('textbox', { name: 'Session name', exact: true });
    await name.fill('A draft name'); await name.focus();
    if (width < 768 || await page.evaluate(() => navigator.maxTouchPoints > 0)) await expect(name).toHaveCSS('font-size', '16px');
    await workspace.expectInViewport(info.getByRole('button', { name: 'Save name', exact: true }));
    await info.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.goto('/session/real-session/side');
    await expect(page.getByRole('separator')).toHaveCount(0);
    await workspace.expectUsableList();
    await workspace.row('Side chat 1').click();
    await expect(page).toHaveURL(/\/session\/side-1$/);
    await expect(page.getByText('Side answer', { exact: true })).toBeVisible();
    const input = page.getByRole('textbox', { name: 'Message', exact: true });
    await input.fill('Keep the side draft'); await input.focus();
    if (width < 768 || await page.evaluate(() => navigator.maxTouchPoints > 0)) await expect(input).toHaveCSS('font-size', '16px');
    await workspace.expectInViewport(page.getByRole('button', { name: 'Send message', exact: true }));
    await workspace.expectNoPageOverflow();
  }
});
