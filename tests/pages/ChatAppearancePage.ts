import { expect } from '@playwright/test';
import type { ChatWidth } from '../../src/data/types';
import { ChatActionsPage } from './ChatActionsPage';

export class ChatAppearancePage extends ChatActionsPage {
  chat() { return this.page.getByRole('region', { name: 'Chat session', exact: true }); }
  input() { return this.chat().getByRole('textbox', { name: 'Message', exact: true }); }
  async expectWidth(value: ChatWidth) {
    await expect(this.chat()).toHaveAttribute('data-chat-width', value);
    await expect.poll(async () => this.chat().evaluate((element, width) => {
      const frame = element.getBoundingClientRect();
      const list = element.querySelector<HTMLElement>('[data-font-size]')!;
      const messages = list.getBoundingClientRect();
      const railSpace = parseFloat(getComputedStyle(list.parentElement!).paddingRight);
      const composer = element.querySelector('textarea')!.parentElement!.parentElement!.getBoundingClientRect();
      const max = width === 'full' ? Infinity : width === 'medium' ? 1120 : 880;
      const expected = Math.min(frame.width - (innerWidth < 768 ? 16 : 24), max);
      const expectedMessages = Math.min(frame.width - railSpace - (innerWidth < 768 ? 16 : 24), max);
      return Math.max(Math.abs(messages.width - expectedMessages), Math.abs(composer.width - expected),
        Math.abs(messages.left - frame.left - (frame.width - railSpace - messages.width) / 2),
        Math.abs(composer.left - frame.left - (frame.width - composer.width) / 2));
    }, value)).toBeLessThanOrEqual(1);
    await expect(this.chat().getByText(/^Happy ·|^Local demo ·|% week|% context/)).toHaveCount(0);
    await expect(this.chat().getByRole('button', { name: 'Toggle context token count' })).toHaveCount(0);
    const gap = await this.input().evaluate(input => {
      const composer = input.parentElement!, wrap = composer.parentElement!;
      return wrap.getBoundingClientRect().bottom - composer.getBoundingClientRect().bottom;
    });
    expect(gap).toBeLessThanOrEqual(1);
    await this.expectNoPageOverflow();
  }
  async expectWidthControlUsable() {
    await this.chatWidth().scrollIntoViewIfNeeded();
    await this.expectTouchTarget(this.chatWidth());
    await expect(this.chatWidth()).toHaveCSS('font-size', '16px');
    await this.chatWidth().focus();
    await expect(this.chatWidth()).toHaveCSS('outline-width', '1px');
    const box = (await this.chatWidth().boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(this.page.viewportSize()!.width);
    expect(box.y + box.height).toBeLessThanOrEqual(this.page.viewportSize()!.height);
    await expect(this.page.getByRole('switch', { name: 'Show usage', exact: true })).toHaveCount(0);
  }
}
