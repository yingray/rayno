import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { RecapPage } from './RecapPage';

const audio = readFileSync(new URL('../fixtures/recap-tone.mp3', import.meta.url)).toString('base64');
export class CloudRecapPage extends RecapPage {
  requests: { text: string; language: string }[] = [];
  release: (() => void) | undefined;
  async stubRelay(mode: 'audio' | 'fail' | 'wait' = 'audio') {
    await this.page.addInitScript(() => {
      const OriginalAudio = window.Audio;
      Object.defineProperty(window, 'Audio', { configurable: true, value: function(src?: string) {
        const audio = new OriginalAudio(src);
        Object.assign(window, { recapAudio: audio });
        return audio;
      } });
    });
    await this.page.route('**/api/tts', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { recapTts: true } }); return;
      }
      const body = route.request().postDataJSON();
      this.requests.push(body);
      if (mode === 'wait') await new Promise<void>(resolve => { this.release = resolve; });
      if (mode === 'fail') await route.fulfill({ status: 502, json: { error: 'Speech unavailable' } });
      else await route.fulfill({ json: { audio, cues: [{ start: 0, end: 8, offset: 0, length: 2 }] } }).catch(() => {});
    });
  }
  async deferWorker() {
    await this.page.addInitScript(() => {
      const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      let start!: () => void;
      const ready = new Promise<void>(resolve => { start = resolve; });
      Object.assign(window, { startRecapWorker: start });
      navigator.serviceWorker.register = (...args) => ready.then(() => register(...args));
    });
  }
  async startWorker() {
    await this.page.evaluate(async () => {
      (window as unknown as { startRecapWorker: () => void }).startRecapWorker();
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => this.page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  }
  async finishAudio() {
    await this.page.evaluate(() => {
      const audio = (window as unknown as { recapAudio: HTMLAudioElement }).recapAudio;
      audio.currentTime = audio.duration - 0.03;
    });
    await expect(this.card().getByRole('button', { name: 'Play recap', exact: true })).toBeVisible();
  }
  async audioCacheEntries() {
    return this.page.evaluate(async () => {
      const cache = await caches.open('rayno-recap-audio-v1');
      const rows = await Promise.all((await cache.keys()).map(async request => {
        const response = await cache.match(request);
        return response ? { url: request.url, body: await response.text(), expires: Number(response.headers.get('X-Rayno-Expires')) } : null;
      }));
      return rows.filter((row): row is NonNullable<typeof row> => row !== null);
    });
  }
  async expireAudioCache() {
    await this.page.evaluate(async () => {
      const cache = await caches.open('rayno-recap-audio-v1');
      for (const request of await cache.keys()) {
        const response = (await cache.match(request))!;
        const headers = new Headers(response.headers); headers.set('X-Rayno-Expires', String(Date.now() - 1));
        await cache.put(request, new Response(await response.text(), { headers }));
      }
    });
  }
  async audioState() {
    return this.page.evaluate(() => {
      const audio = (window as unknown as { recapAudio: HTMLAudioElement }).recapAudio;
      return { paused: audio.paused, time: audio.currentTime, rate: audio.playbackRate, src: audio.getAttribute('src'), duration: audio.duration };
    });
  }
  cancel() { return this.card().getByRole('button', { name: 'Cancel recap playback', exact: true }); }
  async expectCloudPlaying() {
    await expect(this.card().getByRole('button', { name: 'Pause recap', exact: true })).toBeVisible();
    await expect.poll(async () => (await this.audioState()).paused).toBe(false);
    await expect.poll(async () => (await this.audioState()).time).toBeGreaterThan(0);
  }
  async expectControlReachable(name: string) {
    const button = this.card().getByRole('button', { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    const touch = await this.page.evaluate(() => matchMedia('(max-width: 767px), (hover: none) and (pointer: coarse)').matches);
    await this.expectHitArea(button, touch ? 44 : 36);
    expect(await button.evaluate(element => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
  }
}
