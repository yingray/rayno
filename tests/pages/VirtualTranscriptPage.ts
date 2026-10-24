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
  async readingMode(faster: boolean) {
    await this.page.goto('/settings/appearance');
    const toggle = this.page.getByRole('switch', { name: 'Faster long chats (preview)', exact: true });
    await toggle.scrollIntoViewIfNeeded();
    if (await toggle.getAttribute('aria-checked') !== String(faster)) await toggle.click();
    await this.openSession();
    await expect(this.transcript()).toHaveAttribute('data-transcript-mode', faster ? 'virtual' : 'full');
  }
  async showFull() { await this.readingMode(false); }
  async faster() { await this.readingMode(true); }
  async firstMessage() {
    await this.messages().dispatchEvent('touchmove');
    await this.messages().evaluate(element => { element.scrollTop = 0; });
    await expect(this.chat().getByText('Task 1: check the build', { exact: true })).toBeInViewport();
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
  async expectNoTranscriptTools() {
    await expect(this.tools()).toHaveCount(0);
    await expect(this.chat().getByRole('button', { name: 'Find in loaded messages', exact: true })).toHaveCount(0);
    await expect(this.chat().getByRole('button', { name: 'Show full transcript', exact: true })).toHaveCount(0);
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
