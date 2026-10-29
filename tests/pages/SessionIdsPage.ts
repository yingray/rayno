import { expect } from '@playwright/test';
import { WorkspacePage } from './WorkspacePage';

export class SessionIdsPage extends WorkspacePage {
  happyId() { return this.page.getByRole('button', { name: 'Copy Happy session ID', exact: true }); }
  agentId() { return this.page.getByRole('button', { name: 'Copy agent session ID', exact: true }); }
  async stubClipboard(denied = false) {
    await this.page.addInitScript((denied) => Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => {
        if (denied) throw new DOMException('Clipboard access denied', 'NotAllowedError');
        (window as unknown as { copiedSessionId: string }).copiedSessionId = text;
      } },
    }), denied);
  }
  async openIds(id = 'real-session', demo = false) {
    await this.page.goto(`/session/${id}/info${demo ? '?demo=1' : ''}`);
    await expect(this.happyId()).toBeVisible();
  }
  async copyId(which: 'happy' | 'agent', expected: string, touch: boolean) {
    const button = which === 'happy' ? this.happyId() : this.agentId();
    await button.scrollIntoViewIfNeeded();
    await expect(button.locator('strong')).toHaveText(expected);
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await button.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
    if (touch) await button.tap();
    else await button.click();
    await expect.poll(() => this.page.evaluate(() => (window as unknown as { copiedSessionId?: string }).copiedSessionId)).toBe(expected);
    await this.expectNoPageOverflow();
  }
  async expectMissingId() {
    await this.agentId().scrollIntoViewIfNeeded();
    await expect(this.agentId()).toBeDisabled();
    await expect(this.agentId()).toContainText('Not reported');
    await this.expectNoPageOverflow();
  }
  async restoreOlderDemo() {
    await this.page.evaluate(() => {
      const key = 'rayno.demo.v1';
      const state = JSON.parse(localStorage.getItem(key)!);
      state.sessions = state.sessions.filter((session: { id: string }) => !session.id.startsWith('session-ids-'));
      state.drafts['paste-search-demo'] = 'Keep my draft';
      localStorage.setItem(key, JSON.stringify(state));
    });
    await this.openIds('session-ids-demo', true);
    expect(await this.page.evaluate(() => JSON.parse(localStorage.getItem('rayno.demo.v1')!).drafts['paste-search-demo'])).toBe('Keep my draft');
  }
}
