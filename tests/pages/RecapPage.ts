import { expect, type Locator } from '@playwright/test';
import { LiveWorkspacePage } from './LiveWorkspacePage';

type SpeechLog = { spoken: { text: string; lang: string; rate: number }[]; calls: string[] };

export class RecapPage extends LiveWorkspacePage {
  card() { return this.page.getByTestId('recap-card'); }
  rail() { return this.page.getByTestId('recap-rail'); }
  ghost() { return this.page.getByTestId('recap-ghost'); }
  pill() { return this.page.getByTestId('recap-pill'); }
  chevron(card = this.card()) { return card.getByRole('button', { name: /^(Show|Hide) recap details$/ }); }
  play(card = this.card()) { return card.getByRole('button', { name: /^(Play|Pause) recap$/ }); }
  phrase(text: string, card = this.card()) { return card.getByRole('button', { name: text, exact: true }); }
  composer() { return this.page.getByRole('textbox', { name: 'Message', exact: true }); }

  /** Replace the Web Speech API with a stub. The stub records each call and fires events on request. */
  async stubSpeech() {
    await this.page.addInitScript(() => {
      const log: SpeechLog = { spoken: [], calls: [] };
      let current: { onboundary?: (event: { charIndex: number }) => void; onend?: () => void } | null = null;
      class Utterance {
        lang = ''; rate = 1; voice: unknown = null;
        onboundary?: (event: { charIndex: number }) => void; onend?: () => void; onerror?: () => void;
        constructor(public text: string) {}
      }
      const synth = {
        paused: false,
        speaking: false,
        getVoices: () => [{ lang: 'en-US', name: 'English', default: true }, { lang: 'zh-TW', name: 'Chinese', default: false }],
        speak(utterance: Utterance) {
          current = utterance; this.speaking = true;
          log.spoken.push({ text: utterance.text, lang: utterance.lang, rate: utterance.rate });
          log.calls.push('speak');
        },
        cancel() { current = null; this.speaking = false; log.calls.push('cancel'); },
        pause() { this.paused = true; log.calls.push('pause'); },
        resume() { this.paused = false; log.calls.push('resume'); },
        addEventListener() {}, removeEventListener() {},
      };
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, writable: true, value: Utterance });
      Object.assign(window, {
        speechLog: log,
        speechBoundary: (charIndex: number) => current?.onboundary?.({ charIndex }),
        speechEnd: () => { const utterance = current; current = null; utterance?.onend?.(); },
      });
    });
  }
  async removeSpeech() {
    await this.page.addInitScript(() => {
      delete (window as { speechSynthesis?: unknown }).speechSynthesis;
      delete (window as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
    });
  }
  async speechLog(): Promise<SpeechLog> {
    return this.page.evaluate(() => (window as unknown as { speechLog: SpeechLog }).speechLog);
  }
  async boundary(charIndex: number) {
    await this.page.evaluate((index) => (window as unknown as { speechBoundary: (index: number) => void }).speechBoundary(index), charIndex);
  }
  async endSpeech() {
    await this.page.evaluate(() => (window as unknown as { speechEnd: () => void }).speechEnd());
  }
  async stubClipboard() {
    await this.page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async (text: string) => { (window as unknown as { copiedRecap: string }).copiedRecap = text; } },
    }));
  }
  async copiedText() {
    return this.page.evaluate(() => (window as unknown as { copiedRecap?: string }).copiedRecap);
  }
  /** Count calls to scrollIntoView. A recap jump must scroll the list container. */
  async watchScrollIntoView() {
    await this.page.addInitScript(() => {
      const original = Element.prototype.scrollIntoView;
      Object.assign(window, { scrollIntoViewCalls: 0 });
      Element.prototype.scrollIntoView = function (...args: Parameters<typeof original>) {
        if (this.closest('[data-recap-card], [data-recap-rail]') || this.matches('figure, p, li'))
          (window as unknown as { scrollIntoViewCalls: number }).scrollIntoViewCalls++;
        return original.apply(this, args);
      };
    });
  }
  async scrollIntoViewCalls() {
    return this.page.evaluate(() => (window as unknown as { scrollIntoViewCalls: number }).scrollIntoViewCalls);
  }

  async activate(control: Locator, touch: boolean) {
    if (touch) await control.tap(); else await control.click();
  }
  async expand(touch: boolean, card = this.card()) {
    await this.activate(card.getByRole('button', { name: 'Show recap details', exact: true }), touch);
    await expect(card).toHaveAttribute('data-state', 'open');
  }
  async scrollToLatest() {
    await this.conversation().evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(async () => (await this.conversationPosition()).remaining).toBeLessThan(2);
  }
  /** The element is inside the visible part of the list, below the header and above the composer. */
  async expectInView(target: Locator) {
    await expect.poll(async () => target.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const list = element.closest('[aria-label="Conversation messages"]')!.getBoundingClientRect();
      const header = document.querySelector('[aria-label="Chat session"] header')!.getBoundingClientRect();
      const composer = document.querySelector('[aria-label="Chat session"] [data-focus-frame]')!.getBoundingClientRect();
      return box.top >= Math.max(list.top, header.bottom) - 1 && box.top < Math.min(list.bottom, composer.top);
    })).toBe(true);
  }
  /** The composer does not cover any part of the card. */
  async expectCardClearOfComposer() {
    const card = (await this.card().boundingBox())!;
    const composer = (await this.page.getByRole('region', { name: 'Chat session', exact: true })
      .locator('[data-focus-frame]').boundingBox())!;
    expect(card.y + card.height).toBeLessThanOrEqual(composer.y + 1);
  }
  /** Scroll the list so the control sits between the overlay header and the floating composer. */
  async centerInList(control: Locator) {
    await control.evaluate((element) => {
      const list = element.closest<HTMLElement>('[aria-label="Conversation messages"]')!;
      const header = document.querySelector('[aria-label="Chat session"] header')!.getBoundingClientRect();
      const composer = document.querySelector('[aria-label="Chat session"] [data-focus-frame]')!.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      list.scrollTop += box.top + box.height / 2 - (header.bottom + composer.top) / 2;
    });
  }
  /** The control gets the pointer at each edge of a 44px square around its center. */
  async expectHitArea(control: Locator, size = 44) {
    await this.centerInList(control);
    await expect.poll(() => control.evaluate((element, size) => {
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2, y = box.top + box.height / 2, reach = size / 2 - 1;
      return [[x - reach, y], [x + reach, y], [x, y - reach], [x, y + reach], [x, y]]
        .filter(([px, py]) => document.elementFromPoint(px, py)?.closest('button') !== element)
        .map(([px, py]) => `${Math.round(px)},${Math.round(py)} ${document.elementFromPoint(px, py)?.tagName}`);
    }, size)).toEqual([]);
  }
  /** Each point at the edges of each phrase line leads to that phrase's own point, also near a pin hit area. */
  async expectPhrasesHitOwnPoint() {
    const misses = await this.card().evaluate((card) => {
      const header = document.querySelector('[aria-label="Chat session"] header')!.getBoundingClientRect();
      const composer = document.querySelector('[aria-label="Chat session"] [data-focus-frame]')!.getBoundingClientRect();
      const out: string[] = [];
      for (const phrase of card.querySelectorAll<HTMLElement>('button[data-point]:not([aria-label])')) {
        for (const rect of phrase.getClientRects()) {
          const xs = [rect.left + 2, rect.left + rect.width / 2, rect.right - 2];
          const ys = [rect.top + 2, rect.top + rect.height / 2, rect.bottom - 2];
          for (const x of xs) for (const y of ys) {
            if (y <= header.bottom || y >= composer.top) continue;
            const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-point]');
            if (hit?.dataset.point !== phrase.dataset.point)
              out.push(`point ${phrase.dataset.point} at ${Math.round(x)},${Math.round(y)} -> ${hit?.dataset.point ?? 'none'}`);
          }
        }
      }
      return out;
    });
    expect(misses).toEqual([]);
  }
  async expectCardReadable() {
    const card = this.card();
    const metrics = await card.evaluate((element) => {
      const chevron = element.querySelector('button[aria-controls]')!;
      const text = document.getElementById(chevron.getAttribute('aria-controls')!)!.firstElementChild as HTMLElement;
      const box = element.getBoundingClientRect();
      const frame = text.getBoundingClientRect();
      // Pseudo-element hit areas can extend past the text box. The visible text must not.
      const clipped = [...text.querySelectorAll('span, button')].filter((child) => {
        const rect = child.getBoundingClientRect();
        return rect.left < frame.left - 1 || rect.right > frame.right + 1;
      }).length;
      return { fontSize: parseFloat(getComputedStyle(text).fontSize), clipped, left: box.left, right: box.right };
    });
    expect(metrics.fontSize).toBeGreaterThanOrEqual(15);
    expect(metrics.clipped).toBe(0);
    expect(metrics.left).toBeGreaterThanOrEqual(0);
    expect(metrics.right).toBeLessThanOrEqual(this.page.viewportSize()!.width);
  }
  async expectNoHorizontalOverflow() {
    const overflow = await this.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const listOverflow = await this.conversation().evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(listOverflow).toBeLessThanOrEqual(0);
  }
}
