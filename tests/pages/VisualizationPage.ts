import { expect, type Locator } from '@playwright/test';
import { LiveWorkspacePage } from './LiveWorkspacePage';

export class VisualizationPage extends LiveWorkspacePage {
  openButton() { return this.page.getByRole('button', { name: 'Open visualization', exact: true }); }
  viewer() { return this.page.getByRole('dialog', { name: 'Codex cost vs. score', exact: true }); }
  plot(title = 'Coding Agent Index v2.1') { return this.viewer().getByRole('region', { name: title, exact: true }); }
  async openDemo() {
    await this.page.goto('/session/visualization-demo?demo=1');
    await expect(this.openButton()).toBeVisible();
  }
  async openChart() {
    await this.activate(this.openButton());
    await expect(this.viewer()).toBeVisible();
  }
  async closeChart() {
    await this.activate(this.viewer().getByRole('button', { name: 'Close Codex cost vs. score', exact: true }));
    await expect(this.viewer()).toBeHidden();
  }
  async choosePoint(index: number) {
    const select = this.plot().getByRole('combobox', { name: 'Data point', exact: true });
    await select.scrollIntoViewIfNeeded();
    await this.expectTouchControl(select);
    await select.selectOption(String(index));
  }
  async tapPoint(index: number) {
    const dot = this.plot().locator('circle').nth(index);
    await dot.scrollIntoViewIfNeeded();
    if (await this.touch()) await dot.tap();
    else await dot.click();
  }
  async expectValues(cost: string, score: string) {
    const values = this.plot().getByRole('status');
    await expect(values).toContainText('USD per task ' + cost);
    await expect(values).toContainText('Score ' + score);
    await values.scrollIntoViewIfNeeded();
    await expect(values).toBeInViewport();
  }
  async expectLayout() {
    const box = (await this.viewer().boundingBox())!;
    const viewport = this.page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(await this.viewer().evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    await this.expectNoPageOverflow();
  }
  private touch() { return this.page.evaluate(() => navigator.maxTouchPoints > 0); }
  private async expectTouchControl(control: Locator) {
    if (!await this.touch()) return;
    const box = (await control.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  private async activate(control: Locator) {
    await control.scrollIntoViewIfNeeded();
    await this.expectTouchControl(control);
    if (await this.touch()) await control.tap();
    else await control.click();
  }
}
