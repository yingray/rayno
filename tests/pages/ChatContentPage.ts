import { expect, type Locator } from '@playwright/test';
import { LiveWorkspacePage } from './LiveWorkspacePage';

export class ChatContentPage extends LiveWorkspacePage {
  historyNotice() { return this.page.getByRole('alert', { name: 'Message history unavailable', exact: true }); }
  historyLoading() { return this.page.getByRole('status', { name: 'Load messages', exact: true }); }
  codeBlock(language: string) { return this.page.getByRole('figure', { name: `${language} code block`, exact: true }); }
  codeViewport(language: string) { return this.page.getByRole('region', { name: `${language} code`, exact: true }); }
  toolSummary() { return this.toolGroups().first().locator('summary'); }
  async expectSettingTiming() {
    await expect(this.page.getByRole('dialog').getByText(/The current response keeps its settings/)).toBeVisible();
  }
  async reach(control: Locator) {
    await this.conversation().dispatchEvent('touchmove');
    await control.scrollIntoViewIfNeeded();
    await control.evaluate(el => el.scrollIntoView({ block: 'center' }));
    const bounds = (await control.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(-1);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(this.page.viewportSize()!.width + 1);
    expect(bounds.y).toBeGreaterThanOrEqual(-1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(this.page.viewportSize()!.height + 1);
  }
  async activate(control: Locator, touch: boolean) {
    await this.reach(control);
    if (touch) await control.tap(); else await control.click();
  }
  async retryMessages(touch = false) {
    await this.activate(this.historyNotice().getByRole('button', { name: 'Retry messages', exact: true }), touch);
  }
  async inspectHistoryError(touch: boolean) {
    const notice = this.historyNotice();
    await this.activate(notice.locator('summary'), touch);
    await expect(notice.locator('pre')).toHaveText('Internal Server Error');
    await this.activate(notice.locator('summary'), touch);
    await expect(notice.locator('pre')).toBeHidden();
  }
  async copyCode(language: string, touch: boolean) {
    await this.activate(this.codeBlock(language).getByRole('button', { name: 'Copy code', exact: true }), touch);
  }
  async expectCodeScroll(language: string) {
    const viewport = this.codeViewport(language);
    await viewport.scrollIntoViewIfNeeded();
    await viewport.focus();
    await viewport.evaluate(el => { el.scrollLeft = 0; });
    await viewport.press('ArrowRight');
    await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    await this.expectNoPageOverflow();
  }
}
