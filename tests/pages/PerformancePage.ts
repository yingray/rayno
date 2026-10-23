import { expect } from '@playwright/test';
import { LiveWorkspacePage } from './LiveWorkspacePage';

type Json = Record<string, any>;

export class PerformancePage extends LiveWorkspacePage {
  input() { return this.page.getByRole('textbox', { name: 'Message', exact: true }); }
  sendButton() { return this.page.getByRole('button', { name: 'Send message', exact: true }); }
  async watchSendFocus() {
    await this.input().evaluate((element) => {
      const events: string[] = [];
      (window as any).__sendFocus = events;
      element.addEventListener('blur', () => events.push('blur'), { once: true });
    });
    await this.sendButton().evaluate((element) => {
      element.addEventListener('click', () => {
        (window as any).__sendFocus.push(document.activeElement?.getAttribute('aria-label') === 'Message'
          ? 'click-focused' : 'click-blurred');
      }, { once: true });
    });
  }
  async expectKeyboardDismissedAfterClick() {
    await expect(this.input()).not.toBeFocused();
    expect(await this.page.evaluate(() => (window as any).__sendFocus)).toEqual(['click-focused', 'blur']);
  }
  async expectSendReachable() {
    const button = this.sendButton();
    await expect(button).toBeInViewport();
    const target = (await button.boundingBox())!;
    const viewport = this.page.viewportSize()!;
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.x).toBeGreaterThanOrEqual(0);
    expect(target.y).toBeGreaterThanOrEqual(0);
    expect(target.x + target.width).toBeLessThanOrEqual(viewport.width);
    expect(target.y + target.height).toBeLessThanOrEqual(viewport.height);
    expect(await button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
  }
  async useLegacyTextareaSizing() {
    await this.page.addInitScript(() => {
      const supports = CSS.supports.bind(CSS);
      CSS.supports = ((property: string, value?: string) =>
        property === 'field-sizing' ? false : value === undefined ? supports(property) : supports(property, value)) as typeof CSS.supports;
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = 'textarea { field-sizing: fixed !important; }';
        document.head.append(style);
      });
    });
  }
  async watchInputSize() {
    await this.input().fill('a');
    await this.page.evaluate(() => new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await this.input().evaluate((element) => {
      const state = { changes: 0, height: element.getBoundingClientRect().height };
      new MutationObserver((records) => { state.changes += records.length; })
        .observe(element, { attributes: true, attributeFilter: ['style'] });
      (window as any).__inputSize = state;
    });
    await this.page.getByRole('region', { name: 'Chat session', exact: true }).evaluate((element) => {
      const state = { changes: 0 };
      new MutationObserver((records) => { state.changes += records.length; })
        .observe(element, { attributes: true, attributeFilter: ['style'] });
      (window as any).__chatStyle = state;
    });
  }
  async expectNoChatStyleInvalidation() {
    expect(await this.page.evaluate(() => (window as any).__chatStyle.changes)).toBe(0);
  }
  async expectNoInputHeightReset() {
    const result = await this.input().evaluate((element) => ({
      ...(window as any).__inputSize, current: element.getBoundingClientRect().height,
    }));
    expect(result.changes).toBe(0);
    expect(result.current).toBe(result.height);
  }
  async startComposition(text: string) {
    await this.input().focus();
    await this.input().dispatchEvent('compositionstart', { data: '' });
    await this.input().evaluate((element: HTMLTextAreaElement, value) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value,
        inputType: 'insertCompositionText', isComposing: true }));
      element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter',
        code: 'Enter', keyCode: 13, isComposing: false }));
    }, text);
  }
  async finishComposition(text: string) {
    await this.input().dispatchEvent('compositionend', { data: text });
    await this.input().evaluate((element) => {
      element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter',
        code: 'Enter', keyCode: 229, isComposing: false }));
    });
  }
  async expectGrowingDraftUsable() {
    const small = (await this.input().boundingBox())!.height;
    await this.input().fill(Array.from({ length: 18 }, (_, index) =>
      `第 ${index + 1} 行：保留中文草稿與游標位置。`).join('\n'));
    await expect.poll(async () => (await this.input().boundingBox())!.height).toBeGreaterThan(small);
    const bounds = (await this.input().boundingBox())!;
    expect(bounds.height).toBeLessThanOrEqual(this.page.viewportSize()!.height * 0.4 + 1);
    const send = this.page.getByRole('button', { name: 'Send message', exact: true });
    await expect(send).toBeInViewport();
    if (this.page.viewportSize()!.width < 768) {
      const target = (await send.boundingBox())!;
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(Number.parseFloat(await this.input().evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    }
    await this.input().evaluate((element: HTMLTextAreaElement) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await this.input().evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await this.input().fill('縮短後仍可編輯');
    await expect.poll(async () => (await this.input().boundingBox())!.height).toBe(small);
    await this.expectNoPageOverflow();
  }
  messages() { return this.page.getByRole('region', { name: 'Conversation messages', exact: true }); }
  async typeDraft(text: string) {
    await this.page.getByRole('textbox', { name: 'Message', exact: true }).pressSequentially(text);
    await this.expectDraft(text);
  }
  async watchExistingMarkdown() {
    await this.messages().locator('article a').first().waitFor({ state: 'attached' });
    await this.messages().locator('article').evaluateAll((articles) => {
      const first = articles.find((article) => article.querySelector('a'))!;
      const state = { article: first, link: first.querySelector('a'), changes: 0 };
      new MutationObserver((records) => { state.changes += records.length; })
        .observe(first, { childList: true, subtree: true, characterData: true });
      (window as any).__existingMarkdown = state;
    });
  }
  async expectExistingMarkdownUntouched() {
    const result = await this.page.evaluate(() => {
      const state = (window as any).__existingMarkdown;
      return { changes: state.changes, connected: state.article.isConnected,
        sameLink: state.article.querySelector('a') === state.link };
    });
    expect(result).toEqual({ changes: 0, connected: true, sameLink: true });
  }
  async expectLazyScreensAbsent() {
    const assets = await this.loadedAssets();
    expect(assets.filter((name) => /\/(Monitor|Settings|NewSession|WorkspaceFiles|NewSessionPickers)-/.test(name))).toEqual([]);
  }
  async loadedAssets(): Promise<string[]> {
    return this.page.evaluate(() => performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname));
  }
  async openFiles() {
    await this.info();
    await this.page.getByRole('button', { name: /^View changes/ }).click();
    await expect(this.page.getByRole('region', { name: 'Real workspace files', exact: true })).toBeVisible();
  }
  // Stage timings need `rayno.perf` before the client module loads. WebKit has no long task entries.
  async enableStageTiming() {
    await this.page.addInitScript(() => {
      localStorage.setItem('rayno.perf', '1');
      const tasks = { count: 0, total: 0, max: 0, supported: false };
      (window as any).__longTasks = tasks;
      if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return;
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            tasks.count++;
            tasks.total += entry.duration;
            tasks.max = Math.max(tasks.max, entry.duration);
          }
        }).observe({ type: 'longtask', buffered: true });
        tasks.supported = true;
      } catch { /* The sample reports no long task support. */ }
    });
  }
  async loadAllHistory() {
    const earlier = this.page.getByRole('button', { name: 'Load earlier messages' });
    while (await earlier.isVisible()) {
      await earlier.click();
      // Each page normalizes the whole loaded history again, so a late page can take more than 5 s on a busy host.
      await expect(earlier.or(this.page.getByText('Task 1: check the build', { exact: true }))).toBeVisible({ timeout: 30000 });
      await expect(this.page.getByRole('status', { name: 'Load messages', exact: true })).toHaveCount(0, { timeout: 30000 });
    }
  }
  async resetSample() {
    await this.page.evaluate(() => {
      (window as any).__raynoPerf.reset();
      Object.assign((window as any).__longTasks, { count: 0, total: 0, max: 0 });
    });
  }
  async sample(): Promise<{ stages: Record<string, { count: number; total: number; max: number; mean: number }>; longTasks: Json }> {
    return this.page.evaluate(() => ({ stages: (window as any).__raynoPerf.stats(), longTasks: { ...(window as any).__longTasks } }));
  }
  // Milliseconds from the latest disconnect mark to each recovery mark, or null when a mark did not come after it.
  async recoveryTimeline(): Promise<Record<string, number | null>> {
    return this.page.evaluate(() => {
      const at = (name: string) => performance.getEntriesByName('rayno:' + name, 'mark').at(-1)?.startTime;
      const start = at('transport-disconnected');
      return Object.fromEntries(['transport-connected', 'list-refreshed', 'active-chat-caught-up', 'first-rpc-ok'].map((name) => {
        const time = at(name);
        return [name, start === undefined || time === undefined || time < start ? null : Math.round(time - start)];
      }));
    });
  }
  async waitForRecovery() {
    await expect.poll(async () => (await this.recoveryTimeline())['active-chat-caught-up'], { timeout: 20000 }).not.toBeNull();
  }
  async expectDraftAfterReload(text: string) {
    await this.page.reload();
    await this.expectDraft(text);
  }
}
