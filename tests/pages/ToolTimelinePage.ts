import { expect, type Locator } from '@playwright/test';
import { PriorityFeaturesPage } from './PriorityFeaturesPage';

export class ToolTimelinePage extends PriorityFeaturesPage {
  group() { return this.page.getByRole('region', { name: 'Tool activity', exact: true }).last(); }
  toggle() { return this.group().locator(':scope > button'); }
  controls() { return this.page.getByRole('region', { name: 'Timeline demo controls' }); }
  async activate(control: Locator) {
    await control.scrollIntoViewIfNeeded();
    await this.expectTouchTarget(control);
    if (await this.page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await control.tap();
    else await control.click();
  }
  async start() { await this.activate(this.controls().getByRole('button', { name: 'Start demo', exact: true })); }
  async next() { await this.activate(this.controls().getByRole('button', { name: 'Next step', exact: true })); }
  async expand() { if (await this.toggle().getAttribute('aria-expanded') !== 'true') await this.activate(this.toggle()); }
  async expectStep(step: number) {
    await expect(this.toggle()).toContainText(`Step ${step}`);
    await expect(this.group()).toHaveAttribute('data-active', 'true');
  }
}
