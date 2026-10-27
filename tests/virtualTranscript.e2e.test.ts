import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { toolHeavyHistory as baseHistory } from './fixtures/toolHeavyHistory';
import { VirtualTranscriptPage } from './pages/VirtualTranscriptPage';
import { RecapPage } from './pages/RecapPage';
import { MermaidPage } from './pages/MermaidPage';
import { SideChatsPage } from './pages/SideChatsPage';

// Each reply needs 500 or more characters, so each one gets a tick on the reply rail.
const DETAIL = Array.from({ length: 6 }, (_, index) =>
  `Step ${index + 1} of the check read the build log, compared the output with the last run, and found no new warning.`).join(' ');
const toolHeavyHistory = (turns: number) => baseHistory(turns, undefined, DETAIL);

async function arrange(page: import('@playwright/test').Page, rows = toolHeavyHistory(120)) {
  const server = new HappyServer();
  await server.install(page); await server.setWorking(false); await server.setMessages(rows);
  // Start functional navigation checks with every row loaded. Pagination has its own check below.
  await page.route('https://api.cluster-fluster.com/v3/sessions/real-session/messages?**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('before_seq') !== '2147483647') return route.fallback();
    return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ messages: server.messages, hasMore: false }) });
  });
  const view = new VirtualTranscriptPage(page);
  await view.enable(); await view.openSession(); await view.expectVirtual();
  return { server, view };
}

test('virtual transcript should keep every rail target while mounting a bounded list', async ({ page }, info) => {
  // Arrange
  await page.setViewportSize(info.project.use.isMobile ? { width: 844, height: 600 } : { width: 1440, height: 900 });
  const { server, view } = await arrange(page);
  await expect(page.getByRole('navigation', { name: 'Agent replies', exact: true }).getByRole('button')).toHaveCount(120);
  await expect(page.getByRole('heading', { name: 'Result 1', exact: true })).toHaveCount(0);
  // Act / Assert
  await view.jumpReply(1);
  await expect(page.getByRole('heading', { name: 'Result 1', exact: true })).toBeInViewport();
  const anchor = await view.readingAnchor();
  await server.pushReply('A new response while reading history');
  await view.expectAnchor(anchor);
  await view.returnToLatest();
  await expect(page.getByText('A new response while reading history', { exact: true })).toBeInViewport();
  await expect.poll(() => view.transcript().locator('[data-transcript-block]').count()).toBeLessThan(80);
});

test('virtual transcript should restore its position after a reading mode change in Settings', async ({ page }, info) => {
  await page.setViewportSize(info.project.use.isMobile ? { width: 844, height: 600 } : { width: 1440, height: 900 });
  // Arrange
  const { view } = await arrange(page);
  // Act / Assert
  await view.jumpReply(40);
  await expect(page.getByRole('heading', { name: 'Result 40', exact: true })).toBeInViewport();
  const anchor = await view.readingAnchor();
  await view.showFull();
  await view.expectAnchor(anchor);
  await expect(page.getByText('Task 1: check the build', { exact: true })).toBeAttached();
  const selected = await view.transcript().evaluate(root => {
    const rows = root.querySelectorAll('article');
    const range = document.createRange(); range.setStartBefore(rows[0]); range.setEndAfter(rows[1]);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    const text = selection.toString(); selection.removeAllRanges(); return text;
  });
  expect(selected).toContain('Task 1'); expect(selected).toContain('Result 1');
  await view.faster(); await view.expectAnchor(anchor);
  await expect(page.getByText('Task 1: check the build', { exact: true })).toHaveCount(0);
});

test('virtual transcript should keep an encrypted reading anchor through navigation and reload', async ({ page }, info) => {
  await page.setViewportSize(info.project.use.isMobile ? { width: 844, height: 600 } : { width: 1440, height: 900 });
  // Arrange
  const { server, view } = await arrange(page);
  await view.jumpReply(30);
  const anchor = await view.readingAnchor();
  // Act / Assert
  await expect.poll(async () => {
    const value = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.endsWith('.transcript.real-session'))?.[1]);
    if (!value) return undefined;
    expect(value).not.toContain(anchor.id);
    return JSON.parse(await server.encryption.decrypt<string>(value, null)).id;
  }).toBe(anchor.id);
  await page.goto('/settings/appearance');
  await view.openSession(); await view.expectAnchor(anchor);
  await page.reload(); await view.expectAnchor(anchor);
});

test('virtual transcript should restore its reading row after in-app navigation with the message module already loaded', async ({ page }) => {
  // Arrange
  await page.setViewportSize({ width: 844, height: 600 });
  const { view } = await arrange(page);
  await view.jumpReply(40);
  const anchor = await view.readingAnchor();
  // Act
  await view.goToSection('Settings');
  await view.goToSection('Sessions');
  await view.openRow();
  // Assert: no document reload or lazy import supplies another initialization pass.
  await view.expectAnchor(anchor);
  await expect(view.latestShortcut()).toBeVisible();
});

test('virtual transcript should preserve the visible row when older history is prepended', async ({ page }, info) => {
  await page.setViewportSize(info.project.use.isMobile ? { width: 844, height: 600 } : { width: 1440, height: 900 });
  // Arrange: load 120 turns first, then prepend 30 more through the real history control.
  const server = new HappyServer();
  await server.install(page); await server.setWorking(false); await server.setMessages(toolHeavyHistory(150));
  await page.route('https://api.cluster-fluster.com/v3/sessions/real-session/messages?**', route => {
    const url = new URL(route.request().url()), before = url.searchParams.get('before_seq');
    const after = url.searchParams.get('after_seq'), initial = before === '2147483647';
    // A background catch-up must never inject the older page before the user requests it.
    const messages = after !== null ? server.messages.filter(row => row.seq > Number(after))
      : initial ? server.messages.slice(-2160) : server.messages.filter(row => row.seq < Number(before));
    return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ messages, hasMore: initial }) });
  });
  const view = new VirtualTranscriptPage(page);
  await view.enable(); await view.openSession(); await view.expectVirtual();
  await expect(page.getByRole('navigation', { name: 'Agent replies', exact: true }).getByRole('button')).toHaveCount(120);
  const earlier = page.getByRole('button', { name: 'Load earlier messages', exact: true });
  await earlier.focus();
  // Keep whichever loaded row the browser exposes after focus; focus need not expose the first message.
  const anchor = await view.readingAnchor();
  expect(anchor.id).toBeTruthy();
  // Act
  await earlier.press('Enter');
  // Assert
  await expect(earlier).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Agent replies', exact: true }).getByRole('button')).toHaveCount(150);
  await view.expectAnchor(anchor);
  await view.jumpReply(1);
  await expect(page.getByRole('heading', { name: 'Result 1', exact: true })).toBeInViewport();
});

test('virtual transcript should retain its reading row after viewport and font changes', async ({ page }, info) => {
  await page.setViewportSize(info.project.use.isMobile ? { width: 844, height: 600 } : { width: 1440, height: 900 });
  // Arrange
  const { view } = await arrange(page);
  await view.jumpReply(55);
  const anchor = await view.readingAnchor();
  // Act / Assert
  for (const width of [430, 844, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await view.expectAnchor(anchor);
  }
  await page.goto('/settings/appearance');
  await page.goto('/settings/appearance');
  await page.getByRole('button', { name: 'Large', exact: true }).click();
  await view.openSession();
  await view.expectAnchor(anchor);
});

test('virtual recap should mount an old tool target and retain tool state after it leaves the viewport', async ({ page }) => {
  // Arrange: one long turn puts the quoted tool far outside the reply's mounted range.
  let time = 1700000000000;
  const agent = (ev: Record<string, unknown>) => ({ role: 'session', content: { id: `v-${++time}`, time, role: 'agent', turn: 'long-turn', ev }, meta: { sentFrom: 'cli' } });
  const rows: Record<string, any>[] = [{ role: 'user', content: { type: 'text', text: 'Check the long turn' } }];
  for (let i = 0; i < 170; i++) {
    rows.push(agent({ t: 'tool-call-start', call: `v-tool-${i}`, name: 'Bash', title: `Run check ${i}`, args: { command: `echo virtual-target-${i}` } }),
      agent({ t: 'tool-call-end', call: `v-tool-${i}` }), agent({ t: 'text', text: `Work update ${i}` }));
  }
  rows.push(agent({ t: 'text', text: 'From the real protocol\n\n<rayno-recap>\n<point quote="echo virtual-target-0">Read the first check</point>.\n</rayno-recap>' }));
  const { view } = await arrange(page, rows);
  const recap = new RecapPage(page);
  await recap.expand(!!await page.evaluate(() => navigator.maxTouchPoints));
  // Act / Assert
  await recap.activate(recap.phrase('Read the first check'), !!await page.evaluate(() => navigator.maxTouchPoints));
  const group = page.getByRole('region', { name: 'Tool activity', exact: true }).filter({ hasText: 'Run check 0' });
  await expect(group.locator(':scope > button')).toHaveAttribute('aria-expanded', 'true');
  const summary = group.locator('summary').first();
  await recap.centerInList(summary); await summary.click();
  await expect(group.locator('details').first()).toHaveAttribute('open');
  await view.returnToLatest();
  await expect(group).toHaveCount(0);
  await recap.activate(recap.phrase('Read the first check'), !!await page.evaluate(() => navigator.maxTouchPoints));
  await expect(group.locator('details').first()).toHaveAttribute('open');
});

test('virtual transcript should keep new diagram growth pinned to the latest message', async ({ page }) => {
  // Arrange
  const { server, view } = await arrange(page);
  // Act
  await server.pushReply('```mermaid\nflowchart LR\n A[Virtual history] --> B[Still at latest]\n```');
  await new MermaidPage(page).expectRendered();
  // Assert
  await expect.poll(async () => (await view.conversationPosition()).remaining).toBeLessThan(4);
});

test('virtual transcript should keep Settings, tools, and send reachable across phone viewports', async ({ page }, info) => {
  test.skip(!info.project.use.isMobile, 'Phone interaction matrix.');
  test.setTimeout(90000);
  // Arrange
  const { server, view } = await arrange(page);
  // Act / Assert
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 360], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/settings/appearance');
    const toggle = page.getByRole('switch', { name: 'Faster long chats (preview)', exact: true });
    await toggle.scrollIntoViewIfNeeded();
    const box = (await toggle.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await view.openSession();
    await expect(view.transcript()).toHaveAttribute('data-transcript-mode', 'full');
    await view.expectNoTranscriptTools();
    await page.goto('/settings/appearance');
    await toggle.scrollIntoViewIfNeeded(); await toggle.tap();
    await view.openSession();
    await expect(view.transcript()).toHaveAttribute('data-transcript-mode', 'virtual');
    await view.expectNoTranscriptTools();
    await view.firstMessage();
    const block = await view.transcript().locator('[data-transcript-block]:has([data-tool-activity])').first().getAttribute('data-transcript-block');
    const tool = view.transcript().locator(`[data-transcript-block="${block}"] [data-tool-activity] > button`);
    const expanded = await tool.getAttribute('aria-expanded');
    await view.tapControl(tool);
    await expect(tool).toHaveAttribute('aria-expanded', expanded === 'true' ? 'false' : 'true');
    await view.returnToLatest();
    await view.input().fill(`Phone draft ${width}x${height}`);
    await view.expectSendReachable(); await view.expectNoPageOverflow();
  }
  await view.sendButton().tap();
  await expect(view.input()).toHaveValue(''); expect(server.sends).toHaveLength(1);
});

test('virtual transcript should retain a focused tool control when scrolling it out of view', async ({ page }, info) => {
  test.skip(!!info.project.use.isMobile, 'Desktop keyboard focus and wheel interaction.');
  // Arrange
  const rows = toolHeavyHistory(120);
  // Give this reply a visible rail pin. Short replies no longer have one.
  const reply = rows.find(row => row.content.turn === 'turn-30' && row.content.ev.text?.startsWith('### Result 30'))!;
  reply.content.ev.text += '\n\n' + 'The build report includes the test results and source changes. '.repeat(12);
  const { view } = await arrange(page, rows);
  await view.jumpReply(30);
  const group = view.transcript().locator('[data-tool-activity]').filter({ hasText: 'Bash 30' });
  if (await group.locator(':scope > button').getAttribute('aria-expanded') !== 'true') await group.locator(':scope > button').click();
  const summary = group.locator('summary').first();
  await summary.focus();
  // Act
  await view.messages().hover(); await page.mouse.wheel(0, 2400);
  // Assert
  await expect(summary).not.toBeInViewport();
  await expect(summary).toBeFocused();
  await expect.poll(() => view.transcript().locator('[data-transcript-block]').count()).toBeLessThan(80);
});


test('virtual transcript should show the first loaded message without a transcript toolbar', async ({ page }) => {
  // Arrange
  const { view } = await arrange(page);
  // Act / Assert
  await view.firstMessage();
  await expect(view.chat().getByText('Task 1: check the build', { exact: true })).toBeInViewport();
  await view.expectNoTranscriptTools();
});

test('virtual transcript should fit an embedded side chat and keep its offline history usable', async ({ page }) => {
  // Arrange
  await page.setViewportSize({ width: 1440, height: 900 });
  const server = new HappyServer();
  await server.install(page); await server.setWorking(false);
  const id = 'virtual-side';
  await server.addSession(id, { parentSessionId: 'real-session', isSideChat: true, claudeSessionId: 'virtual-provider' });
  const raw = toolHeavyHistory(120);
  const messages = await server.setMessages(raw, id);
  await page.route(`https://api.cluster-fluster.com/v3/sessions/${id}/messages?**`, route => route.fulfill({
    contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ messages, hasMore: false }),
  }));
  const view = new VirtualTranscriptPage(page), side = new SideChatsPage(page);
  await view.enable(); await side.openSession(); await side.headerButton().click();
  view.embedded = true;
  await view.expectVirtual();
  // Act / Assert
  await view.expectNoTranscriptTools();
  await view.firstMessage(); await expect(view.chat().getByText('Task 1: check the build', { exact: true })).toBeInViewport();
  await expect.poll(async () => (await side.offlineRecords()).some(row => row.key.endsWith('history.' + id))).toBe(true);
  await side.setNetwork(false);
  await expect(view.chat().getByRole('status', { name: 'Side chat availability', exact: true })).toBeVisible();
  await view.firstMessage(); await expect(view.chat().getByText('Task 1: check the build', { exact: true })).toBeInViewport();
  await view.expectNoTranscriptTools(); await side.expectComposerFits();
});


test('virtual transcript should show the latest control when keyboard focus pauses follow', async ({ page }) => {
  // Arrange
  const { server, view } = await arrange(page);
  // Act
  await view.messages().getByRole('button', { name: 'Copy response', exact: true }).last().focus();
  // Assert
  await expect(view.latestShortcut()).toBeVisible();
  const anchor = await view.readingAnchor();
  await server.pushReply('A response after keyboard focus');
  await view.expectAnchor(anchor);
  await view.returnToLatest();
  await expect(page.getByText('A response after keyboard focus', { exact: true })).toBeInViewport();
});
