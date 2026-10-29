import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { SessionIdsPage } from './pages/SessionIdsPage';
import { demoClaudeSessionId, demoCodexThreadId } from '../src/data/sessionIdsDemo';

for (const [flavor, field, label] of [['claude', 'claudeSessionId', 'Claude session ID'], ['codex', 'codexThreadId', 'Codex thread ID']]) {
  test(`session IDs - live ${flavor} metadata - should copy each full ID separately`, async ({ page }, info) => {
    // Arrange
    const server = new HappyServer();
    await server.install(page);
    const metadata = await server.encryption.decrypt<Record<string, unknown>>(server.sessions[0].metadata, server.dataKey);
    const id = '00000000-0000-4000-8000-000000000010';
    server.sessions[0].metadata = await server.encryption.encrypt({ ...metadata, flavor, [field]: id }, server.dataKey);
    const view = new SessionIdsPage(page);
    await view.stubClipboard();
    // Act / Assert
    await view.openIds();
    await expect(view.agentId()).toContainText(label);
    await view.copyId('happy', 'real-session', !!info.project.use.hasTouch);
    await view.copyId('agent', id, !!info.project.use.hasTouch);
    await view.copyId('happy', 'real-session', !!info.project.use.hasTouch);
  });
}

test('session IDs - agent has no ID - should disable agent copy and retain Happy copy', async ({ page }, info) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const view = new SessionIdsPage(page);
  await view.stubClipboard();
  // Act / Assert
  await view.openIds();
  await view.expectMissingId();
  await view.copyId('happy', 'real-session', !!info.project.use.hasTouch);
});

test('session IDs - clipboard access denied - should report failure without closing info', async ({ page }) => {
  // Arrange
  const view = new SessionIdsPage(page);
  await view.stubClipboard(true);
  await view.openIds('session-ids-demo', true);
  // Act
  await view.happyId().click();
  // Assert
  await expect(page.getByRole('status').filter({ hasText: 'Could not copy. Check clipboard access in your browser.' })).toBeVisible();
  await expect(view.agentId()).toBeEnabled();
});

for (const [width, height] of [[320,568], [360,640], [390,844], [430,932], [390,360], [844,390]]) {
  test(`session ID demo - ${width}x${height} - should copy both agents and preserve older demo data`, async ({ page }, info) => {
    test.skip(!info.project.name.startsWith('mobile'), 'Touch layout check');
    // Arrange
    await page.setViewportSize({ width, height });
    const view = new SessionIdsPage(page);
    await view.stubClipboard();
    // Act / Assert
    await view.openIds('session-ids-demo', true);
    await view.copyId('happy', 'session-ids-demo', true);
    await view.copyId('agent', demoClaudeSessionId, true);
    await view.copyId('agent', demoClaudeSessionId, true);
    await view.restoreOlderDemo();
    await view.copyId('agent', demoClaudeSessionId, true);
    await view.openIds('session-ids-codex-demo', true);
    await view.copyId('happy', 'session-ids-codex-demo', true);
    await view.copyId('agent', demoCodexThreadId, true);
    await view.openIds('session-ids-missing-demo', true);
    await view.expectMissingId();
    await view.copyId('happy', 'session-ids-missing-demo', true);
  });
}
