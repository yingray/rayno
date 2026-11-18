import { expect, type Locator } from '@playwright/test';
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
    await this.activateCopy(this.copyButton(text), touch);
  }
  protected async activateCopy(button: Locator, touch: boolean) {
    await expect(async () => {
      expect(await button.evaluate((element) => {
        element.scrollIntoView({ block: 'center', inline: 'nearest' });
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      })).toBe(true);
    }).toPass({ timeout: 5000 });
    if (touch) {
      await this.expectTouchTarget(button);
      await button.tap();
    } else await button.click();
  }
}
