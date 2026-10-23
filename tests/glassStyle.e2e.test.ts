import { expect, test, type Locator } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { ChatAppearancePage } from './pages/ChatAppearancePage';

class GlassStylePage extends ChatAppearancePage {
  glass() { return this.page.getByRole('combobox', { name: 'Glass style', exact: true }); }
  async activate(control: Locator) {
    await control.scrollIntoViewIfNeeded();
    if (await this.page.evaluate(() => navigator.maxTouchPoints > 0)) await control.tap();
    else await control.click();
  }
  async chooseGlass(value: 'standard' | 'intense') {
    await this.page.goto('/settings/appearance');
    await this.glass().selectOption(value);
    await expect(this.page.locator('html')).toHaveAttribute('data-glass-style', value);
  }
  frame() { return this.input().locator('xpath=ancestor::*[@data-focus-frame][1]'); }
  async expectFrosted() {
    const frame = this.frame();
    await expect.poll(() => frame.evaluate(element => {
      const css = getComputedStyle(element);
      return css.backdropFilter || css.getPropertyValue('-webkit-backdrop-filter');
    })).toContain('blur(28px)');
    await expect(frame).toHaveCSS('border-radius', '26px');
  }
}

for (const mode of ['live', 'demo']) test(`glass style should apply immediately, persist, and restore the original appearance in ${mode} mode`, async ({ page }) => {
  if (mode === 'live') { const server = new HappyServer(); await server.install(page); await server.setWorking(false); }
  else await page.addInitScript(() => localStorage.setItem('rayno.mode', 'demo'));
  const view = new GlassStylePage(page);
  const session = mode === 'live' ? 'real-session' : 'floating-panels';
  await page.goto('/settings/appearance');
  await expect(view.glass()).toHaveValue('standard');
  const original = await page.locator('body').evaluate(element => getComputedStyle(element).backgroundImage);
  await view.glass().selectOption('intense');
  await expect(page.locator('html')).toHaveAttribute('data-glass-style', 'intense');
  expect(await page.locator('body').evaluate(element => getComputedStyle(element).backgroundImage)).not.toBe(original);
  await page.reload();
  await expect(view.glass()).toHaveValue('intense');
  await page.goto(`/session/${session}`);
  await view.expectFrosted();
  await view.input().fill('Keep this draft while changing glass style');
  await view.chooseGlass('standard');
  await expect(page.locator('body')).toHaveCSS('background-image', original);
  await page.goto(`/session/${session}`);
  await expect(view.input()).toHaveValue('Keep this draft while changing glass style');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-glass-style', 'standard');
});

test('intense glass should keep settings, dialogs, headers, and sending usable at phone and landscape sizes', async ({ page }, info) => {
  const server = new HappyServer(); await server.install(page); await server.setWorking(false);
  const view = new GlassStylePage(page);
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 932], [390, 360], [844, 390], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await view.chooseGlass('intense');
    await view.glass().scrollIntoViewIfNeeded();
    await view.expectTouchTarget(view.glass());
    await expect(view.glass()).toHaveCSS('font-size', '16px');
    await view.glass().focus();
    await expect(view.glass()).toHaveCSS('outline-width', '1px');
    await view.expectNoPageOverflow();
    if (width === 320) await view.capture(`${info.project.name}-intense-glass-settings-320`);
    await page.goto('/session/real-session');
    await view.expectFrosted();
    await view.info(); await view.closeInfo();
    const model = page.getByRole('button', { name: 'Model and effort', exact: true });
    await view.activate(view.trigger());
    await expect(view.menu()).toBeVisible();
    const menuBackground = await view.menu().evaluate(element => getComputedStyle(element).backgroundImage);
    await expect.poll(() => view.menu().evaluate(element => getComputedStyle(element).backdropFilter)).toContain('blur(28px)');
    await view.activate(view.trigger());
    await expect(view.menu()).toHaveCount(0);
    await view.activate(model);
    const dialog = page.getByRole('dialog', { name: 'Model & effort', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('background-image', menuBackground);
    const close = dialog.getByRole('button', { name: 'Close Model & effort', exact: true });
    if (width < 768 || info.project.use.hasTouch) await view.expectTouchTarget(close);
    await view.activate(close);
    await expect(dialog).toHaveCount(0);
    await view.input().fill(`Readable glass at ${width}x${height}`);
    await view.input().focus();
    await expect(view.input()).toHaveCSS('outline-style', 'none');
    await expect(view.frame()).toHaveCSS('outline-width', '1px');
    const send = page.getByRole('button', { name: 'Send message', exact: true });
    if (width < 768 || info.project.use.hasTouch) await view.expectTouchTarget(send);
    await view.activate(send);
    await expect(view.input()).toHaveValue('');
    await view.expectNoPageOverflow();
    if (width === 390 || width === 1440) await view.capture(`${info.project.name}-intense-glass-chat-${width}-${height}`);
  }
  expect(server.sends).toHaveLength(7);
});
