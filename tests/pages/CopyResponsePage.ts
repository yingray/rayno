import { expect } from '@playwright/test';
import { PriorityFeaturesPage } from './PriorityFeaturesPage';

export class CopyResponsePage extends PriorityFeaturesPage {
  responses() { return this.page.locator('article[data-role="assistant"]'); }
  copyButton(text: string) {
    return this.responses().filter({ has: this.page.getByText(text, { exact: true }) })
      .getByRole('button', { name: 'Copy response', exact: true });
  }
  async stubClipboard(denied = false) {
    await this.page.addInitScript((denied) => Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => {
        if (denied) throw new DOMException('Clipboard access denied', 'NotAllowedError');
        (window as unknown as { copiedResponse: string }).copiedResponse = text;
      } },
    }), denied);
  }
  async copiedText() {
    return this.page.evaluate(() => (window as unknown as { copiedResponse?: string }).copiedResponse);
  }
  async copy(text: string, touch: boolean) {
    const button = this.copyButton(text);
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
    await this.expectTouchTarget(button);
    expect(await button.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
    if (touch) await button.tap();
    else await button.click();
  }
}
