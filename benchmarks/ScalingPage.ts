import { expect, type Page, type Locator } from '@playwright/test';

export class ScalingPage {
  constructor(readonly page: Page) {}
  async installCounters() {
    await this.page.addInitScript(() => {
      (window as any).__raynoScale = { selectors: 0, notifications: 0, newRenders: 0, listRenders: 0, groupMs: 0, groupVisits: 0 };
    });
  }
  async settle() {
    await this.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }
  async touchTarget(control: Locator) {
    return control.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const hit44 = [[x - 21, y], [x + 21, y], [x, y - 21], [x, y + 21], [x, y]]
        .every(([px, py]) => document.elementFromPoint(px, py)?.closest('button') === element);
      return { width: rect.width, height: rect.height, hit44 };
    });
  }
  async openSession() {
    await this.page.goto('/session/real-session');
    await this.page.waitForFunction(() => document.querySelector('[aria-label="Conversation messages"] article[data-message-id]'));
    await this.settle();
  }
  async loadHistory() {
    // Poll the small history control in-page. A whole-page text locator distorts this measurement.
    return this.page.evaluate(async () => {
      const now = performance.now();
      let pages = 0;
      const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      await (window as any).__raynoHistory;
      await frame();
      for (;;) {
        const button = document.querySelector<HTMLButtonElement>('button[class*="historyEarlier"]');
        if (!button) break;
        const previous = (window as any).__raynoHistory;
        button.click();
        do { await frame(); } while ((window as any).__raynoHistory === previous);
        await (window as any).__raynoHistory;
        await frame();
        pages++;
        if (pages % 25 === 0) console.log('Loaded history pages:', pages);
        if (pages > 150) throw new Error('History did not finish.');
      }
      await frame(); await frame();
      return { ms: performance.now() - now, pages };
    });
  }
  async armReply(text: string) {
    await this.page.evaluate(text => {
      const root = document.querySelector('[aria-label="Conversation messages"]')!;
      const start = performance.now();
      (window as any).__replyPaint = null;
      const observer = new MutationObserver(() => {
        const tail = root.querySelector('article[data-message-id]:last-of-type');
        if (!tail?.textContent?.includes(text)) return;
        observer.disconnect();
        // Two rAF callbacks bracket a rendering opportunity; this is not a physical display timestamp.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          (window as any).__replyPaint = performance.now() - start;
        }));
      });
      observer.observe(root, { childList: true, subtree: true, characterData: true });
    }, text);
  }
  async replySample() {
    await this.page.waitForFunction(() => (window as any).__replyPaint !== null);
    return this.page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[aria-label="Conversation messages"]')!;
      return { ms: (window as any).__replyPaint as number, nodes: root.querySelectorAll('*').length,
        bottomGap: root.scrollHeight - root.clientHeight - root.scrollTop,
        replyPins: document.querySelectorAll('[data-response-rail] button').length };
    });
  }
  async groupProjects() {
    await this.page.getByRole('button', { name: 'Session list options', exact: true }).click();
    const projects = this.page.getByRole('button', { name: 'Projects', exact: true });
    const measure = () => projects.evaluate(button => new Promise<{ ms: number; filterMs: number; visits: number }>(resolve => {
      const counts = (window as any).__raynoScale;
      counts.groupMs = 0; counts.groupVisits = 0;
      const start = performance.now();
      (button as HTMLButtonElement).click();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({ ms: performance.now() - start,
        filterMs: counts.groupMs, visits: counts.groupVisits })));
    }));
    const samples = [await measure()];
    for (let i = 0; i < 4; i++) {
      await this.page.getByRole('button', { name: 'Flat', exact: true }).click();
      await this.settle();
      samples.push(await measure());
    }
    return samples;
  }
  async typeNewDraft() {
    await this.page.goto('/new');
    const input = this.page.getByRole('textbox', { name: 'Task description', exact: true });
    await expect(input).toBeVisible();
    await this.settle();
    return input.evaluate(async (input: HTMLTextAreaElement) => {
      const counts = (window as any).__raynoScale;
      Object.keys(counts).forEach(key => counts[key] = 0);
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      input.focus();
      const samples: number[] = [];
      for (const char of 'measure draft input') {
        const start = performance.now();
        setter.call(input, input.value + char);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        samples.push(performance.now() - start);
      }
      return { samples, counts: { ...counts }, value: input.value };
    });
  }
  async fileSearch() {
    return this.page.evaluate(() => {
      const { parseRipgrepFiles, searchFiles } = (window as any).__raynoSearch;
      return [1000, 10000, 50000].map(size => {
        const source = Array.from({ length: size }, (_, i) => `src/project${i % 100}/module${i}/Component${i}.tsx`).join('\n');
        const start = performance.now();
        const files = parseRipgrepFiles(source);
        const parseMs = performance.now() - start;
        const searches = ['component', 'component49', 'zz-no-match', 'cpt', 'project99/'].map(query => {
          searchFiles(files, query);
          const samples = Array.from({ length: 7 }, () => {
            const start = performance.now();
            const result = searchFiles(files, query);
            return { ms: performance.now() - start, count: result.length };
          });
          return { query, samples };
        });
        return { size, indexed: files.length, parseMs, searches };
      });
    });
  }
}
