import { expect, test } from '@playwright/test';
import { ToolTimelinePage } from './pages/ToolTimelinePage';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 430], [844, 390]]) {
  test(`timeline demo should advance, inspect, finish and restart at ${width}x${height}`, async ({ page }, testInfo) => {
    // Arrange
    await page.setViewportSize({ width, height });
    await page.goto('/session/tool-timeline-demo?demo=1');
    const timeline = new ToolTimelinePage(page);
    await expect(timeline.controls()).toBeVisible();
    const draft = page.getByRole('textbox', { name: 'Message', exact: true });
    await draft.fill('Keep this draft');
    // Act / Assert
    await timeline.start();
    await expect(page.getByText('Waiting for the first step', { exact: true })).toBeVisible();
    await timeline.next();
    await timeline.expectStep(1);
    await expect(page.locator('[data-activity-waiting]')).toHaveCount(0);
    await timeline.next();
    await timeline.expectStep(2);
    await timeline.next();
    await timeline.expectStep(3);
    await timeline.expectSingleLineTitle();
    await timeline.expand();
    await timeline.expectCompactLogs();
    await expect(timeline.group().locator('li[data-step-state="done"]')).toHaveCount(2);
    await expect(timeline.group().locator('li[data-step-state="running"]')).toHaveCount(1);
    const detail = timeline.group().locator('details').last();
    await timeline.activate(detail.locator('summary'));
    await expect(detail.locator('pre').first()).toContainText('sources/monitor/providers/claude/workspace/agentUsage.ts');
    await timeline.activate(detail.locator('summary'));
    await timeline.expectNoPageOverflow();
    if (width === 390 && height === 844) {
      const clock = timeline.group().locator('[data-activity-clock]'), before = await clock.textContent();
      await timeline.group().locator('ul').evaluate(element => {
        element.setAttribute('data-mutations', '0');
        const observer = new MutationObserver(() => element.setAttribute('data-mutations', String(Number(element.getAttribute('data-mutations')) + 1)));
        observer.observe(element, { childList: true, characterData: true, subtree: true });
      });
      await expect(clock).not.toHaveText(before!);
      await expect(timeline.group().locator('ul')).toHaveAttribute('data-mutations', '0');
      await timeline.toggle().scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('timeline-active.png') });
    }
    await timeline.activate(timeline.controls().getByRole('button', { name: 'Finish demo', exact: true }));
    await expect(timeline.toggle()).toContainText(/Worked for .* · 4 tools/);
    await expect(timeline.toggle()).toHaveAttribute('aria-expanded', 'false');
    await timeline.expand();
    await expect(timeline.group().locator('li[data-step-state="done"]')).toHaveCount(4);
    await timeline.activate(timeline.controls().getByRole('button', { name: 'Restart demo', exact: true }));
    await expect(page.getByText('Waiting for the first step', { exact: true })).toBeVisible();
    await expect(draft).toHaveValue('Keep this draft');
    await timeline.next();
    await timeline.expectStep(1);
    await timeline.expectNoPageOverflow();
  });
}

test('live timeline should retain server timing, result-less completion and error details', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.updateAgentState({});
  await server.setWorking(true);
  await server.setMessages([{ role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'From the real protocol' } } }]);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  await workspace.expectConnected();
  const timeline = new ToolTimelinePage(page);
  const start = Date.now() - 42000;
  const event = (ev: Record<string, unknown>) => ({ role: 'session', content: { id: crypto.randomUUID(), time: Date.now(), role: 'agent', turn: 'timeline-turn', ev } });
  // Act
  await expect(page.getByText('Waiting for the first step', { exact: true })).toBeVisible();
  await server.pushEvent(event({ t: 'tool-call-start', call: 'read', name: 'Read', title: 'Read manualUsage.ts', args: { file_path: 'manualUsage.ts' } }), 'real-session', true, start);
  await timeline.expectStep(1);
  await expect(timeline.group().locator('[data-activity-clock]')).toContainText('0:4');
  await server.pushEvent(event({ t: 'tool-call-end', call: 'read' }), 'real-session', true, start + 10000);
  await server.pushEvent(event({ t: 'tool-call-start', call: 'grep', name: 'Grep', title: 'Grep capturedAt', args: { pattern: 'capturedAt' } }), 'real-session', true, start + 11000);
  await timeline.expectStep(2);
  await timeline.expand();
  await expect(timeline.group().locator('li[data-step-state="done"]')).toHaveCount(1);
  await server.pushEvent(event({ t: 'tool-call-end', call: 'grep', result: 'Search failed', isError: true }), 'real-session', true, start + 12000);
  await server.setWorking(false);
  // Assert
  await expect(timeline.toggle()).toContainText('Worked for 12s · 2 tools');
  await expect(timeline.toggle()).toHaveAttribute('aria-expanded', 'false');
  await timeline.expand();
  await expect(timeline.group().locator('li[data-step-state="error"]')).toHaveCount(1);
  const failed = timeline.group().locator('details').last();
  await timeline.activate(failed.locator('summary'));
  await expect(failed).toContainText('Search failed');
  await expect(timeline.group().locator('[data-activity-clock]')).toHaveCount(0);
  // An interrupted tool keeps its unknown state and the reader's focused detail.
  await server.pushEvent({ role: 'user', content: { type: 'text', text: 'Continue with another file' } });
  await server.setWorking(true);
  await server.pushEvent(event({ t: 'tool-call-start', call: 'interrupted', name: 'Read', title: 'Read next.ts', args: { file_path: 'next.ts' } }), 'real-session', true, Date.now());
  await timeline.expectStep(1);
  await timeline.expand();
  const focused = timeline.group().locator('summary').first();
  await focused.focus();
  await server.setWorking(false);
  await expect(timeline.group()).not.toHaveAttribute('data-active');
  await expect(timeline.toggle()).toHaveAttribute('aria-expanded', 'true');
  await expect(focused).toBeFocused();
  await expect(timeline.group().locator('li[data-step-state="unknown"]')).toHaveCount(1);
  await expect(timeline.group().locator('[data-activity-clock]')).toHaveCount(0);
});

test('old demo data should gain the discoverable timeline example while retaining drafts', async ({ page }) => {
  // Arrange
  await page.goto('/sessions?demo=1');
  await expect.poll(() => page.evaluate(() => !!localStorage.getItem('rayno.demo.v1'))).toBe(true);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('rayno.demo.v1')!);
    state.sessions = state.sessions.filter((session: { id: string }) => session.id !== 'tool-timeline-demo');
    state.drafts['reply-options-demo'] = 'Old saved draft';
    localStorage.setItem('rayno.demo.v1', JSON.stringify(state));
  });
  // Act / Assert
  await page.reload();
  await expect(new LiveWorkspacePage(page).sessionRows().filter({ hasText: 'Ticker + timeline · Interactive demo' })).toBeVisible();
  await page.goto('/session/tool-timeline-demo?demo=1');
  const timeline = new ToolTimelinePage(page);
  await timeline.start();
  await timeline.next();
  await timeline.expectStep(1);
  await page.goto('/session/reply-options-demo?demo=1');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Old saved draft');
});
