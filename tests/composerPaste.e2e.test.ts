import { test, expect } from '@playwright/test';
import { ComposerPastePage } from './pages/ComposerPastePage';

for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 932], [390, 360], [844, 390]]) {
  test(`PNG paste demo should preview, remove, send, and search at ${width}x${height}`, async ({ page }) => {
    const demo = new ComposerPastePage(page);
    await page.setViewportSize({ width, height });
    await demo.openPasteDemo();

    await demo.exerciseImage();
    await demo.exerciseSessionSearch();
    await demo.exerciseNewSessionPaste();

    await demo.expectNoPageOverflow();
  });
}

test('paste demo should preserve older saved sessions, preferences, and drafts', async ({ page }) => {
  const demo = new ComposerPastePage(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('rayno.demo.v1')) localStorage.setItem('rayno.demo.v1', JSON.stringify({
      version: 1, sessions: [{ id: 'existing-demo', title: 'Keep this session', workspace: 'rayno', project: 'Rayno',
        path: '/demo/rayno', branch: 'main', machineId: 'mbp', agent: 'Claude', model: 'claude-opus-5',
        status: 'idle', unread: false, archived: false, createdAt: 1, updatedAt: 1, additions: 0, deletions: 0, messages: [] }],
      preferences: { chatWidth: 'standard' }, drafts: { untouched: 'Keep this draft' },
      newDraft: { prompt: 'Keep this task' }, recentPaths: [],
    }));
  });
  await page.goto('/sessions?demo=1');
  await expect(demo.sessionRow('PNG paste, search and Mermaid · Interactive demo')).toBeVisible();
  await demo.openPasteDemo();
  await page.reload();
  await expect(demo.message()).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rayno.demo.v1')!));
  expect(saved.sessions.find((session: { id: string }) => session.id === 'existing-demo')?.title).toBe('Keep this session');
  expect(saved.drafts.untouched).toBe('Keep this draft');
  expect(saved.newDraft.prompt).toBe('Keep this task');
  expect(saved.preferences.chatWidth).toBe('standard');
});

test('pasting images should enforce upload limits and leave plain text to the browser', async ({ page }) => {
  const demo = new ComposerPastePage(page);
  await demo.openPasteDemo();
  await demo.message().fill('Keep this draft');
  await demo.pasteImage(demo.message(), false, 10 * 1024 * 1024);
  await expect(page.getByText('Each image must be smaller than 10 MB.', { exact: true })).toBeVisible();
  await expect(demo.message()).toHaveValue('Keep this draft');
  expect(await demo.message().evaluate(element => {
    const data = new DataTransfer(); data.setData('text/plain', 'Plain text');
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data }); element.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
});

test('PNG from the browser clipboard should paste with the keyboard shortcut', async ({ page, browserName, context }) => {
  test.skip(browserName !== 'chromium', 'WebKit does not expose clipboard-write permission in Playwright.');
  const demo = new ComposerPastePage(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await demo.openPasteDemo();
  await demo.message().focus();
  await page.evaluate(async () => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='), c => c.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
  });
  await demo.message().press('ControlOrMeta+v');
  await expect(demo.mainChat().getByRole('button', { name: /^Remove .*\.png$/ })).toBeVisible();
});

test('pasted PNG should use the live encrypted upload flow', async ({ page }) => {
  const { HappyServer } = await import('./fixtures/HappyServer');
  const server = new HappyServer();
  await server.install(page);
  const demo = new ComposerPastePage(page);
  await demo.route('/session/real-session');
  await demo.expectConnected();

  await demo.pasteImage(demo.message(), true);
  await demo.activate(demo.mainChat().getByRole('button', { name: 'Send message', exact: true }));

  await expect.poll(() => server.uploadRequests.length).toBe(1);
  await expect.poll(() => server.sends.length).toBe(2);
  const file = await server.encryption.decrypt<Record<string, any>>(server.sends[0].content, server.dataKey);
  expect(file.content.data.ev).toMatchObject({ t: 'file', name: 'pasted.png' });
});
