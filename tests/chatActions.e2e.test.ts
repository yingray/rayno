import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { ChatActionsPage } from './pages/ChatActionsPage';

async function prepare(server: HappyServer, flavor: 'claude' | 'codex') {
  const metadata = await server.encryption.decrypt<Record<string, unknown>>(server.sessions[0].metadata, server.dataKey);
  server.sessions[0].metadata = await server.encryption.encrypt({ ...metadata, flavor,
    [flavor === 'codex' ? 'codexThreadId' : 'claudeSessionId']: 'original-provider-id',
  }, server.dataKey);
}

for (const flavor of ['claude', 'codex'] as const) {
  for (const kind of ['Fork', 'Duplicate'] as const) {
    test(`${flavor} ${kind} should copy the provider conversation and start a child with explicit modes`, async ({ page }) => {
      // Arrange
      const server = new HappyServer();
      await server.install(page); await prepare(server, flavor);
      const workspace = new ChatActionsPage(page);
      await workspace.openSession();
      // Act
      await workspace.openActions(); await workspace.chooseAction(kind);
      if (kind === 'Duplicate') { await workspace.selectPoint('Message 17:'); await workspace.confirmDuplicate(); }
      // Assert
      await expect(page).toHaveURL(/\/session\/created-session$/);
      expect(server.branchCalls).toHaveLength(1);
      expect(server.branchCalls[0].params).toMatchObject({ directory: '/real/project',
        [flavor === 'codex' ? 'codexThreadId' : 'claudeSessionId']: 'original-provider-id',
        ...(kind === 'Duplicate' ? { [flavor === 'codex' ? 'cutAfterItemId' : 'cutAfterUuid']: `${flavor}-17` } : {}),
      });
      expect(server.spawns).toHaveLength(1);
      expect(server.spawns[0]).toMatchObject({ agent: flavor, directory: '/real/project', parentSessionId: 'real-session',
        [flavor === 'codex' ? 'resumeCodexThreadId' : 'resumeClaudeSessionId']: `copied-${flavor}-id`,
      });
      expect(server.spawns[0].modelMode).toBeTruthy();
      expect(server.spawns[0].modelMode).not.toBe('default');
      expect(server.spawns[0].permissionMode).toBeTruthy();
      expect(server.sends).toHaveLength(0);
      expect(server.sessions.find(session => session.id === 'real-session')?.active).toBe(true);
    });
  }
}

test('a failed child start should retry the same copied conversation without another fork', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  server.failBranchSpawn = true;
  await server.install(page); await prepare(server, 'claude');
  const workspace = new ChatActionsPage(page);
  await workspace.openSession();
  // Act
  await workspace.openActions(); await workspace.chooseAction('Fork');
  await expect(workspace.menu().getByRole('alert')).toContainText('Retry');
  await workspace.chooseAction('Fork');
  // Assert
  await expect(page).toHaveURL(/\/session\/created-session$/);
  expect(server.branchCalls).toHaveLength(1);
  expect(server.spawns).toHaveLength(2);
  expect(server.spawns[0].resumeClaudeSessionId).toBe(server.spawns[1].resumeClaudeSessionId);
});

for (const action of ['Hand Off', 'New session in same workspace']) {
  test(`the session menu ${action} action should prepare an editable draft without starting an agent`, async ({ page }) => {
    // Arrange
    const server = new HappyServer();
    await server.install(page);
    await server.updateMetadata({ homeDir: '/real', claudeSessionId: 'original-provider-id' });
    const workspace = new ChatActionsPage(page);
    await workspace.openSession();
    // Act
    await workspace.openActions(); await workspace.chooseAction(action);
    // Assert
    await expect(page).toHaveURL(/\/new$/);
    await expect(page.getByLabel('Computer', { exact: true })).toHaveValue('computer');
    await expect(page.getByLabel('Folder', { exact: true })).toHaveValue('~/project');
    const agent = action === 'Hand Off' ? 'Codex' : 'Claude';
    await expect(page.getByRole('group', { name: 'Agent', exact: true }).getByRole('button', { name: agent, exact: true }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect(workspace.taskDescription()).toHaveValue(action === 'Hand Off' ? /original-provider-id\.jsonl/ : '');
    await workspace.expectTaskCaretAtEnd();
    expect(server.spawns).toHaveLength(0);
    expect(server.sends).toHaveLength(0);
    expect(server.mutations).toHaveLength(0);
  });
}

for (const flavor of ['claude', 'codex'] as const) {
  test(`an archived ${flavor} session that still reports active should offer Resume in chat, info, and the menu`, async ({ page }) => {
    // Arrange
    const server = new HappyServer();
    server.machineMetadata.resumeSupport = { rpcAvailable: true };
    await server.install(page); await prepare(server, flavor);
    await server.updateMetadata({ lifecycleState: 'archived' });
    const workspace = new ChatActionsPage(page);
    await workspace.openSession();
    // Act / Assert
    await expect(page.getByRole('button', { name: 'Resume session', exact: true })).toBeVisible();
    await workspace.info();
    await expect(page.getByRole('region', { name: 'Session details', exact: true }).getByRole('button', { name: 'Resume session', exact: true })).toBeVisible();
    await workspace.closeInfo();
    await workspace.openActions(); await workspace.chooseAction('Resume session');
    await expect(workspace.trigger()).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled();
    expect(server.resumeRequests).toHaveLength(1);
    expect(server.resumeRequests[0].sessionId).toBe('real-session');
    expect(server.spawns).toHaveLength(0);
    const metadata = await server.encryption.decrypt<Record<string, unknown>>(server.sessions[0].metadata, server.dataKey);
    expect(metadata.lifecycleState).toBeUndefined();
    await expect(page).toHaveURL(/\/session\/real-session$/);
  });
}

test('the session menu, duplicate picker, and full-width chat should work at desktop and phone sizes', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page); await prepare(server, 'claude');
  const workspace = new ChatActionsPage(page);
  await workspace.chooseChatWidth('full');
  await workspace.openSession();
  // Act / Assert
  for (const [width, height] of [[1440, 900], [320, 640], [360, 740], [390, 844], [430, 900], [360, 350], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await workspace.expectWideChat();
    await workspace.openActions(); await workspace.expectMenuUsable();
    await page.keyboard.press('Escape');
    await expect(workspace.trigger()).toBeFocused();
    await workspace.openActions(); await workspace.chooseAction('Duplicate');
    await workspace.selectPoint('Message 0:');
    const confirm = workspace.duplicateDialog().getByRole('button', { name: 'Duplicate session', exact: true });
    await confirm.scrollIntoViewIfNeeded();
    await workspace.expectTouchTarget(confirm);
    const box = (await confirm.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    await workspace.duplicateDialog().getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(workspace.trigger()).toBeFocused();
    await workspace.expectNoPageOverflow();
    if (width === 320) await workspace.capture(`${testInfo.project.name}-chat-actions-320`);
  }
});

test('the session menu should confirm deletion and archive through the shared backend', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new ChatActionsPage(page);
  await workspace.openSession();
  // Act
  await workspace.openActions(); await workspace.chooseAction('Delete session');
  await page.getByRole('dialog', { name: 'Delete this session?' }).getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(server.mutations).not.toContain('delete');
  await workspace.openActions(); await workspace.chooseAction('Archive session');
  await expect(page).toHaveURL(/\/sessions$/);
  await page.goto('/session/real-session');
  await workspace.openActions(); await workspace.chooseAction('Delete session');
  await page.getByRole('dialog', { name: 'Delete this session?' }).getByRole('button', { name: 'Delete session', exact: true }).click();
  // Assert
  await expect(page).toHaveURL(/\/sessions$/);
  expect(server.mutations).toContain('archive');
  expect(server.mutations).toContain('delete');
});

test('appearance should omit the fixed Rayno theme and usage should show agent icons', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new ChatActionsPage(page);
  await page.goto('/sessions');
  // Act / Assert
  const usage = workspace.usageSummary();
  await expect(usage.getByRole('img', { name: 'Claude', exact: true })).toBeVisible();
  await expect(usage.getByRole('img', { name: 'Codex', exact: true })).toBeVisible();
  await expect(usage.getByText('Claude', { exact: true })).toHaveCount(0);
  await expect(usage.getByText('Codex', { exact: true })).toHaveCount(0);
  await page.goto('/settings/appearance');
  await expect(page.getByRole('switch', { name: 'Rayno theme', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Rayno theme', exact: true })).toHaveCount(0);
});
