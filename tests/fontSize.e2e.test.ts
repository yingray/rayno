import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { WorkspacePage } from './pages/WorkspacePage';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rayno.v2.mode', 'demo'));
});

const fontSizeControl = (page: Page) => page.getByRole('group', { name: 'Font size', exact: true });
const chooseFontSize = (page: Page, label: string) =>
  fontSizeControl(page).getByRole('button', { name: label, exact: true }).click();
const messageText = async (page: Page) => page
  .getByRole('region', { name: 'Conversation messages', exact: true })
  .locator('article')
  .first()
  .evaluate((article) => {
    const text = article.firstElementChild!;
    const style = getComputedStyle(text);
    return { size: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight) };
  });

test('the font size setting should scale chat message text and survive a reload', async ({ page }, testInfo) => {
  // Arrange
  const workspace = new WorkspacePage(page);
  await workspace.route('/session/floating-panels');
  const medium = await messageText(page);
  await workspace.route('/settings/appearance');
  await expect(fontSizeControl(page).getByRole('button', { name: 'Medium', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  // Act
  await chooseFontSize(page, 'Large');
  await workspace.route('/session/floating-panels');
  const large = await messageText(page);
  await page.reload();
  const reloaded = await messageText(page);
  await workspace.expectNoPageOverflow();
  await workspace.capture(`${testInfo.project.name}-chat-font-large`);
  await workspace.route('/settings/appearance');
  await chooseFontSize(page, 'Small');
  await workspace.route('/session/floating-panels');
  const small = await messageText(page);
  // Assert
  expect(large.size / medium.size).toBeCloseTo(1.15, 2);
  expect(large.lineHeight / medium.lineHeight).toBeCloseTo(1.15, 2);
  expect(reloaded).toEqual(large);
  expect(small.size / medium.size).toBeCloseTo(0.9, 2);
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
});

test('the font size control should fit and stay touchable at phone widths', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone layout check');
  // Arrange
  const workspace = new WorkspacePage(page);
  for (const viewport of [
    { width: 320, height: 640 }, { width: 360, height: 740 }, { width: 390, height: 844 },
    { width: 430, height: 932 }, { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    // Act
    await workspace.route('/settings/appearance');
    await page.evaluate(() => document.fonts.ready);
    const control = fontSizeControl(page);
    await control.scrollIntoViewIfNeeded();
    await control.getByRole('button', { name: 'Large', exact: true }).tap();
    // Assert
    await expect(control.getByRole('button', { name: 'Large', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    for (const label of ['Small', 'Medium', 'Large']) {
      const button = control.getByRole('button', { name: label, exact: true });
      const fits = await button.evaluate((element) => element.scrollWidth <= element.clientWidth);
      expect(fits, `${label} at ${viewport.width}px`).toBe(true);
      const hits = await button.evaluate((element) => {
        const frame = element.parentElement!.getBoundingClientRect();
        const target = element.getBoundingClientRect();
        const x = target.left + target.width / 2;
        return [frame.top + 1, frame.bottom - 1].map((y) => element.contains(document.elementFromPoint(x, y)));
      });
      expect(hits, `${label} touch edges at ${viewport.width}px`).toEqual([true, true]);
    }
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const title = page.getByText('Font size', { exact: true });
    expect(await title.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect((await title.boundingBox())!.height).toBeLessThan(24);
    await workspace.expectNoPageOverflow();
    await workspace.capture(`${testInfo.project.name}-font-size-${viewport.width}`);
  }
});
