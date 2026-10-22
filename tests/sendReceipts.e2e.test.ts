import { test, expect } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { AgentRequestsPage } from './pages/AgentRequestsPage';
import type { Json } from '../src/happy/normalize';

const viewports = [[320, 640], [360, 740], [390, 844], [430, 900], [360, 350], [844, 390]];

async function withAgentState(server: HappyServer, state: Json) {
  server.sessions[0].agentState = await server.encryption.encrypt(state, server.dataKey);
}

// From happy-app sync/__testdata__/rigMetadata.ts, with the receipt capability that the daemon advertises.
const rigMetadata = {
  rigMetadataVersion: 1, flavor: 'codex', client: { id: 'rig', name: 'Rig', version: '0.0.30' },
  models: [{ providerId: 'codex', providerName: 'OpenAI Codex', id: 'shared-model', name: 'GPT Shared', thinkingLevels: ['low', 'high'], defaultThinkingLevel: 'high' }],
  lastMode: { modelId: 'shared-model', providerId: 'codex', effort: 'high', permissionMode: 'auto', serviceTier: null },
  capabilities: { abort: true, modelSelection: true, reasoningSelection: true, permissionModeSelection: true, resume: false, shell: true,
    rpcMethods: ['abort', 'bash'], messageReceipts: true },
};

for (const [width, height] of viewports) {
  test(`Happy Agent receipts should settle, queue, and reject sent messages at ${width}x${height}`, async ({ page }, testInfo) => {
    // Arrange
    const server = new HappyServer();
    await server.install(page);
    await page.setViewportSize({ width, height });
    const metadata = await server.encryption.decrypt<Json>(server.sessions[0].metadata, server.dataKey);
    server.sessions[0].metadata = await server.encryption.encrypt({ ...metadata, ...rigMetadata }, server.dataKey);
    await withAgentState(server, {});
    const workspace = new AgentRequestsPage(page);
    await workspace.openSession();
    // Act
    await workspace.send('Check the build');
    await workspace.expectDraft('');
    // Assert
    await workspace.expectSendState('Check the build', 'Sending…');
    await expect(workspace.userMessage('Check the build').locator('[data-pending]')).toHaveCSS('opacity', '0.45');
    const first = await server.encryption.decrypt<Json>(server.sends[0].content, server.dataKey);
    expect(first.meta).toMatchObject({ expectsAcceptance: true, queuedWhileBusy: false });
    await server.pushReceipt('sent-' + server.sends[0].localId);
    await workspace.expectSendState('Check the build', null);
    // Act
    await server.setWorking(true);
    await workspace.send('Use the small model');
    await workspace.expectDraft('');
    await workspace.expectSendState('Use the small model', 'Sends after this turn');
    await server.pushReply('Still on the build');
    // Assert
    await workspace.expectLastMessage('Use the small model');
    const second = await server.encryption.decrypt<Json>(server.sends[1].content, server.dataKey);
    expect(second.meta).toMatchObject({ expectsAcceptance: true, queuedWhileBusy: true });
    await server.pushReceipt('sent-' + server.sends[1].localId, 'That model is not available.');
    await workspace.expectSendState('Use the small model', 'Not sent: That model is not available.');
    await workspace.expectNoPageOverflow();
    if (width === 320) await workspace.capture(`${testInfo.project.name}-receipts-320`);
    await page.reload();
    await workspace.expectSendState('Use the small model', 'Not sent: That model is not available.');
    await workspace.expectSendState('Check the build', null);
    await workspace.expectLastMessage('Use the small model');
  });
}

test('a session without receipt support should not hold or label sent messages', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await withAgentState(server, {});
  const workspace = new AgentRequestsPage(page);
  await workspace.openSession();
  // Act
  await workspace.send('Plain Claude message');
  await workspace.expectDraft('');
  // Assert
  await workspace.expectSendState('Plain Claude message', null);
  const raw = await server.encryption.decrypt<Json>(server.sends[0].content, server.dataKey);
  expect(raw.meta).not.toHaveProperty('expectsAcceptance');
});

async function openRigSession(server: HappyServer, page: import('@playwright/test').Page, width: number, height: number) {
  await server.install(page);
  await page.setViewportSize({ width, height });
  const metadata = await server.encryption.decrypt<Json>(server.sessions[0].metadata, server.dataKey);
  server.sessions[0].metadata = await server.encryption.encrypt({ ...metadata, ...rigMetadata }, server.dataKey);
  await withAgentState(server, {});
  const workspace = new AgentRequestsPage(page);
  await workspace.openSession();
  return workspace;
}
const options = 'Pick the next step:\n\n<options><option>Ship it</option><option>Wait</option></options>';

for (const [width, height] of [[320, 640], [390, 844], [844, 390]]) {
  test(`Happy Agent reply options should reopen after a rejected answer and close only after acceptance at ${width}x${height}`, async ({ page }) => {
    // Arrange
    const server = new HappyServer();
    const workspace = await openRigSession(server, page, width, height);
    await server.pushReply(options);
    const buttons = workspace.replyOptions().getByRole('button');
    await expect(buttons.first()).toBeEnabled();
    // Act
    await workspace.selectReply('Ship it');
    // Assert
    await workspace.expectSendState('Ship it', 'Sending…');
    await expect(buttons.first()).toBeDisabled();
    // Act
    await server.pushReceipt('sent-' + server.sends[0].localId, 'That model is not available.');
    // Assert
    await workspace.expectSendState('Ship it', 'Not sent: That model is not available.');
    await expect(buttons.first()).toBeEnabled();
    // The rejected message is not a turn, so the reply before it keeps its Recap action.
    await expect(page.getByRole('button', { name: 'Recap this reply', exact: true })).toBeVisible();
    await workspace.expectReplyTargetsReachable();
    await workspace.showSessions();
    await expect(workspace.indicator('Needs input')).toBeVisible();
    // Act
    await workspace.openRow();
    await workspace.selectReply('Wait');
    await expect(buttons.first()).toBeDisabled();
    await server.pushReceipt('sent-' + server.sends[1].localId);
    // Assert
    await workspace.expectSendState('Wait', null);
    await expect(buttons.first()).toBeDisabled();
    await workspace.showSessions();
    await expect(workspace.indicator('Needs input')).toHaveCount(0);
    await workspace.expectNoPageOverflow();
    expect(server.sends).toHaveLength(2);
  });
}

test('a queued message that the agent accepts after the turn options should answer them in the chat and the session list', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  const workspace = await openRigSession(server, page, 390, 844);
  await server.setWorking(true);
  await workspace.send('Steer to the tests');
  await workspace.expectSendState('Steer to the tests', 'Sends after this turn');
  // Act
  await server.pushReply(options);
  await server.setWorking(false);
  // Assert
  await expect(workspace.replyOptions().getByRole('button').first()).toBeEnabled();
  await workspace.expectLastMessage('Steer to the tests');
  // Act
  await server.pushReceipt('sent-' + server.sends[0].localId);
  // Assert
  await workspace.expectSendState('Steer to the tests', null);
  await workspace.expectLastMessage('Steer to the tests');
  await expect(workspace.replyOptions().getByRole('button').first()).toBeDisabled();
  await workspace.showSessions();
  await expect(workspace.indicator('Needs input')).toHaveCount(0);
  await page.reload();
  await workspace.showSessions();
  await expect(workspace.indicator('Needs input')).toHaveCount(0);
});
