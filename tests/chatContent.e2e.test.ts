import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { ChatContentPage } from './pages/ChatContentPage';

const phones = [[320, 740], [360, 800], [390, 844], [430, 932], [390, 360], [844, 390]];

test('message history should retain the draft and retry the failed page after a server error', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  server.historyFailure = true;
  const chat = new ChatContentPage(page);
  const touch = !!testInfo.project.use.hasTouch;
  await chat.route('/session/real-session');
  await expect(chat.historyNotice()).toContainText('Could not load messages');
  await expect(chat.connectionError()).toHaveCount(0);
  await expect(chat.historyNotice().locator('pre')).toBeHidden();
  await expect(page.getByText('The start of something good', { exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this unfinished draft');
  let release!: () => void;
  server.historyFailure = false;
  server.historyReady = new Promise<void>(resolve => { release = resolve; });
  // Act
  await chat.retryMessages(touch);
  // Assert
  await expect(chat.historyLoading()).toHaveText('Loading messages…');
  await expect(chat.historyNotice()).toHaveCount(0);
  await expect(page.getByText('The start of something good', { exact: true })).toHaveCount(0);
  // Act
  release();
  await expect(page.getByText('From the real protocol', { exact: true })).toBeVisible();
  server.historyFailure = true;
  await chat.loadEarlier();
  // Assert
  await expect(chat.historyNotice()).toContainText('Could not load earlier messages');
  await expect(chat.connectionError()).toHaveCount(0);
  await expect(page.getByText('From the real protocol', { exact: true })).toBeAttached();
  await chat.expectDraft('Keep this unfinished draft');
  // Act / Assert: retry controls and details remain usable at phone sizes and short heights.
  const sizes = touch ? phones : [[1440, 900]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await chat.inspectHistoryError(touch);
    await chat.retryMessages(touch);
    await expect(chat.historyNotice()).toBeVisible();
    await chat.expectDraft('Keep this unfinished draft');
    await chat.expectNoPageOverflow();
  }
  await chat.capture(`${testInfo.project.name}-history-retry`);
  server.historyFailure = false;
  const beforeRetry = server.requests.length;
  await chat.retryMessages(touch);
  // Assert
  await expect(chat.historyNotice()).toHaveCount(0);
  await expect(page.getByText('Earlier message', { exact: true })).toBeAttached();
  expect(server.requests.slice(beforeRetry).some(request => request.path.includes('before_seq=2'))).toBe(true);
  await chat.expectDraft('Keep this unfinished draft');
  expect(server.sends).toEqual([]);
  expect(server.mutations).toEqual([]);
});

test('code blocks should highlight known languages and preserve literal source when copied', async ({ page }, testInfo) => {
  // Arrange
  const source = 'export const greeting: string = "hello";\n// A literal <script>globalThis.codeExecuted = true</script>\nconst longValue = "' + 'readable source '.repeat(30) + '";';
  const literal = '<img src=x onerror="globalThis.codeExecuted = true">';
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  await server.setMessages([
    { role: 'user', content: { type: 'text', text: 'Show code examples' } },
    { role: 'session', content: { role: 'agent', ev: { t: 'text', text:
      'From the real protocol\n\n```typescript\n' + source + '\n```\n\n```json\n{"ready": true, "count": 2}\n```\n\n```bash\necho "hello"\n```\n\n```unknown\n' + literal + '\n```\n\n```\nplain source\n```',
    } } },
  ]);
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
    value: { writeText: async (text: string) => { (window as any).copiedCode = text; } },
  }));
  const chat = new ChatContentPage(page);
  const touch = !!testInfo.project.use.hasTouch;
  // Act
  await chat.openSession();
  await chat.codeViewport('typescript').scrollIntoViewIfNeeded();
  // Assert
  await expect(chat.codeViewport('typescript').locator('.hljs-keyword').first()).toHaveText('export');
  await expect(chat.codeViewport('typescript')).toHaveText(source + '\n');
  const colors = await chat.codeViewport('typescript').evaluate(el => ({
    keyword: getComputedStyle(el.querySelector('.hljs-keyword')!).color,
    string: getComputedStyle(el.querySelector('.hljs-string')!).color,
  }));
  expect(colors.keyword).not.toBe(colors.string);
  for (const language of ['json', 'bash']) {
    await chat.codeViewport(language).scrollIntoViewIfNeeded();
    await expect.poll(() => chat.codeViewport(language).locator('span').count()).toBeGreaterThan(0);
  }
  await expect(chat.codeViewport('unknown')).toHaveText(literal + '\n');
  await expect(chat.codeViewport('unknown').locator('img, script, span')).toHaveCount(0);
  await expect(chat.codeViewport('Plain text')).toHaveText('plain source\n');
  expect(await page.evaluate(() => (window as any).codeExecuted)).toBeUndefined();
  // Act / Assert
  const sizes = touch ? phones : [[1440, 900]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await chat.copyCode('typescript', touch);
    await expect.poll(() => page.evaluate(() => (window as any).copiedCode)).toBe(source + '\n');
    await chat.expectCodeScroll('typescript');
  }
  await chat.capture(`${testInfo.project.name}-syntax-highlight`);
  await chat.copyCode('unknown', touch);
  await expect.poll(() => page.evaluate(() => (window as any).copiedCode)).toBe(literal + '\n');
  expect(server.sends).toEqual([]);
});

test('tool summaries should use compact rows and retain touch and keyboard expansion without an arrow', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const chat = new ChatContentPage(page);
  await chat.openSession();
  await server.pushEvent({ role: 'session', content: { type: 'session', data: { role: 'agent', ev: {
    t: 'tool-call-start', call: 'read', name: 'Read', title: 'Read workspace', args: { file_path: 'README.md' },
  } } } });
  await server.pushEvent({ role: 'session', content: { type: 'session', data: { role: 'agent', ev: {
    t: 'tool-call-end', call: 'read', result: '# Example workspace',
  } } } });
  await chat.expandToolGroup(0);
  const summary = chat.toolSummary();
  const details = summary.locator('..');
  const touch = !!testInfo.project.use.hasTouch;
  // Act / Assert
  for (const [width, height] of touch ? phones : [[1440, 900]]) {
    await page.setViewportSize({ width, height });
    await summary.scrollIntoViewIfNeeded();
    const bounds = (await summary.boundingBox())!;
    if (touch) expect(bounds.height).toBeGreaterThanOrEqual(44);
    else expect(bounds.height).toBeLessThanOrEqual(32);
    const marker = await summary.evaluate(el => ({ display: getComputedStyle(el).display, style: getComputedStyle(el).listStyleType }));
    expect(marker).toEqual({ display: 'block', style: 'none' });
    if (touch) await summary.tap(); else await summary.click();
    await expect(details).toHaveAttribute('open', '');
    await expect(details.getByRole('heading', { name: 'Arguments', exact: true })).toBeVisible();
    await expect(details.locator('pre').first()).toContainText('README.md');
    await expect(details.locator('pre').first()).toBeVisible();
    await expect(details.locator('pre').last()).toHaveText('# Example workspace');
    await expect(details.locator('pre').last()).toBeVisible();
    await summary.focus();
    await summary.press('Enter');
    await expect(details).not.toHaveAttribute('open', '');
    await expect(details.locator('pre').first()).toBeHidden();
    await expect(details.locator('pre').last()).toBeHidden();
    await chat.expectNoPageOverflow();
  }
  await chat.capture(`${testInfo.project.name}-compact-tool-summary`);
});

test('model and permission picks should wait for the next message without interrupting a working agent', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.updateMetadata({ flavor: 'codex', models: undefined });
  await server.setWorking(true);
  const chat = new ChatContentPage(page);
  await chat.openSession();
  // Act
  await chat.openModelSettings();
  await chat.expectSettingTiming();
  await chat.chooseModel('GPT-6.1 Sol');
  await chat.chooseEffort('High');
  await chat.closeModelSettings();
  await chat.openPermissionSettings();
  await chat.expectSettingTiming();
  await chat.choosePermission('Read');
  // Assert
  expect(server.sends).toEqual([]);
  expect(server.mutations).toEqual([]);
  // Act
  await chat.send('Use the new settings for this instruction');
  await chat.expectDraft('');
  // Assert
  const raw = await server.encryption.decrypt<Record<string, unknown>>(server.sends[0].content, server.dataKey);
  expect(raw).toMatchObject({ meta: { model: 'gpt-6.1-sol', effort: 'high', permissionMode: 'read-only' } });
  expect(server.mutations.filter(method => method.endsWith(':abort'))).toEqual([]);
});
