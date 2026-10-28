import { expect } from '@playwright/test';
import { LiveWorkspacePage } from './LiveWorkspacePage';

export class ChatScrollPage extends LiveWorkspacePage {
  async openScrollDemo(faster = false) {
    await this.page.goto('/session/chat-scroll-demo?demo=1');
    await expect(this.page.getByRole('heading', { name: 'Try chat scrolling', exact: true })).toBeAttached();
    if (faster) {
      await this.enableFasterChats(true);
      await this.page.goto('/session/chat-scroll-demo?demo=1');
    }
    await expect(this.page.locator('[data-transcript-mode]')).toHaveAttribute('data-transcript-mode', faster ? 'virtual' : 'full');
    await expect.poll(async () => (await this.conversationPosition()).remaining).toBeLessThan(1);
  }
  async touchDownAtLatest() {
    // WebKit's driver has no swipe API. Inject touch coordinates to test the direction handler.
    await this.conversation().evaluate(element => {
      const fire = (type: string, y: number) => element.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), {
        touches: type === 'touchend' ? [] : [{ clientY: y }],
      }));
      fire('touchstart', 180); fire('touchmove', 140); fire('touchend', 140);
    });
    await expect(this.latestShortcut()).toHaveCount(0);
  }
  async tapConversation(touch: boolean) {
    if (touch) await this.conversation().tap({ position: { x: 20, y: 140 } });
    else await this.conversation().click({ position: { x: 20, y: 140 } });
    await expect(this.latestShortcut()).toHaveCount(0);
  }
  async expectLatestHidden() {
    await expect.poll(async () => (await this.conversationPosition()).remaining).toBeLessThan(2);
    await expect(this.latestShortcut()).toHaveCount(0);
  }
  async scrollBackToLatest(keyboard = false) {
    if (keyboard) {
      await this.conversation().focus();
      await this.page.keyboard.press('End');
      // The mobile WebKit driver sends the key without its default scroll.
      await this.conversation().evaluate(element => { element.scrollTop = element.scrollHeight; });
    } else {
      await this.conversation().hover({ position: { x: 30, y: 150 } });
      await this.page.mouse.wheel(0, 120);
    }
    await this.expectLatestHidden();
  }
  async expectSimulatedReplies(count: number) {
    await expect(this.page.getByText('simulated response', { exact: true })).toHaveCount(count);
  }
  async waitForSentMessage(text: string) {
    await expect(this.page.getByText(text, { exact: true })).toBeAttached();
    await this.waitForLatestLayout();
  }
  async waitForLatestLayout() {
    // Rows and viewport changes can need more than one measurement before the layout settles.
    await this.conversation().evaluate(element => new Promise<void>(resolve => {
      let previous = '', stable = 0;
      const sample = () => {
        const next = `${element.scrollTop}:${element.scrollHeight}:${element.clientHeight}:${element.clientWidth}`;
        stable = next === previous && element.scrollHeight - element.clientHeight - element.scrollTop < 1 ? stable + 1 : 0;
        previous = next;
        if (stable >= 4) resolve(); else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
  }
  async removeSavedScrollDemo() {
    await expect.poll(() => this.page.evaluate(() => !!localStorage.getItem('rayno.demo.v1'))).toBe(true);
    await this.page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('rayno.demo.v1')!);
      state.sessions = state.sessions.filter((session: { id: string }) => session.id !== 'chat-scroll-demo');
      state.drafts['reply-navigator-demo'] = 'Keep this draft';
      state.preferences.fontSize = 'large';
      localStorage.setItem('rayno.demo.v1', JSON.stringify(state));
    });
  }
  async expectSavedDemoPreserved() {
    await expect.poll(() => this.page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('rayno.demo.v1')!);
      return { draft: state.drafts['reply-navigator-demo'], font: state.preferences.fontSize,
        oldSession: state.sessions.some((session: { id: string }) => session.id === 'reply-navigator-demo'),
        demo: state.sessions.some((session: { id: string }) => session.id === 'chat-scroll-demo') };
    })).toEqual({ draft: 'Keep this draft', font: 'large', oldSession: true, demo: true });
  }
  async scrollDownAtLatest(keyboard = false) {
    await expect.poll(async () => (await this.conversationPosition()).remaining).toBeLessThan(1);
    if (keyboard) {
      await this.conversation().evaluate(element => { element.tabIndex = -1; });
      await this.conversation().focus();
      await this.page.keyboard.press('ArrowDown');
    } else {
      await this.conversation().hover({ position: { x: 30, y: 150 } });
      await this.page.mouse.wheel(0, 120);
    }
    // The gesture cannot move the scroll box. Sample frames to catch a stuck shortcut.
    const shown = await this.page.evaluate(() => new Promise<boolean>(resolve => {
      let frames = 0, shown = false;
      const sample = () => {
        shown ||= !!document.querySelector('button[aria-label="Scroll to latest messages"]');
        if (++frames === 12) resolve(shown);
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
    expect(shown).toBe(false);
  }
  async enableFasterChats(demo = false) {
    await this.page.goto(`/settings/appearance${demo ? '?demo=1' : ''}`);
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
