import { expect, type Locator } from '@playwright/test';
import { LiveWorkspacePage } from './LiveWorkspacePage';

export class ModelSelectionDemoPage extends LiveWorkspacePage {
  picker() { return this.page.getByRole('dialog', { name: 'Model & effort', exact: true }); }
  modelRadio(label: string) { return this.picker().getByRole('radiogroup', { name: 'Model', exact: true }).getByRole('radio', { name: label, exact: true }); }
  effortRadio(label: string) { return this.picker().getByRole('radiogroup', { name: 'Effort', exact: true }).getByRole('radio', { name: label, exact: true }); }
  async open() {
    await this.page.goto('/session/model-selection-demo?demo=1');
    await expect(this.page.getByRole('heading', { name: 'Try model and effort selection', exact: true })).toBeVisible();
  }
  async activate(control: Locator) {
    await control.scrollIntoViewIfNeeded();
    const box = (await control.boundingBox())!;
    const viewport = this.page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    const touch = await this.page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    if (touch) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await control.tap();
    } else await control.click();
  }
  async openModelSettings() {
    await this.activate(this.page.getByRole('button', { name: 'Model and effort', exact: true }));
    await expect(this.picker()).toBeVisible();
  }
  async chooseModel(label: string) { await this.activate(this.modelRadio(label)); }
  async chooseEffort(label: string) { await this.activate(this.effortRadio(label)); }
  async expectSelection(model: string, effort: string) {
    await expect(this.modelRadio(model)).toBeChecked();
    await expect(this.effortRadio(effort)).toBeChecked();
  }
  async closeModelSettings() {
    await this.activate(this.picker().getByRole('button', { name: 'Done', exact: true }));
    await expect(this.picker()).toBeHidden();
  }
  async sendExample() {
    const input = this.page.getByRole('textbox', { name: 'Message', exact: true });
    if (this.page.viewportSize()!.width < 768 || await this.page.evaluate(() => matchMedia('(pointer: coarse)').matches))
      expect(await input.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    await input.fill('Try this model and effort');
    await this.activate(this.page.getByRole('button', { name: 'Send message', exact: true }));
    await expect(input).toHaveValue('');
    await expect(this.page.getByRole('button', { name: 'Stop response', exact: true })).toBeHidden({ timeout: 10000 });
    await expect(this.page.getByText('simulated response', { exact: false })).toBeVisible();
  }
}
