import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { SideChatsPage } from './pages/SideChatsPage';

// happy-cli runClaude writes parentSessionId from HAPPY_FORKED_FROM_SESSION_ID and isSideChat from HAPPY_SIDE_CHAT.
async function withSideChats(server: HappyServer) {
  await server.addSession('side-1', { parentSessionId: 'real-session', isSideChat: true, claudeSessionId: 'side-provider-1' },
    { createdAt: 1700000005000 });
  await server.addSession('side-2', { parentSessionId: 'real-session', isSideChat: true, claudeSessionId: 'side-provider-2',
    summary: { text: 'Check the parser' } }, { createdAt: 1700000006000 });
  await server.addSession('side-closed', { parentSessionId: 'real-session', isSideChat: true, claudeSessionId: 'side-provider-3',
    lifecycleState: 'archived', archivedBy: 'cli', archiveReason: 'User terminated' }, { active: false, createdAt: 1700000004000 });
  await server.addSession('fork-1', { parentSessionId: 'real-session', claudeSessionId: 'fork-provider', summary: { text: 'Forked workspace' } },
    { createdAt: 1700000007000 });
  await server.setMessages([
    { role: 'user', content: { type: 'text', text: 'Side question' } },
    { role: 'session', content: { role: 'agent', turn: 't1', ev: { t: 'text', text: 'Side answer' } } },
  ], 'side-1');
}
async function prepare(server: HappyServer, flavor: 'claude' | 'codex') {
  await server.updateMetadata({ flavor, [flavor === 'codex' ? 'codexThreadId' : 'claudeSessionId']: 'original-provider-id' });
}
const sideSends = (server: HappyServer, id: string) =>
  server.requests.filter((request) => request.method === 'POST' && request.path === `/v3/sessions/${id}/messages`);

test('side chats should stay out of the session list and open beside the parent on a wide screen', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page); await withSideChats(server);
  const workspace = new SideChatsPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await workspace.openSession();
  // Act / Assert: the list keeps the regular fork and hides every side chat.
  await expect(workspace.sessionList().getByText('Forked workspace', { exact: true })).toBeVisible();
  await expect(workspace.sessionList().getByText(/Side chat|Check the parser/)).toHaveCount(0);
  await workspace.headerButton().click();
  await expect(page).toHaveURL(/\/session\/real-session\/side$/);
  await expect(workspace.panel()).toBeVisible();
  await expect(workspace.sessionList()).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Chat session', exact: true })).toBeVisible();
  await expect(workspace.tabs().getByRole('button', { name: /^(Side chat 1|Check the parser)$/ })).toHaveCount(2);
  await expect(workspace.tab('Check the parser')).toHaveAttribute('aria-pressed', 'true');
  await workspace.tab('Side chat 1').click();
  await expect(workspace.sideChat().getByText('Side answer', { exact: true })).toBeVisible();
  await workspace.expectComposerFits();
  await workspace.sideChat().getByRole('textbox', { name: 'Message', exact: true }).fill('One more side question');
  await workspace.sideChat().getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => sideSends(server, 'side-1').length).toBe(1);
  expect(sideSends(server, 'real-session')).toHaveLength(0);
  await workspace.close('Side chat 1').click();
  await expect(workspace.tab('Side chat 1')).toHaveCount(0);
  expect(server.mutations).toContain('side-1:killSession');
  await expect(workspace.tab('Check the parser')).toHaveAttribute('aria-pressed', 'true');
  await expect(workspace.panel().getByText('Closed side chats (2)', { exact: true })).toBeVisible();
  await workspace.panel().getByRole('button', { name: 'Open side chat in full view', exact: true }).click();
  await expect(page).toHaveURL(/\/session\/side-2$/);
  await expect(page.getByRole('region', { name: 'Chat session', exact: true }).getByText('Side chat', { exact: true })).toBeVisible();
  await workspace.expectTouchTarget(workspace.parentBack());
  await workspace.parentBack().click();
  await expect(page).toHaveURL(/\/session\/real-session\/side$/);
  await expect(workspace.tab('Check the parser')).toHaveAttribute('aria-pressed', 'true');
  await workspace.panel().getByRole('button', { name: 'Close side chats', exact: true }).click();
  await expect(page).toHaveURL(/\/session\/real-session$/);
  await expect(workspace.sessionList()).toBeVisible();
  await expect(workspace.headerButton()).toHaveAccessibleName('Side chats, 1 open');
});

for (const flavor of ['claude', 'codex'] as const) {
  test(`a new ${flavor} side chat should fork the provider conversation with the side chat marker and explicit modes`, async ({ page }) => {
    // Arrange
    const server = new HappyServer();
    await server.install(page); await prepare(server, flavor);
    const workspace = new SideChatsPage(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await workspace.openSession();
    await workspace.headerButton().click();
    // Act
    await workspace.panel().getByRole('button', { name: 'Start a side chat', exact: true }).click();
    // Assert
    await expect(workspace.tab('Side chat 1')).toHaveAttribute('aria-pressed', 'true');
    await expect(workspace.sideChat().getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
    expect(server.branchCalls).toEqual([{ method: `computer:${flavor === 'codex' ? 'codex-fork-thread' : 'claude-fork-session'}`,
      params: { directory: '/real/project', [flavor === 'codex' ? 'codexThreadId' : 'claudeSessionId']: 'original-provider-id' } }]);
    expect(server.spawns).toHaveLength(1);
    expect(server.spawns[0]).toMatchObject({ type: 'spawn-in-directory', agent: flavor, directory: '/real/project',
      parentSessionId: 'real-session', isSideChat: true, approvedNewDirectoryCreation: false,
      [flavor === 'codex' ? 'resumeCodexThreadId' : 'resumeClaudeSessionId']: `copied-${flavor}-id` });
    expect(server.spawns[0].modelMode).toBe('model-from-daemon');
    expect(server.spawns[0].permissionMode).toBeTruthy();
    expect(server.sends).toHaveLength(0);
    await expect(page).toHaveURL(/\/session\/real-session\/side$/);
    await workspace.panel().getByRole('button', { name: 'Close side chats', exact: true }).click();
    await expect(workspace.sessionList().getByText('Connected workspace', { exact: true })).toBeVisible();
    await expect(workspace.sessionList().getByText(/Side chat|Created workspace/)).toHaveCount(0);
  });
}

test('side chats should open from the session menu on phones, tablets, and short screens', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page); await withSideChats(server);
  const workspace = new SideChatsPage(page);
  await workspace.openSession();
  test.setTimeout(90000);
  // Act / Assert
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 932], [360, 350], [844, 390], [1024, 768]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByText('From the real protocol', { exact: true })).toBeVisible();
    await workspace.openFromMenu();
    await expect(page).toHaveURL(/\/session\/real-session\/side$/);
    if (width < 768) await expect(page.getByRole('heading', { name: 'Side chats', exact: true, level: 1 })).toBeVisible();
    else await expect(page.getByRole('dialog', { name: 'Side chats', exact: true })).toBeVisible();
    await expect(workspace.row('Side chat 1')).toBeVisible();
    await expect(workspace.row('Check the parser')).toBeVisible();
    await expect(workspace.row('Side chat 2')).toHaveCount(0);
    await workspace.expectUsableList();
    if (width === 320) await workspace.capture(`${testInfo.project.name}-side-chats-320`);
    if (width === 844) await workspace.capture(`${testInfo.project.name}-side-chats-landscape`);
    await workspace.row('Side chat 1').click();
    await expect(page).toHaveURL(/\/session\/side-1$/);
    await expect(page.getByText('Side answer', { exact: true })).toBeVisible();
    await workspace.expectInViewport(workspace.parentBack());
    await workspace.expectTouchTarget(workspace.parentBack());
    const message = page.getByRole('textbox', { name: 'Message', exact: true });
    await message.focus();
    if (width < 768) await expect(message).toHaveCSS('font-size', '16px');
    await workspace.expectInViewport(page.getByRole('button', { name: 'Send message', exact: true }));
    await workspace.expectNoPageOverflow();
    await workspace.parentBack().click();
    await expect(page).toHaveURL(/\/session\/real-session\/side$/);
    await expect(workspace.row('Side chat 1')).toBeVisible();
    await page.getByRole('button', { name: width < 768 ? 'Back to chat' : 'Close Side chats', exact: true }).click();
    await expect(page).toHaveURL(/\/session\/real-session$/);
  }
});

test('a phone side chat list should create a side chat and open it full size', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page); await prepare(server, 'claude');
  const workspace = new SideChatsPage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/session/real-session/side');
  // Act
  await workspace.panel().getByRole('button', { name: 'New side chat', exact: true }).click();
  // Assert
  await expect(page).toHaveURL(/\/session\/created-session$/);
  // Happy Web SideChatModal titles a side chat with the same number as the parent's list.
  await expect(page.getByRole('region', { name: 'Chat session', exact: true }).getByText('Side chat 1', { exact: true })).toBeVisible();
  // The tab attention count can lead the title.
  await expect(page).toHaveTitle(/^(\(\d+\) )?Rayno · Side chat 1$/);
  expect(server.spawns[0]).toMatchObject({ isSideChat: true, parentSessionId: 'real-session', resumeClaudeSessionId: 'copied-claude-id' });
  await workspace.parentBack().click();
  await expect(workspace.row('Side chat 1')).toBeVisible();
  await workspace.panel().getByRole('button', { name: 'Back to chat', exact: true }).click();
  await expect(page).toHaveURL(/\/session\/real-session$/);
});

test('saved side chats should stay readable offline and block a new side chat', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page); await withSideChats(server);
  const workspace = new SideChatsPage(page);
  await page.goto('/session/side-1');
  await expect(page.getByText('Side answer', { exact: true })).toBeVisible();
  await expect.poll(async () => (await workspace.offlineRecords()).some((row) => row.key.endsWith('history.side-1'))).toBe(true);
  // Act
  await workspace.setNetwork(false);
  await page.goto('/session/real-session/side');
  // Assert
  await expect(workspace.panel().getByText('Reconnect to start a side chat.', { exact: true })).toBeVisible();
  await expect(workspace.newButton()).toBeDisabled();
  const sideChat = page.viewportSize()!.width >= 1280 ? workspace.tab('Side chat 1') : workspace.row('Side chat 1');
  await sideChat.click();
  await expect(page.getByText('Side answer', { exact: true })).toBeVisible();
  const offlineRecords = JSON.stringify(await workspace.offlineRecords());
  expect(offlineRecords).not.toContain('Side answer');
  expect(offlineRecords).not.toContain('side-provider-1');
});

test('an ended side chat that the user did not close should stay open with a resume path and still close', async ({ page }) => {
  // Arrange: happy-cli keeps lifecycleState 'running' when the CLI stops without a close; the server sets active=false.
  const server = new HappyServer();
  server.machineMetadata.resumeSupport = { rpcAvailable: true };
  await server.install(page); await prepare(server, 'claude');
  await server.addSession('side-open', { parentSessionId: 'real-session', isSideChat: true, claudeSessionId: 'side-provider-1' },
    { createdAt: 1700000005000 });
  await server.addSession('side-ended', { parentSessionId: 'real-session', isSideChat: true, claudeSessionId: 'side-provider-2',
    lifecycleState: 'running' }, { active: false, createdAt: 1700000006000 });
  const workspace = new SideChatsPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await workspace.openSession();
  // Act / Assert: the wide panel keeps the ended side chat as a numbered tab.
  await expect(workspace.headerButton()).toHaveAccessibleName('Side chats, 2 open');
  await workspace.headerButton().click();
  await expect(workspace.tab('Side chat 2')).toHaveAttribute('aria-pressed', 'true');
  await expect(workspace.panel().getByText('Ended', { exact: true })).toBeVisible();
  await expect(workspace.sideChat().getByRole('button', { name: 'Resume session', exact: true })).toBeVisible();
  await expect(workspace.panel().getByText(/Closed side chats/)).toHaveCount(0);
  // Act / Assert: on a phone, the full view offers Resume and Close, and Close returns to the parent list.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(workspace.row('Side chat 2')).toContainText('Ended');
  await workspace.row('Side chat 2').click();
  await expect(page).toHaveURL(/\/session\/side-ended$/);
  await expect(page.getByRole('region', { name: 'Chat session', exact: true }).getByText('Side chat 2', { exact: true })).toBeVisible();
  await workspace.openActions();
  await expect(workspace.menu().getByRole('menuitem', { name: 'Resume session', exact: true })).toBeVisible();
  await workspace.chooseAction('Close side chat');
  await expect(page).toHaveURL(/\/session\/real-session\/side$/);
  await expect(workspace.panel().getByText('Closed side chats (1)', { exact: true })).toBeVisible();
  await expect(workspace.row('Side chat 1')).toBeVisible();
  await expect(workspace.row('Side chat 2')).toHaveCount(0);
  const metadata = await server.encryption.decrypt<Record<string, unknown>>(server.sessions.find((item) => item.id === 'side-ended')!.metadata, server.dataKey);
  expect(metadata.lifecycleState).toBe('archived');
});

test('closing a side chat from Session info should return to the parent side chat list', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page); await withSideChats(server);
  const workspace = new SideChatsPage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/session/side-1/info');
  // Act
  await page.getByRole('button', { name: 'Close side chat', exact: true }).click();
  // Assert
  await expect(page).toHaveURL(/\/session\/real-session\/side$/);
  expect(server.mutations).toContain('side-1:killSession');
  await expect(workspace.row('Side chat 1')).toHaveCount(0);
  await expect(workspace.panel().getByText('Closed side chats (2)', { exact: true })).toBeVisible();
});

test('a Happy Agent parent should hide the side chat entry until it has side chats', async ({ page }) => {
  // Arrange: Happy Web offers side chats only for a Claude or Codex session that it can fork.
  const server = new HappyServer();
  await server.install(page);
  await server.updateMetadata({ flavor: 'rig', client: { id: 'rig' } });
  const workspace = new SideChatsPage(page);
  await workspace.openSession();
  // Act
  await workspace.openActions();
  // Assert
  await expect(workspace.menu().getByRole('menuitem', { name: /^Side chats/ })).toHaveCount(0);
  await expect(workspace.headerButton()).toHaveCount(0);
});

test('a side chat without a known parent should return to the session list', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.addSession('orphan-side', { parentSessionId: 'deleted-parent', isSideChat: true, claudeSessionId: 'orphan-provider' });
  const workspace = new SideChatsPage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/session/orphan-side');
  // Act
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click();
  // Assert
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(workspace.parentBack()).toHaveCount(0);
});

const phoneSizes = [[320, 568], [360, 640], [390, 844], [430, 932], [390, 430], [844, 390]];
const desktopSizes = [[1440, 900], [1024, 768]];

test('a side chat should ask before it creates a missing folder, copy again after Cancel, and start after Create folder', async ({ page }, testInfo) => {
  // Arrange: happy-cli daemon/run.ts spawnSession answers requestToApproveDirectoryCreation for a missing folder.
  const server = new HappyServer();
  server.missingDirectories = ['/real/project'];
  await server.install(page); await prepare(server, 'claude');
  const workspace = new SideChatsPage(page);
  const touch = !!testInfo.project.use.hasTouch;
  const sizes = touch ? phoneSizes : desktopSizes;
  const folder = workspace.folderDialog();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: sizes[0][0], height: sizes[0][1] });
  await page.goto('/session/real-session/side');
  test.setTimeout(90000);
  // Act / Assert
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await workspace.newButton().click();
    await workspace.expectPromptUsable(folder, '/real/project', ['Close Create this folder?', 'Cancel', 'Create folder']);
    await expect(workspace.panel().getByRole('alert')).toHaveCount(0);
    if (width === 320 || width === 844 || width === 1440) await workspace.capture(`${testInfo.project.name}-side-chat-folder-${width}`);
    if (width >= 768 && width < 1280) {
      // Escape closes only the folder question, not the side chat drawer under it.
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Side chats', exact: true })).toBeVisible();
    } else await workspace.press(folder, 'Cancel', touch);
    await expect(folder).toBeHidden();
    await expect(page).toHaveURL(/\/session\/real-session\/side$/);
  }
  // Act
  await page.setViewportSize({ width: sizes[0][0], height: sizes[0][1] });
  await workspace.newButton().click();
  await workspace.press(folder, 'Create folder', touch);
  // Assert
  if (sizes[0][0] >= 1280) await expect(workspace.tab('Side chat 1')).toHaveAttribute('aria-pressed', 'true');
  else await expect(page).toHaveURL(/\/session\/created-session$/);
  await expect(folder).toHaveCount(0);
  // Cancel drops the copied conversation, so each later side chat copies the current conversation again.
  expect(server.branchCalls.map((call) => call.method)).toEqual(Array(sizes.length + 1).fill('computer:claude-fork-session'));
  expect(server.spawns).toHaveLength(sizes.length + 2);
  expect(server.spawns.slice(0, -1).every((spawn) => !spawn.approvedNewDirectoryCreation)).toBe(true);
  expect(server.spawns.at(-1)).toMatchObject({ directory: '/real/project', approvedNewDirectoryCreation: true, isSideChat: true,
    resumeClaudeSessionId: 'copied-claude-id', parentSessionId: 'real-session' });
});

const worktree = '/real/project/.dev/worktree/feature-check';
for (const from of ['the session menu', 'Session info', 'the side chat list'] as const) {
  test(`closing a side chat from ${from} should not offer the parent's worktree`, async ({ page }) => {
    // Arrange: the parent ended, and its only side chat runs in the parent's clean worktree.
    const server = new HappyServer();
    server.gitStatus = '';
    await server.install(page);
    await server.updateMetadata({ path: worktree, claudeSessionId: 'original-provider-id' });
    server.setSessionActive('real-session', false);
    await server.addSession('side-1', { parentSessionId: 'real-session', isSideChat: true, claudeSessionId: 'side-provider-1' });
    const workspace = new SideChatsPage(page);
    await page.setViewportSize({ width: 390, height: 844 });
    // Act
    if (from === 'the side chat list') {
      await page.goto('/session/real-session/side');
      await workspace.close('Side chat 1').click();
    } else if (from === 'Session info') {
      await page.goto('/session/side-1/info');
      await page.getByRole('button', { name: 'Close side chat', exact: true }).click();
    } else {
      await page.goto('/session/side-1');
      await workspace.openActions(); await workspace.chooseAction('Close side chat');
    }
    // Assert: every close path archives the side chat the same way, without a worktree check.
    await expect(page).toHaveURL(/\/session\/real-session\/side$/);
    await expect(workspace.panel().getByText('Closed side chats (1)', { exact: true })).toBeVisible();
    await expect(workspace.worktreeDialog()).toHaveCount(0);
    expect(server.mutations).toContain('side-1:killSession');
    expect(server.bashCommands).toEqual([]);
  });
}


test('side chats should restore the open panel and selected chat after a session switch until explicitly closed', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page); await withSideChats(server);
  const workspace = new SideChatsPage(page);
  const phone = page.viewportSize()!.width < 768;
  await workspace.openSession();
  if (phone) await workspace.openFromMenu();
  else await workspace.headerButton().click();
  await expect(workspace.panel()).toBeVisible();
  if (!phone) await workspace.tab('Side chat 1').click();
  // Act
  await workspace.switchSession('Forked workspace');
  await expect(page).toHaveURL(/\/session\/fork-1$/);
  await expect(workspace.panel()).toHaveCount(0);
  await workspace.switchSession('Connected workspace');
  // Assert
  await expect(page).toHaveURL(/\/session\/real-session\/side$/);
  await expect(workspace.panel()).toBeVisible();
  if (!phone) await expect(workspace.tab('Side chat 1')).toHaveAttribute('aria-pressed', 'true');
  // Act: a deliberate close must survive the next switch.
  await workspace.closePanel();
  await workspace.switchSession('Forked workspace');
  await workspace.switchSession('Connected workspace');
  // Assert
  await expect(page).toHaveURL(/\/session\/real-session$/);
  await expect(workspace.panel()).toHaveCount(0);
});

test('side chat unread dots should remain on the entry and list until the reply is viewed at every phone size', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page); await withSideChats(server);
  const workspace = new SideChatsPage(page);
  await workspace.openSession();
  test.setTimeout(90000);
  // Act / Assert
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 932], [360, 350], [844, 390]]) {
    await page.setViewportSize({ width, height });
    const reply = `Unread side reply at ${width}x${height}`;
    await server.pushEvent({ role: 'session', content: { role: 'agent', turn: reply, ev: { t: 'text', text: reply } } }, 'side-1');
    await expect(page.getByRole('button', { name: 'Session actions', exact: true }).getByRole('img', { name: 'New reply' })).toBeVisible();
    await workspace.openActions();
    await expect(workspace.menu().getByRole('menuitem', { name: /^Side chats/ }).getByRole('img', { name: 'New reply' })).toBeVisible();
    await workspace.menu().getByRole('menuitem', { name: /^Side chats/ }).click();
    await expect(workspace.row('Side chat 1').getByRole('img', { name: 'New reply' })).toBeVisible();
    await workspace.expectUsableList();
    if (width === 320) await workspace.capture(`${testInfo.project.name}-side-unread-320`);
    await workspace.press(workspace.panel(), 'Open Side chat 1', !!testInfo.project.use.hasTouch);
    await expect(page.getByText(reply, { exact: true })).toBeAttached();
    if (await workspace.latestShortcut().isVisible()) await workspace.returnToLatest();
    await expect(page.getByText(reply, { exact: true })).toBeInViewport();
    const message = page.getByRole('textbox', { name: 'Message', exact: true });
    await message.click();
    await workspace.expectInViewport(page.getByRole('button', { name: 'Send message', exact: true }));
    await workspace.parentBack().click();
    await expect(workspace.row('Side chat 1').getByRole('img', { name: 'New reply' })).toHaveCount(0);
    await workspace.closePanel();
    await expect(page.getByRole('button', { name: 'Session actions', exact: true }).getByRole('img', { name: 'New reply' })).toHaveCount(0);
  }
});

test('side chat unread dots should mark the desktop entry and inactive tab then clear after reading', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page); await withSideChats(server);
  const workspace = new SideChatsPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await workspace.openSession();
  // Act
  await server.pushEvent({ role: 'session', content: { role: 'agent', turn: 'unread', ev: { t: 'text', text: 'Desktop side reply' } } }, 'side-1');
  // Assert
  await expect(workspace.headerButton().getByRole('img', { name: 'New reply' })).toBeVisible();
  await workspace.headerButton().click();
  await expect(workspace.tab('Side chat 1').getByRole('img', { name: 'New reply' })).toBeVisible();
  // Act
  await workspace.tab('Side chat 1').click();
  await expect(workspace.sideChat().getByText('Desktop side reply', { exact: true })).toBeInViewport();
  await workspace.sideChat().getByRole('textbox', { name: 'Message', exact: true }).click();
  // Assert
  await expect(workspace.tab('Side chat 1').getByRole('img', { name: 'New reply' })).toHaveCount(0);
  await workspace.closePanel();
  await expect(workspace.headerButton().getByRole('img', { name: 'New reply' })).toHaveCount(0);
});
