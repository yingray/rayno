import { expect, test } from '@playwright/test';
import { copyRequestDemoId, copyRequestDemoSamples } from '../src/data/copyRequestDemo';
import type { DemoState } from '../src/data/types';
import { HappyServer } from './fixtures/HappyServer';
import { CopyRequestPage } from './pages/CopyRequestPage';

const firstSample = 'Review **this change**.';

test('request demo should copy exact text and keep the draft on phones, short views, and landscape', async ({ page }, info) => {
  // Arrange
  const view = new CopyRequestPage(page);
  await view.stubClipboard();
  await view.openDemo();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('Keep my draft');
  // Act / Assert
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 360], [844, 390]]) {
    await page.setViewportSize({ width, height });
    if (height === 360) await input.focus();
    await view.copyRequest(firstSample, !!info.project.use.hasTouch);
    await view.expectCopyBelowRequest(firstSample);
    await expect.poll(() => view.copiedText()).toBe(copyRequestDemoSamples[0]);
    await expect(page.getByRole('status').filter({ hasText: 'Copied to clipboard' })).toBeVisible();
    await view.copyRequest(copyRequestDemoSamples[1], !!info.project.use.hasTouch);
    await expect.poll(() => view.copiedText()).toBe(copyRequestDemoSamples[1]);
    await expect(input).toHaveValue('Keep my draft');
    await view.expectNoPageOverflow();
  }
});

test('an older demo account should find the request example and keep its saved draft', async ({ page }, info) => {
  // Arrange
  await page.addInitScript(() => {
    if (!localStorage.getItem('rayno.demo.v1')) localStorage.setItem('rayno.demo.v1', JSON.stringify({
      version: 1, sessions: [], preferences: {}, drafts: { untouched: 'Keep this old draft' }, newDraft: {}, recentPaths: [],
    }));
  });
  const view = new CopyRequestPage(page);
  await view.stubClipboard();
  // Act / Assert
  await view.openDemo();
  await page.goto('/sessions?demo=1');
  await view.searchSessions('Copy a request');
  await view.openRow('Copy a request · Interactive demo');
  await view.copyRequest(firstSample, !!info.project.use.hasTouch);
  await expect.poll(() => view.copiedText()).toBe(copyRequestDemoSamples[0]);
  await page.evaluate((id) => {
    const saved: DemoState = JSON.parse(localStorage.getItem('rayno.demo.v1')!);
    saved.sessions.find(session => session.id === id)!.messages[0].content = 'Select **Copy request** beside either sample.';
    localStorage.setItem('rayno.demo.v1', JSON.stringify(saved));
  }, copyRequestDemoId);
  await page.reload();
  await expect(page.getByText('below either sample.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rayno.demo.v1')!).drafts.untouched)).toBe('Keep this old draft');
});

test('request copy should use the user-visible text and omit the action for an attachment-only message', async ({ page }, info) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const prompt = 'Keep the spacing.\n\n  Indented line\n保留中文。';
  const command = '<command-message>review</command-message>\n<command-name>/review</command-name>'
    + '\n<command-args>--scope frontend</command-args>\nKeep this follow-up.';
  await server.setMessages([
    { role: 'user', content: { type: 'text', text: prompt } },
    { role: 'user', content: { type: 'text', text: command } },
    { role: 'session', content: { role: 'user', turn: 'file-turn', ev: { t: 'file', name: 'example.png', size: 100, mimeType: 'image/png' } } },
    { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'From the real protocol' } } },
  ]);
  const view = new CopyRequestPage(page);
  await view.stubClipboard();
  await view.openSession();
  await view.loadEarlier();
  // Act / Assert
  await view.copyRequest('Keep the spacing.', !!info.project.use.hasTouch);
  await expect.poll(() => view.copiedText()).toBe(prompt);
  const button = view.copyRequestButton('Keep this follow-up.');
  await button.scrollIntoViewIfNeeded();
  await button.focus();
  await button.press('Enter');
  await expect.poll(() => view.copiedText()).toBe('/review --scope frontend\n\nKeep this follow-up.');
  await expect(view.request('example.png')).toBeVisible();
  await expect(view.copyRequestButton('example.png')).toHaveCount(0);
  expect(server.sends).toEqual([]);
});
