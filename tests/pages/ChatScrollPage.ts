import { expect } from '@playwright/test';
import { LiveWorkspacePage } from './LiveWorkspacePage';

export class ChatScrollPage extends LiveWorkspacePage {
  async enableFasterChats() {
    await this.page.goto('/settings/appearance');
    const toggle = this.page.getByRole('switch', { name: 'Faster long chats (preview)', exact: true });
    if (await toggle.getAttribute('aria-checked') !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  }
  async scrollUpStep(delta: number, keyboard = false) {
    const before = (await this.conversationPosition()).top;
    const anchor = await this.readingRow();
    if (keyboard) {
      // Mobile WebKit has no wheel driver. Use its native keyboard scrolling instead.
      await this.conversation().evaluate(element => { element.tabIndex = -1; });
      await this.conversation().focus();
      await this.page.keyboard.press('ArrowUp');
      // The mobile driver sends the key but does not apply the browser's default scroll.
      await this.conversation().evaluate((element, top) => { element.scrollTop = top; }, before - delta);
    } else {
      await this.conversation().hover({ position: { x: 30, y: 150 } });
      await this.page.mouse.wheel(0, -delta);
    }
    await expect.poll(() => this.conversation().evaluate((element, id) => {
      const row = element.querySelector<HTMLElement>(`article[data-message-id="${CSS.escape(id)}"]`);
      const top = element.getBoundingClientRect().top + parseFloat(getComputedStyle(element).scrollPaddingTop);
      return row ? row.getBoundingClientRect().top - top : -Infinity;
    }, anchor.id)).toBeGreaterThan(anchor.inset + 1);
  }
  async expectNoDownwardPull(anchor: { id: string; inset: number }) {
    const positions = await this.conversation().evaluate((element, anchor) => new Promise<number[]>(resolve => {
      const positions: number[] = [];
      const sample = () => {
        const row = element.querySelector<HTMLElement>(`article[data-message-id="${CSS.escape(anchor.id)}"]`);
        const top = element.getBoundingClientRect().top + parseFloat(getComputedStyle(element).scrollPaddingTop);
        positions.push(row ? row.getBoundingClientRect().top - top : -Infinity);
        if (positions.length === 20) resolve(positions);
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }), anchor);
    // Virtual measurements can change scrollTop while the same content stays fixed.
    expect(Math.min(...positions)).toBeGreaterThanOrEqual(anchor.inset - 2);
  }
  async moveReadingPosition(userInput = false) {
    if (userInput) await this.conversation().dispatchEvent('touchmove');
    await this.conversation().evaluate(element => { element.scrollTop = element.scrollHeight * 0.45; });
    await expect.poll(async () => (await this.conversationPosition()).remaining).toBeGreaterThan(500);
    if (userInput) await expect(this.latestShortcut()).toBeVisible();
  }
  async readingRow() {
    return this.conversation().evaluate(element => {
      const top = element.getBoundingClientRect().top + parseFloat(getComputedStyle(element).scrollPaddingTop);
      const rows = [...element.querySelectorAll<HTMLElement>('article[data-message-id]')];
      const row = rows.find(row => row.getBoundingClientRect().bottom > top + 16) || rows.at(-1)!;
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
