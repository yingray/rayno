import { expect } from '@playwright/test';
import { LiveWorkspacePage } from './LiveWorkspacePage';

export class ChatScrollPage extends LiveWorkspacePage {
  async moveReadingPosition(userInput = false) {
    if (userInput) await this.conversation().dispatchEvent('touchmove');
    await this.conversation().evaluate(element => { element.scrollTop = element.scrollHeight * 0.45; });
    await expect.poll(async () => (await this.conversationPosition()).remaining).toBeGreaterThan(500);
    if (userInput) await expect(this.latestShortcut()).toBeVisible();
  }
  async readingRow() {
    return this.conversation().evaluate(element => {
      const top = element.getBoundingClientRect().top + parseFloat(getComputedStyle(element).scrollPaddingTop);
      const row = [...element.querySelectorAll<HTMLElement>('[data-message-id]')]
        .find(row => row.getBoundingClientRect().bottom > top + 16)!;
      return { id: row.dataset.messageId!, inset: row.getBoundingClientRect().top - top };
    });
  }
  async expectReadingRow(anchor: { id: string; inset: number }) {
    await expect.poll(() => this.conversation().evaluate((element, anchor) => {
      const row = element.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(anchor.id)}"]`);
      const top = element.getBoundingClientRect().top + parseFloat(getComputedStyle(element).scrollPaddingTop);
      return row ? Math.abs(row.getBoundingClientRect().top - top - anchor.inset) : Infinity;
    }, anchor)).toBeLessThan(4);
  }
  async switchAwayAndBack() {
    await this.showSessions();
    await this.openRow('Older workspace');
    await expect(this.page.getByRole('button', { name: 'Open session info', exact: true }).first()).toContainText('Older workspace');
    await this.showSessions();
    await this.openRow();
  }
  async expectLatestReachable(touch: boolean) {
    await this.moveReadingPosition(true);
    const button = this.latestShortcut();
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    if (touch) expect(box.height).toBeGreaterThanOrEqual(44);
    if (touch) await button.tap(); else await button.click();
    await expect.poll(async () => (await this.conversationPosition()).remaining).toBeLessThan(4);
  }
}
