import { expect, type Locator } from '@playwright/test';
import { PerformancePage } from './PerformancePage';

export class VirtualTranscriptPage extends PerformancePage {
  embedded = false;
  chat() { return this.page.getByRole('region', { name: this.embedded ? 'Side chat conversation' : 'Chat session', exact: true }); }
  messages() { return this.chat().getByRole('region', { name: 'Conversation messages', exact: true }); }
  input() { return this.chat().getByRole('textbox', { name: 'Message', exact: true }); }
  sendButton() { return this.chat().getByRole('button', { name: 'Send message', exact: true }); }
  conversation() { return this.messages(); }
  latestShortcut() { return this.chat().getByRole('button', { name: 'Scroll to latest messages', exact: true }); }
  transcript() { return this.messages().locator('[data-transcript-mode]'); }
  tools() { return this.chat().getByRole('toolbar', { name: 'Transcript tools', exact: true }); }
  searchDialog() { return this.page.getByRole('dialog', { name: 'Find in loaded messages', exact: true }); }
  async openSession() {
    await this.page.goto('/session/real-session');
    await expect(this.input()).toBeVisible();
    await expect(this.transcript()).toBeAttached();
  }
  async enable() {
    await this.page.goto('/settings/appearance');
    const toggle = this.page.getByRole('switch', { name: 'Faster long chats (preview)', exact: true });
    await expect(toggle).toBeVisible();
    if (await toggle.getAttribute('aria-checked') !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  }
  async expectVirtual() {
    await expect(this.transcript()).toHaveAttribute('data-transcript-mode', 'virtual');
    await expect.poll(() => this.transcript().locator('[data-transcript-block]').count()).toBeLessThan(80);
    await expect.poll(async () => (await this.conversationPosition()).remaining).toBeLessThan(4);
  }
  async jumpReply(index: number) {
    const pin = this.page.getByRole('navigation', { name: 'Agent replies', exact: true })
      .getByRole('button', { name: `Jump to reply ${index}`, exact: true });
    await pin.scrollIntoViewIfNeeded();
    await pin.click();
  }
  async find(query: string) {
    await this.tools().getByRole('button', { name: 'Find in loaded messages', exact: true }).click();
    await this.searchDialog().getByRole('textbox', { name: 'Find text', exact: true }).fill(query);
    const region = this.searchDialog().getByRole('region', { name: 'Search results', exact: true });
    await expect(region).toHaveAttribute('aria-busy', 'false');
    const result = region.getByRole('button').first();
    await expect(result).toBeVisible();
    await expect(result).toBeEnabled();
    return result;
  }
  async chooseResult(query: string) {
    const result = await this.find(query);
    const id = await result.getAttribute('data-transcript-result');
    await result.click();
    await expect(this.searchDialog()).toHaveCount(0);
    await expect(this.transcript().locator(`[data-transcript-block="${id}"] [class*="flash"]`).first()).toBeAttached();
  }
  async showFull() {
    await this.tools().getByRole('button', { name: 'Show full transcript', exact: true }).click();
    await expect(this.transcript()).toHaveAttribute('data-transcript-mode', 'full');
  }
  async faster() {
    await this.tools().getByRole('button', { name: 'Use faster scrolling', exact: true }).click();
    await expect(this.transcript()).toHaveAttribute('data-transcript-mode', 'virtual');
  }
  async readingAnchor() {
    await this.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    return this.transcript().evaluate(root => {
      const scroll = root.closest<HTMLElement>('[aria-label="Conversation messages"]')!;
      const top = scroll.getBoundingClientRect().top + parseFloat(getComputedStyle(scroll).scrollPaddingTop);
      const row = [...root.querySelectorAll<HTMLElement>('[data-transcript-block]')]
        .find(row => row.getBoundingClientRect().bottom > top + 16 && row.getBoundingClientRect().top < scroll.getBoundingClientRect().bottom)!;
      return { id: row?.dataset.transcriptBlock, inset: row?.getBoundingClientRect().top - top };
    });
  }
  async expectAnchor(anchor: { id: string | undefined; inset: number }) {
    // Prepending can add another visible row above this anchor. Check this row's position.
    await expect.poll(() => this.transcript().evaluate((root, anchor) => {
      const row = root.querySelector<HTMLElement>(`[data-transcript-block="${CSS.escape(anchor.id || '')}"]`);
      const scroll = root.closest<HTMLElement>('[aria-label="Conversation messages"]')!;
      const top = scroll.getBoundingClientRect().top + parseFloat(getComputedStyle(scroll).scrollPaddingTop);
      return row ? Math.abs(row.getBoundingClientRect().top - top - anchor.inset) : Infinity;
    }, anchor)).toBeLessThan(4);
  }
  async expectToolbarFits() {
    const bounds = (await this.chat().boundingBox())!;
    for (const button of await this.tools().getByRole('button').all()) {
      await expect(button).toBeVisible();
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
  async expectTextClearOfTools(text: string) {
    const content = this.chat().getByText(text, { exact: true });
    await expect.poll(async () => {
      const box = await content.boundingBox(), toolbar = await this.tools().boundingBox();
      return box && toolbar ? box.y - toolbar.y - toolbar.height : -1;
    }).toBeGreaterThanOrEqual(0);
    await expect(content).toBeInViewport();
  }
  async tapControl(control: Locator) {
    await control.evaluate(element => {
      const chat = element.closest('[data-chat-session]')!;
      const scroll = element.closest<HTMLElement>('[aria-label="Conversation messages"]')!;
      const top = scroll.getBoundingClientRect().top + parseFloat(getComputedStyle(scroll).scrollPaddingTop);
      const composer = chat.querySelector('[data-focus-frame]')!.getBoundingClientRect();
      const latest = chat.querySelector('[class*="latestButton"]')?.getBoundingClientRect();
      const bottom = Math.min(composer.top, latest?.top ?? composer.top);
      const box = element.getBoundingClientRect();
      scroll.scrollTop += box.top + box.height / 2 - (top + bottom) / 2;
    });
    await expect.poll(() => control.evaluate(element => {
      const box = element.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
      return [[x - 21, y], [x + 21, y], [x, y - 21], [x, y + 21], [x, y]]
        .filter(([x, y]) => document.elementFromPoint(x, y)?.closest('button') !== element)
        .map(([x, y]) => `${Math.round(x)},${Math.round(y)} ${document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label')}`);
    })).toEqual([]);
    await control.tap();
  }
}
