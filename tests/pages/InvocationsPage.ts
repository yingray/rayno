import { ToolResultsPage } from './ToolResultsPage';

export class InvocationsPage extends ToolResultsPage {
  command() { return this.page.locator('[data-invocation="command"]'); }
  skill() { return this.page.locator('[data-invocation="skill"]'); }
  userMessage(text: string) { return this.page.locator('article[data-role="user"]').filter({ hasText: text }); }
  async toggleSkill() {
    const summary = this.toolSummary('Skill · engineering-suite:review');
    await summary.scrollIntoViewIfNeeded();
    if (await this.page.evaluate(() => navigator.maxTouchPoints > 0)) await summary.tap();
    else await summary.click();
  }
}
