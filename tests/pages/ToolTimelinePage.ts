import { expect, type Locator } from '@playwright/test';
import { PriorityFeaturesPage } from './PriorityFeaturesPage';

export class ToolTimelinePage extends PriorityFeaturesPage {
  group() { return this.page.getByRole('region', { name: 'Tool activity', exact: true }).last(); }
  toggle() { return this.group().locator(':scope > button'); }
  controls() { return this.page.getByRole('region', { name: 'Timeline demo controls' }); }
  async activate(control: Locator) {
    await control.scrollIntoViewIfNeeded();
    if (await this.page.evaluate(() => matchMedia('(max-width: 767px), (max-width: 1024px) and (max-height: 480px), (pointer: coarse)').matches)) {
      if (await control.evaluate(element => element.matches('[data-tool-activity] summary')))
        await this.expectToolLogTarget(control);
      else await this.expectTouchTarget(control);
    }
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
  async expectCompactLogs() {
    // The short Grep label fits on one line at every phone width.
    const row = this.group().locator('li').nth(1).locator('summary');
    const phone = await this.page.evaluate(() => matchMedia('(max-width: 767px), (max-width: 1024px) and (max-height: 480px), (pointer: coarse)').matches);
    expect((await row.boundingBox())!.height).toBeCloseTo(phone ? 24 : 22, 0);
  }
  async expectSingleLineTitle() {
    const title = this.toggle().locator('[title]').last();
    await expect(title).toContainText('sources/monitor/providers/claude/workspace/agentUsage.ts');
    const box = await title.evaluate(element => {
      const style = getComputedStyle(element);
      return { height: element.getBoundingClientRect().height, line: parseFloat(style.lineHeight),
        fullWidth: element.scrollWidth, width: element.clientWidth };
    });
    expect(box.height).toBeLessThanOrEqual(box.line + 1);
    if (this.page.viewportSize()!.width <= 430) expect(box.fullWidth).toBeGreaterThan(box.width);
  }
}
