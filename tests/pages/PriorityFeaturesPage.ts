import { expect } from '@playwright/test';
import { LiveWorkspacePage } from './LiveWorkspacePage';

export class PriorityFeaturesPage extends LiveWorkspacePage {
  requests() { return this.page.getByLabel('Agent requests', { exact: true }); }
  async chooseQuestion(option: string, custom: string) {
    await this.requests().getByLabel(option, { exact: true }).check();
    const input = this.requests().getByRole('textbox');
    if (custom) await input.fill(custom);
    await expect(input).toHaveCSS('font-size', '16px');
    for (const button of await this.requests().getByRole('button').all()) await this.expectTouchTarget(button);
  }
  async submitQuestion() { await this.requests().getByRole('button', { name: /Submit|Send answers/ }).click(); }
  async allowForSession() { await this.requests().getByRole('button', { name: 'Allow for this session', exact: true }).click(); }
  async attachImage(newSession = false) {
    await this.page.getByLabel(newSession ? 'Choose new session images' : 'Choose chat images', { exact: true }).setInputFiles('tests/fixtures/pixel.png');
  }
  async openImage() {
    const open = this.page.getByRole('button', { name: 'Open image pixel.png', exact: true });
    await open.scrollIntoViewIfNeeded();
    await open.click();
    const dialog = this.page.getByRole('dialog', { name: 'pixel.png', exact: true });
    await expect(dialog.getByRole('img')).toBeVisible();
    await expect(dialog.getByRole('img')).toHaveJSProperty('naturalWidth', 1);
    await expect(dialog.getByRole('link', { name: 'Download image' })).toBeVisible();
    await this.expectTouchTarget(dialog.getByRole('button', { name: 'Close pixel.png' }));
    await dialog.getByRole('button', { name: 'Close pixel.png' }).click();
  }
  async resume() {
    const button = this.page.getByRole('button', { name: 'Resume session', exact: true });
    await button.scrollIntoViewIfNeeded();
    await this.expectTouchTarget(button);
    await button.click();
  }
  async expandTool(name: string) {
    const group = this.page.getByRole('region', { name: 'Tool activity' }).first();
    const toggle = group.getByRole('button', { name: /Tool activity|Worked for/ });
    await toggle.scrollIntoViewIfNeeded();
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    const summary = group.locator('summary').filter({ hasText: name });
    if (!await summary.evaluate(element => (element.parentElement as HTMLDetailsElement).open)) await summary.click();
    await this.expectTouchTarget(summary);
    return group;
  }
  async expectTouchTarget(control: import('@playwright/test').Locator) {
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
}
