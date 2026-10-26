import { expect, type Page } from '@playwright/test';
import type { Kind, Sample } from './metrics';

export class CompilerPage {
  constructor(readonly page: Page) {}
  input() { return this.page.getByRole('textbox', { name: 'Message', exact: true }); }
  option() { return this.page.getByRole('group', { name: 'Reply options', exact: true }).getByRole('button', { name: 'Benchmark choice', exact: true }); }
  async open(enabled: boolean) {
    await this.page.goto(`/session/real-session?compiler=${enabled ? 'on' : 'off'}`);
    await expect(this.option()).toBeAttached();
    await this.page.waitForFunction(() => {
      const list = document.querySelector<HTMLElement>('[aria-label="Conversation messages"]');
      return list && list.scrollHeight - list.clientHeight - list.scrollTop < 4;
    });
    await this.settle();
    expect(await this.page.evaluate(() => window.__raynoCompilerBench.enabled)).toBe(enabled);
  }
  settle() { return this.page.evaluate(() => window.__raynoCompilerBench.settle()); }
  async arm(kind: Kind, label = '') {
    await this.page.evaluate(({ kind, label }) => window.__raynoCompilerBench.arm(kind, label), { kind, label });
  }
  async sample(): Promise<Sample> {
    await this.page.waitForFunction(() => window.__raynoCompilerBench.result(), undefined, { timeout: 15000, polling: 'raf' });
    const result = (await this.page.evaluate(() => window.__raynoCompilerBench.result()))!;
    expect(Number.isFinite(result.domMs)).toBe(true);
    expect(result.nextFrameMs).toBeGreaterThan(0);
    return result;
  }
  async prepareOptions() {
    await this.page.getByRole('region', { name: 'Conversation messages', exact: true }).dispatchEvent('touchmove');
    await this.option().evaluate(element => element.scrollIntoView({ block: 'center' }));
    await this.settle();
  }
  async choose(touch: boolean) {
    if (touch) await this.option().tap();
    else await this.option().click();
  }
  async prepareInput() {
    await this.input().fill('Stable draft ');
    await this.input().focus();
    await this.settle();
  }
}
