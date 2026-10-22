import { expect, type Locator } from '@playwright/test';
import { PriorityFeaturesPage } from './PriorityFeaturesPage';

export class ToolResultsPage extends PriorityFeaturesPage {
  toolGroup() { return this.page.getByRole('region', { name: 'Tool activity' }).first(); }
  answeredQuestions() { return this.toolGroup().getByRole('group', { name: 'Answered questions', exact: true }); }
  toolRow(name: string) { return this.toolGroup().locator('details').filter({ has: this.page.locator('summary', { hasText: name }) }); }
  async collapseTools() {
    const toggle = this.toolGroup().getByRole('button', { name: /Tool activity|Worked for/ });
    if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
  }
  async openTool(name: string): Promise<Locator> {
    await this.expandTool(name);
    const row = this.toolRow(name);
    await row.locator('summary').scrollIntoViewIfNeeded();
    return row;
  }
  async expectDecision(name: string, label: string) {
    await expect(this.toolRow(name).locator('summary')).toContainText(label);
  }
  async expectAnswer(question: string, answer: string) {
    const answers = this.answeredQuestions();
    await expect(answers).toBeVisible();
    await expect(answers.getByRole('term')).toContainText(question);
    await expect(answers.getByRole('definition')).toContainText(answer);
  }
}
