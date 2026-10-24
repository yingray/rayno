import { expect } from '@playwright/test';
import { DemoImagesPage } from './DemoImagesPage';

export class PwaCachePage extends DemoImagesPage {
  async installShell() {
    await this.page.goto('/sessions');
    await expect(this.page.getByRole('heading', { name: 'Your agents, in a new space.', exact: true })).toBeVisible();
    await this.page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => this.page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  }
  async demoCacheEntries() {
    return this.page.evaluate(async () => {
      const entries: { cache: string; path: string; type: string | null; signature: number[] }[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const path = new URL(request.url).pathname;
          if (!/\/demo-chat-[\w-]+\.png$/.test(path)) continue;
          const response = (await cache.match(request))!;
          const bytes = new Uint8Array(await response.arrayBuffer());
          entries.push({ cache: name, path, type: response.headers.get('content-type'), signature: [...bytes.slice(0, 8)] });
        }
      }
      return entries;
    });
  }
  async tryUncachedOfflineImage() {
    const button = this.page.getByRole('button', { name: 'Load private image', exact: true });
    await button.scrollIntoViewIfNeeded();
    await this.activate(button);
    await expect(this.page.getByRole('alert')).toBeVisible();
    await expect(button).toBeEnabled();
    await expect(this.page.getByRole('button', { name: 'Open image private-demo.png', exact: true })).toHaveCount(0);
  }
}
