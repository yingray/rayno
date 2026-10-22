import { test, expect } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { RecapPage } from './pages/RecapPage';

const RECAP_REQUEST = '[rayno] Recap your previous reply.';
const recapText = 'The merge kept the older session reading. A newer manual reading now wins, and 12 tests pass.';
const recapBlock = '<rayno-recap>\n<point quote="mergeAgentUsage keeps the session reading">The merge kept the older session reading</point>. '
  + '<point quote="if (manual.capturedAt > session.capturedAt)">A newer manual reading now wins</point>, and '
  + '<point quote="12 tests pass">12 tests pass</point>.\n</rayno-recap>';
const filler = Array.from({ length: 8 }, (_, index) =>
  `Paragraph ${index + 1} explains a detail of the usage merge and the monitor refresh in plain words for the reader.`).join('\n\n');
const body = [
  'From the real protocol',
  'The Codex row never moves because `mergeAgentUsage` keeps the session reading whenever both readings exist. The manual refresh is newer, but it is dropped.',
  filler,
  '```ts\nif (manual.capturedAt > session.capturedAt) {\n  return manual;\n}\n```',
  filler,
  '**Fixed** and added a test for a newer manual reading. 12 tests pass.',
].join('\n\n');
const reply = (text: string) => ({ role: 'agent', content: { type: 'codex', data: { type: 'message', message: text } } });
const conversation = (text: string) => [{ role: 'user', content: { type: 'text', text: 'Fix the week bar' } }, reply(text)];
const point2 = recapText.indexOf('A newer manual reading now wins');

test('recap card should render collapsed, expand, and keep the open state after a reload', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setMessages(conversation(body + '\n\n' + recapBlock));
  const recap = new RecapPage(page);
  const touch = !!testInfo.project.use.hasTouch;
  // Act
  await recap.openSession();
  // Assert
  await expect(recap.card()).toHaveCount(1);
  await expect(recap.card()).toHaveAttribute('data-state', 'closed');
  await expect(recap.card()).toContainText(recapText);
  await expect(recap.chevron()).toHaveAttribute('aria-expanded', 'false');
  await expect(recap.phrase('A newer manual reading now wins')).toHaveCount(0);
  await expect(page.getByText('<rayno-recap>')).toHaveCount(0);
  await expect(recap.ghost()).toHaveCount(0);
  if (testInfo.project.use.isMobile) {
    await expect(recap.rail()).toHaveCount(0);
    await expect(recap.pill()).toBeHidden();
  } else {
    await expect(recap.rail().getByRole('button')).toHaveText(['1', '2', '3']);
    await expect(recap.pill()).toBeEnabled();
  }
  // Act
  await recap.expand(touch);
  // Assert
  await expect(recap.chevron()).toHaveAttribute('aria-expanded', 'true');
  await expect(recap.card()).toContainText(`Auto after long replies · ${recapText.length} chars`);
  for (const phrase of ['The merge kept the older session reading', 'A newer manual reading now wins', '12 tests pass'])
    await expect(recap.phrase(phrase)).toBeVisible();
  await expect(recap.card().getByRole('button', { name: /^Jump to point \d$/ })).toHaveText(['1', '2', '3']);
  await expect(recap.card()).toContainText(testInfo.project.use.isMobile
    ? 'Tap a phrase to jump to that part of the reply'
    : 'Tap a phrase or a pin on the right to jump to that part of the reply');
  await page.reload();
  await expect(recap.card()).toHaveAttribute('data-state', 'open');
  await recap.capture(`${testInfo.project.name}-reply-recap`);
  await recap.expectNoHorizontalOverflow();
  expect(server.sends).toEqual([]);
});

test('recap jump should scroll the message list to the code block and flash it', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setMessages(conversation(body + '\n\n' + recapBlock));
  const recap = new RecapPage(page);
  await recap.watchScrollIntoView();
  const touch = !!testInfo.project.use.hasTouch;
  await recap.openSession();
  await recap.expand(touch);
  await recap.scrollToLatest();
  const code = page.locator('figure').filter({ hasText: 'manual.capturedAt > session.capturedAt' });
  const before = (await recap.conversationPosition()).top;
  // Act
  if (testInfo.project.use.isMobile) await recap.activate(recap.phrase('A newer manual reading now wins'), touch);
  else await recap.rail().getByRole('button', { name: 'Jump to point 2', exact: true }).click();
  // Assert
  await expect(code).toHaveClass(/flash/);
  await recap.expectInView(code);
  expect((await recap.conversationPosition()).top).toBeLessThan(before);
  expect(await recap.scrollIntoViewCalls()).toBe(0);
  await expect(recap.phrase('A newer manual reading now wins')).toHaveAttribute('data-active', 'true');
  if (!testInfo.project.use.isMobile)
    await expect(recap.rail().getByRole('button', { name: 'Jump to point 2', exact: true })).toHaveAttribute('data-active', 'true');
  await expect(code).not.toHaveClass(/flash/, { timeout: 3000 });
  // Act
  await recap.scrollToLatest();
  await recap.activate(recap.card().getByRole('button', { name: 'Jump to point 3', exact: true }), touch);
  // Assert
  const fixed = page.locator('article p').filter({ hasText: 'Fixed and added a test for a newer manual reading.' });
  await expect(fixed).toHaveClass(/flash/);
  await recap.expectInView(fixed);
  expect(await recap.scrollIntoViewCalls()).toBe(0);
});

test('recap voice should follow boundary events, pause, resume, and stop when the user types', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setMessages(conversation(body + '\n\n' + recapBlock));
  const recap = new RecapPage(page);
  await recap.stubSpeech();
  const touch = !!testInfo.project.use.hasTouch;
  const desktop = !testInfo.project.use.isMobile;
  await recap.openSession();
  await recap.expand(touch);
  // Act
  await recap.activate(recap.play(), touch);
  await recap.boundary(point2 + 3);
  // Assert
  await expect(recap.card().getByRole('button', { name: 'Pause recap', exact: true })).toBeVisible();
  expect((await recap.speechLog()).spoken).toEqual([{ text: recapText, lang: 'en', rate: 1 }]);
  await expect(recap.phrase('A newer manual reading now wins')).toHaveAttribute('data-active', 'true');
  await expect(recap.phrase('The merge kept the older session reading')).toHaveAttribute('data-active', 'false');
  await expect(recap.card().getByRole('button', { name: 'Jump to point 2', exact: true })).toHaveAttribute('data-active', 'true');
  if (desktop) {
    await expect(recap.rail().getByRole('button', { name: 'Jump to point 2', exact: true })).toHaveAttribute('data-active', 'true');
    await expect(recap.card().getByTestId('recap-time')).toHaveText(/^0:0\d \/ 0:0\d$/);
  } else {
    await expect(recap.card().getByTestId('recap-time')).toBeHidden();
  }
  // Act
  await recap.activate(recap.play(), touch);
  // Assert
  await expect(recap.card().getByRole('button', { name: 'Play recap', exact: true })).toBeVisible();
  expect((await recap.speechLog()).calls.at(-1)).toBe('pause');
  // Act
  await recap.activate(recap.play(), touch);
  await recap.activate(recap.card().getByRole('button', { name: 'Reading speed 1×', exact: true }), touch);
  // Assert
  expect((await recap.speechLog()).calls).toContain('resume');
  await expect(recap.card().getByRole('button', { name: 'Reading speed 1.25×', exact: true })).toBeVisible();
  await expect.poll(async () => (await recap.speechLog()).spoken.at(-1)?.rate).toBe(1.25);
  expect((await recap.speechLog()).spoken.at(-1)?.text).toBe(recapText.slice(point2 + 3));
  // Act
  await recap.endSpeech();
  // Assert
  await expect(recap.card().getByRole('button', { name: 'Play recap', exact: true })).toBeVisible();
  // Act
  await recap.composer().focus();
  await page.keyboard.press('Alt+KeyR');
  // Assert
  await expect(recap.card().getByRole('button', { name: 'Pause recap', exact: true })).toBeVisible();
  await recap.expectDraft('');
  // Act
  await page.keyboard.type('x');
  // Assert
  await expect(recap.card().getByRole('button', { name: 'Play recap', exact: true })).toBeVisible();
  await recap.expectDraft('x');
  expect((await recap.speechLog()).calls.at(-1)).toBe('cancel');
  expect(server.sends).toEqual([]);
});

test('recap time readout should hide when the voice sends no boundary events', async ({ page }, testInfo) => {
  test.skip(!!testInfo.project.use.isMobile, 'Phones do not show the time readout.');
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setMessages(conversation(body + '\n\n' + recapBlock));
  const recap = new RecapPage(page);
  await recap.stubSpeech();
  await recap.openSession();
  await expect(recap.card().getByTestId('recap-time')).toHaveText('0:00 / 0:07');
  // Act
  await recap.play().click();
  // Assert
  await expect(recap.card().getByTestId('recap-time')).toBeHidden({ timeout: 4000 });
  await expect(recap.card().getByRole('button', { name: 'Pause recap', exact: true })).toBeVisible();
});

test('recap card should hide voice controls without the Web Speech API and copy the plain text', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setMessages(conversation(body + '\n\n' + recapBlock));
  const recap = new RecapPage(page);
  await recap.removeSpeech();
  await recap.stubClipboard();
  const touch = !!testInfo.project.use.hasTouch;
  await recap.openSession();
  await expect(recap.card()).toBeVisible();
  await expect(recap.play()).toHaveCount(0);
  await expect(recap.card().getByTestId('recap-time')).toHaveCount(0);
  await recap.expand(touch);
  await expect(recap.card().getByRole('button', { name: /^Reading speed/ })).toHaveCount(0);
  // Act
  await recap.activate(recap.card().getByRole('button', { name: 'Copy recap', exact: true }), touch);
  // Assert
  await expect.poll(() => recap.copiedText()).toBe(recapText);
  await expect(page.getByRole('status').filter({ hasText: 'Copied to clipboard' })).toBeVisible();
  // Act
  await page.keyboard.press('Alt+KeyR');
  // Assert
  await expect(recap.composer()).toHaveValue('');
  expect(server.sends).toEqual([]);
});

test('recap followed by options should keep both parts and leave literal recap tags as text', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const labels = ['Ship it', 'Add a test first'];
  const options = '<options>\n' + labels.map((label) => `<option>${label}</option>`).join('\n') + '\n</options>';
  const literal = '<rayno-recap>\n<point quote="Code example">Literal recap</point>\n</rayno-recap>';
  await server.setMessages(conversation([body, '```xml\n' + literal + '\n```', recapBlock, options].join('\n\n')));
  const recap = new RecapPage(page);
  const touch = !!testInfo.project.use.hasTouch;
  await recap.openSession();
  await expect(recap.replyOptions().getByRole('button')).toHaveText(labels);
  await expect(recap.card()).toHaveCount(1);
  await expect(recap.codeExample('<point quote="Code example">Literal recap</point>')).toBeVisible();
  const order = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="recap-card"]')!;
    const options = document.querySelector('[aria-label="Reply options"]')!;
    return !!(card.compareDocumentPosition(options) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
  await recap.composer().fill('Keep my draft');
  // Act
  await recap.expectReplyTargetsReachable();
  if (touch) await recap.tapReply(labels[0]);
  else await recap.selectReply(labels[0]);
  // Assert
  await expect(recap.replyOptions().getByRole('button').nth(0)).toBeDisabled();
  await recap.expectDraft('Keep my draft');
  expect(server.sends).toHaveLength(1);
  const raw = await server.encryption.decrypt<{ content: { text: string }; meta: Record<string, unknown> }>(server.sends[0].content, server.dataKey);
  expect(raw).toMatchObject({ role: 'user', content: { type: 'text', text: labels[0] } });
  expect(raw.meta.raynoRecap).toBeUndefined();
  expect(raw.meta.appendSystemPrompt).toContain('<options>');
  expect(raw.meta.appendSystemPrompt).toContain('<rayno-recap>');
  expect(raw.meta.appendSystemPrompt).toContain('only when the main reply exceeds 1,000 visible characters');
  await expect(recap.card()).toHaveCount(1);
});

test('manual recap should hide the request, show the writing state, and attach the recap to the previous reply', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const labels = ['Ship it', 'Add a test first'];
  await server.setMessages(conversation(body + '\n\n<options>\n' + labels.map((label) => `<option>${label}</option>`).join('\n') + '\n</options>'));
  const recap = new RecapPage(page);
  const touch = !!testInfo.project.use.hasTouch;
  const desktop = !testInfo.project.use.isMobile;
  await recap.openSession();
  const replies = page.locator('article[data-message-id]:not([data-role="user"])');
  await expect(replies).toHaveCount(1);
  const target = await replies.first().getAttribute('data-message-id');
  const users = await page.locator('article[data-role="user"]').count();
  await expect(recap.card()).toHaveCount(0);
  await expect(recap.replyOptions().getByRole('button').nth(0)).toBeEnabled();
  if (desktop) await expect(recap.pill()).toBeEnabled();
  // Act
  await recap.ghost().scrollIntoViewIfNeeded();
  await recap.activate(recap.ghost(), touch);
  // Assert
  await expect(page.getByRole('status').filter({ hasText: 'Writing recap…' })).toBeVisible();
  await expect(recap.ghost()).toHaveCount(0);
  if (desktop) await expect(recap.pill()).toBeDisabled();
  await expect.poll(() => server.sends.length).toBe(1);
  const raw = await server.encryption.decrypt<{ content: { text: string }; meta: Record<string, unknown> }>(server.sends[0].content, server.dataKey);
  expect(raw).toMatchObject({ role: 'user', content: { type: 'text', text: RECAP_REQUEST } });
  expect(raw.meta).toMatchObject({ raynoRecap: true, displayText: 'Recap' });
  expect(raw.meta.appendSystemPrompt).toContain(`"${RECAP_REQUEST}"`);
  await expect(page.locator('article[data-role="user"]')).toHaveCount(users);
  await expect(page.getByText(RECAP_REQUEST)).toHaveCount(0);
  await expect(recap.replyOptions().getByRole('button').nth(0)).toBeEnabled();
  // Act
  await server.setWorking(true);
  await server.pushReply(recapBlock);
  await server.setWorking(false);
  // Assert
  await expect(recap.card()).toHaveAttribute('data-manual', 'true');
  await expect(recap.card()).toHaveAttribute('data-message-id', target!);
  await expect(replies).toHaveCount(1);
  await expect(page.getByRole('status').filter({ hasText: 'Writing recap…' })).toHaveCount(0);
  await expect(recap.ghost()).toHaveCount(0);
  await recap.expand(touch);
  await expect(recap.card()).toContainText(`Manual recap · ${recapText.length} chars`);
  // Act
  if (touch) await recap.tapReply(labels[1]);
  else await recap.selectReply(labels[1]);
  // Assert
  await expect.poll(() => server.sends.length).toBe(2);
  const choice = await server.encryption.decrypt(server.sends[1].content, server.dataKey);
  expect(choice).toMatchObject({ role: 'user', content: { type: 'text', text: labels[1] } });
  await expect(recap.card()).toHaveCount(1);
});

test('manual recap should work in demo mode and keep the draft', async ({ page }, testInfo) => {
  // Arrange
  await page.addInitScript(() => localStorage.setItem('rayno.mode', 'demo'));
  const recap = new RecapPage(page);
  const touch = !!testInfo.project.use.hasTouch;
  await page.goto('/session/floating-panels');
  await expect(recap.ghost()).toBeVisible();
  await recap.composer().fill('Keep my draft');
  const users = await page.locator('article[data-role="user"]').count();
  // Act
  if (testInfo.project.use.isMobile) await recap.activate(recap.ghost(), touch);
  else await recap.pill().click();
  // Assert
  await expect(page.getByRole('status').filter({ hasText: 'Writing recap…' })).toBeVisible();
  await expect(recap.card()).toHaveAttribute('data-manual', 'true', { timeout: 5000 });
  await expect(page.getByRole('status').filter({ hasText: 'Writing recap…' })).toHaveCount(0);
  await expect(page.locator('article[data-role="user"]')).toHaveCount(users);
  await expect(recap.ghost()).toHaveCount(0);
  await recap.expectDraft('Keep my draft');
  await recap.expand(touch);
  await expect(recap.card().getByRole('button', { name: /^Jump to point \d$/ }).first()).toBeVisible();
});

test('manual recap mode should drop the auto recap rule from the prompt', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setMessages(conversation(body));
  const recap = new RecapPage(page);
  await page.goto('/settings/appearance');
  const mode = page.getByRole('combobox', { name: 'Recap', exact: true });
  const autoplay = page.getByRole('switch', { name: 'Read recaps aloud automatically', exact: true });
  await expect(mode).toHaveValue('auto');
  await expect(autoplay).toHaveAttribute('aria-checked', 'false');
  expect(await mode.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  // Act
  await mode.selectOption('manual');
  await page.reload();
  await expect(mode).toHaveValue('manual');
  await recap.openSession();
  await recap.send('Next step');
  // Assert
  await expect.poll(() => server.sends.length).toBe(1);
  const raw = await server.encryption.decrypt<{ meta: Record<string, unknown> }>(server.sends[0].content, server.dataKey);
  expect(raw.meta.appendSystemPrompt).toContain('<rayno-recap>');
  expect(raw.meta.appendSystemPrompt).toContain(RECAP_REQUEST);
  expect(raw.meta.appendSystemPrompt).not.toContain('1,000 visible characters');
  expect(raw.meta.appendSystemPrompt).not.toContain('Skip the recap');
});

test('recap style should start with the preset, persist an edit, and reach the prompt', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setMessages(conversation(body));
  const recap = new RecapPage(page);
  const phone = testInfo.project.name.startsWith('mobile');
  await page.goto('/settings/appearance');
  const style = page.getByRole('textbox', { name: 'Recap style' });
  const reset = page.getByRole('button', { name: 'Reset to default' });
  await expect(style).toHaveValue(/warm, approachable technical colleague/);
  await expect(reset).toBeDisabled();
  expect(await style.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(phone ? 16 : 14);
  if (phone) expect((await reset.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // Act
  await style.fill('Speak like a calm coach. Keep it short.');
  await page.reload();
  await expect(style).toHaveValue('Speak like a calm coach. Keep it short.');
  await expect(reset).toBeEnabled();
  await recap.openSession();
  await recap.send('Next step');
  // Assert
  await expect.poll(() => server.sends.length).toBe(1);
  const raw = await server.encryption.decrypt<{ meta: Record<string, unknown> }>(server.sends[0].content, server.dataKey);
  expect(raw.meta.appendSystemPrompt).toContain('Recap voice:\nSpeak like a calm coach. Keep it short.\n\nRules:');
  expect(raw.meta.appendSystemPrompt).not.toContain('warm, approachable technical colleague');
  await page.goto('/settings/appearance');
  await reset.click();
  await expect(style).toHaveValue(/warm, approachable technical colleague/);
  await expect(reset).toBeDisabled();
});

for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 420], [844, 390]]) {
  test(`recap card should stay readable and reachable at ${width}x${height}`, async ({ page }, testInfo) => {
    // Arrange
    await page.setViewportSize({ width, height });
    const server = new HappyServer();
    await server.install(page);
    await server.setMessages(conversation(body + '\n\n' + recapBlock));
    const recap = new RecapPage(page);
    await recap.stubSpeech();
    const touch = !!testInfo.project.use.hasTouch;
    const phone = width < 768 || touch;
    await recap.openSession();
    await expect(recap.card()).toBeVisible();
    // Act
    await recap.scrollToLatest();
    // Assert
    await recap.expectNoHorizontalOverflow();
    await recap.expectCardClearOfComposer();
    const chevron = (await recap.chevron().boundingBox())!;
    expect(chevron.width).toBeGreaterThanOrEqual(phone ? 44 : 36);
    expect(chevron.height).toBeGreaterThanOrEqual(phone ? 44 : 36);
    // The play button keeps its 36px look and gets a 44px hit area from a pseudo-element.
    if (phone) await recap.expectHitArea(recap.play());
    await expect(recap.card().getByTestId('recap-time')).toBeVisible({ visible: width >= 768 });
    // Act
    await recap.expand(touch);
    await recap.scrollToLatest();
    // Assert
    await recap.expectCardReadable();
    await recap.expectNoHorizontalOverflow();
    await recap.expectCardClearOfComposer();
    for (const name of ['Copy recap', 'Reading speed 1×', 'Hide recap details']) {
      const control = recap.card().getByRole('button', { name, exact: true });
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      if (phone) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }
    if (width >= 768) {
      const rail = (await recap.rail().boundingBox())!;
      const card = (await recap.card().boundingBox())!;
      expect(card.x + card.width).toBeLessThanOrEqual(rail.x);
    }
    if (phone && width < 768) await recap.expectPhrasesHitOwnPoint();
    await recap.activate(recap.phrase('12 tests pass'), touch);
    await expect(page.locator('article p').filter({ hasText: 'Fixed and added a test' })).toHaveClass(/flash/);
  });
}

test('recap voice should keep a pause through speed changes and keep the spoken position', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setMessages(conversation(body + '\n\n' + recapBlock));
  const recap = new RecapPage(page);
  await recap.stubSpeech();
  const touch = !!testInfo.project.use.hasTouch;
  const rate = (label: string) => recap.card().getByRole('button', { name: `Reading speed ${label}`, exact: true });
  await recap.openSession();
  await recap.expand(touch);
  await recap.scrollToLatest();
  await recap.activate(recap.card().getByRole('button', { name: 'Jump to point 3', exact: true }), touch);
  await expect(recap.phrase('12 tests pass')).toHaveAttribute('data-active', 'true');
  await recap.scrollToLatest();
  // Act
  await recap.activate(recap.play(), touch);
  await recap.boundary(recapText.indexOf('. ') + 1);
  // Assert
  await expect(recap.card().getByRole('button', { name: 'Pause recap', exact: true })).toBeVisible();
  await expect(recap.phrase('12 tests pass')).toHaveAttribute('data-active', 'false');
  await expect(recap.card().locator('[data-active="true"]')).toHaveCount(0);
  // Act
  await recap.boundary(point2 + 3);
  await recap.activate(recap.play(), touch);
  await recap.activate(rate('1×'), touch);
  // Assert
  await expect(rate('1.25×')).toBeVisible();
  await expect(recap.card().getByRole('button', { name: 'Play recap', exact: true })).toBeVisible();
  expect((await recap.speechLog()).spoken).toHaveLength(1);
  // Act
  await recap.activate(recap.play(), touch);
  // Assert
  await expect(recap.card().getByRole('button', { name: 'Pause recap', exact: true })).toBeVisible();
  expect((await recap.speechLog()).spoken.at(-1)).toEqual({ text: recapText.slice(point2 + 3), lang: 'en', rate: 1.25 });
  // Act
  await recap.activate(rate('1.25×'), touch);
  await recap.activate(rate('1.5×'), touch);
  // Assert
  await expect(rate('1×')).toBeVisible();
  const spoken = (await recap.speechLog()).spoken;
  expect(spoken.slice(-2)).toEqual([
    { text: recapText.slice(point2 + 3), lang: 'en', rate: 1.5 },
    { text: recapText.slice(point2 + 3), lang: 'en', rate: 1 },
  ]);
  expect(server.sends).toEqual([]);
});

test('recap autoplay should not read a history recap after a reply without a recap', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  // The fixture sends activity events only after a first agent state.
  await server.setWorking(false);
  // The fixture keeps the oldest message for the "Load earlier" page.
  await server.setMessages([reply(body + '\n\n' + recapBlock), ...conversation('From the real protocol\n\nShort answer.')]);
  const recap = new RecapPage(page);
  await recap.stubSpeech();
  const touch = !!testInfo.project.use.hasTouch;
  await page.goto('/settings/appearance');
  await recap.activate(page.getByRole('switch', { name: 'Read recaps aloud automatically', exact: true }), touch);
  await expect(page.getByRole('switch', { name: 'Read recaps aloud automatically', exact: true })).toHaveAttribute('aria-checked', 'true');
  await recap.openSession();
    await recap.send('Next step');
  await expect.poll(() => server.sends.length).toBe(1);
  await server.setWorking(true);
  await server.pushReply('Done.');
  await server.setWorking(false);
  await expect(page.getByText('Done.', { exact: true })).toBeVisible();
  // Act
  await recap.loadEarlier();
  // Assert
  await expect(recap.card()).toHaveCount(1);
  await page.waitForTimeout(300);
  expect((await recap.speechLog()).spoken).toEqual([]);
  // Act
  await server.setWorking(true);
  await server.pushReply('New reply.\n\n<rayno-recap>\nThe new reply has a recap.\n</rayno-recap>');
  await server.setWorking(false);
  // Assert
  await expect.poll(async () => (await recap.speechLog()).spoken.map((item) => item.text)).toEqual(['The new reply has a recap.']);
});

test('recap clamp should show the full text when keyboard focus reaches a hidden point', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const sentence = 'The merge kept the older session reading because the merge step prefers the session data whenever both readings exist. ';
  const long = sentence.repeat(4) + 'A newer manual reading now wins, and '
    + '<point quote="12 tests pass">12 tests pass</point>.';
  await server.setMessages(conversation(body + '\n\n<rayno-recap>\n' + long + '\n</rayno-recap>'));
  const recap = new RecapPage(page);
  const touch = !!testInfo.project.use.hasTouch;
  await recap.openSession();
  await recap.expand(touch);
  await expect(recap.card().getByRole('button', { name: 'Show more', exact: true })).toBeVisible();
  const text = recap.card().locator('[data-point="1"]').first().locator('xpath=ancestor::div[1]');
  // Act
  await recap.phrase('12 tests pass').focus();
  // Assert
  await expect(recap.card().getByRole('button', { name: 'Show less', exact: true })).toBeVisible();
  await expect(recap.phrase('12 tests pass')).toBeFocused();
  // Act
  await recap.activate(recap.card().getByRole('button', { name: 'Show less', exact: true }), touch);
  // Assert
  await expect(recap.card().getByRole('button', { name: 'Show more', exact: true })).toBeVisible();
  expect(await text.evaluate((element) => element.scrollTop)).toBe(0);
  const describedBy = await recap.phrase('12 tests pass').getAttribute('aria-describedby');
  await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(testInfo.project.use.isMobile
    ? 'Tap a phrase to jump to that part of the reply'
    : 'Tap a phrase or a pin on the right to jump to that part of the reply');
});

test('recap rail pins should stay inside the rail and keep their own hit areas', async ({ page }, testInfo) => {
  // Arrange
  const mobile = !!testInfo.project.use.isMobile;
  await page.setViewportSize(mobile ? { width: 844, height: 390 } : { width: 1440, height: 900 });
  const server = new HappyServer();
  await server.install(page);
  const turns = Array.from({ length: 8 }, (_, index) => [
    { role: 'user', content: { type: 'text', text: `Question ${index + 1}` } }, reply(filler),
  ]).flat();
  const end = 'From the real protocol\n\nThe fix is ready.\n\nAlpha step passed.\n\nBeta step passed.\n\nGamma step passed.\n\n'
    + '<rayno-recap>\n<point quote="Alpha step passed.">Alpha</point>, <point quote="Beta step passed.">beta</point>, '
    + 'and <point quote="Gamma step passed.">gamma</point> passed.\n</rayno-recap>';
  await server.setMessages([...turns, ...conversation(end)]);
  const recap = new RecapPage(page);
  await recap.openSession();
  await recap.scrollToLatest();
  // Act
  const pins = recap.rail().getByRole('button');
  await expect(pins).toHaveText(['1', '2', '3']);
  const layout = await recap.rail().evaluate((rail) => {
    const host = rail.getBoundingClientRect();
    const composer = document.querySelector('[aria-label="Chat session"] [data-focus-frame]')!.getBoundingClientRect();
    return [...rail.querySelectorAll('button')].map((pin) => {
      const box = pin.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const hits = [box.top + 2, box.top + box.height / 2, box.bottom - 2]
        .map((y) => document.elementFromPoint(x, y)?.closest('button')?.textContent || null);
      return { top: box.top, inside: box.top >= host.top - 0.5 && box.bottom <= host.bottom + 0.5 && box.bottom <= composer.top, hits, label: pin.textContent };
    });
  });
  // Assert
  expect(layout.map((pin) => pin.inside)).toEqual([true, true, true]);
  expect(layout.map((pin) => pin.hits)).toEqual([['1', '1', '1'], ['2', '2', '2'], ['3', '3', '3']]);
  if (testInfo.project.use.hasTouch) {
    expect(layout[1].top - layout[0].top).toBeGreaterThanOrEqual(46);
    expect(layout[2].top - layout[1].top).toBeGreaterThanOrEqual(46);
  }
  // Act
  await recap.activate(pins.nth(0), !!testInfo.project.use.hasTouch);
  // Assert
  await expect(page.locator('article p').filter({ hasText: 'Alpha step passed.' })).toHaveClass(/flash/);
});
