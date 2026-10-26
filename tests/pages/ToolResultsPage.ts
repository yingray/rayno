import { expect, type Locator } from '@playwright/test';
import { PriorityFeaturesPage } from './PriorityFeaturesPage';

const exact = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

export class ToolResultsPage extends PriorityFeaturesPage {
  toolGroup() { return this.page.getByRole('region', { name: 'Tool activity' }).first(); }
  answeredQuestions() { return this.toolGroup().getByRole('group', { name: 'Answered questions', exact: true }); }
  // The first summary span is the tool name. The decision badge follows it.
  private summaryOf(name: string) { return this.page.locator('summary').filter({ has: this.page.locator('span:first-child', { hasText: exact(name) }) }); }
  toolRow(name: string) { return this.toolGroup().locator('details').filter({ has: this.summaryOf(name) }); }
  toolSummary(name: string) { return this.toolRow(name).locator(':scope > summary'); }
  toolToggle() { return this.toolGroup().getByRole('button', { name: /Tool activity|Worked for/ }); }
  async collapseTools() {
    if (await this.toolToggle().getAttribute('aria-expanded') === 'true') await this.toolToggle().click();
  }
  async openTool(name: string): Promise<Locator> {
    await this.toolToggle().scrollIntoViewIfNeeded();
    if (await this.toolToggle().getAttribute('aria-expanded') === 'false') await this.toolToggle().click();
    const summary = this.toolSummary(name), row = this.toolRow(name);
    await summary.scrollIntoViewIfNeeded();
    if (!await row.evaluate((element) => (element as HTMLDetailsElement).open)) await summary.click();
    await expect(row).toHaveAttribute('open', '');
    if (await this.page.evaluate(() => matchMedia('(max-width: 767px), (hover: none) and (pointer: coarse)').matches))
      await this.expectToolLogTarget(summary);
    return row;
  }
  async expectDecision(name: string, label: string) {
    await expect(this.toolSummary(name)).toContainText(label);
  }
  async expectAnswer(question: string, answer: string) {
    const answers = this.answeredQuestions();
    await expect(answers).toBeVisible();
    await expect(answers.getByRole('term')).toContainText(question);
    await expect(answers.getByRole('definition')).toContainText(answer);
  }
}
