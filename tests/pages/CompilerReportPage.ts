import { expect } from '@playwright/test';
import { WorkspacePage } from './WorkspacePage';

export class CompilerReportPage extends WorkspacePage {
  comparison() { return this.page.getByRole('region', { name: 'Paired React render comparison', exact: true }); }
  async open() {
    await this.page.goto('/reports/react-compiler.html');
    await expect(this.page.getByRole('heading', { name: 'React Compiler performance report', exact: true })).toBeVisible();
  }
  async expectNoPageOverflow() {
    expect(await this.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }
  async expectReadable(width: number) {
    await expect(this.page.getByText('No consistent speedup established', { exact: true })).toBeVisible();
    const row = this.comparison().getByRole('row').filter({ hasText: 'Desktop Chromium' });
    await expect(row).toContainText('2.8 ms');
    await expect(row).toContainText('2.95 ms');
    await expect(row).toContainText('95% paired CI');
    await expect(this.page.getByText('Use Recovery key', { exact: true })).toHaveCount(0);
    await this.comparison().scrollIntoViewIfNeeded();
    if (width < 620) {
      expect(await this.comparison().evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    }
    await this.expectNoPageOverflow();
  }
  async activate(control: import('@playwright/test').Locator, touch: boolean) {
    await control.scrollIntoViewIfNeeded();
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    if (touch) await control.tap();
    else await control.click();
  }
  async expandSamples(touch: boolean) {
    await this.activate(this.page.getByText('Show input and option render CPU', { exact: true }), touch);
    const table = this.page.getByRole('region', { name: 'Paired input and option render comparison', exact: true });
    await expect(table).toBeVisible();
    if (this.page.viewportSize()!.width < 660)
      expect(await table.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
  }
  async downloadData(touch: boolean) {
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.activate(this.page.getByRole('link', { name: 'Download paired measurements and analysis', exact: true }), touch),
    ]);
    expect(download.suggestedFilename()).toBe('react-compiler-paired.json');
    expect(await download.failure()).toBeNull();
  }
}
