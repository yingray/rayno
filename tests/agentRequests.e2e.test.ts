import { test, expect } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { AgentRequestsPage } from './pages/AgentRequestsPage';
import type { Json } from '../src/happy/normalize';

const viewports = [[320, 640], [360, 740], [390, 844], [430, 900], [360, 350], [844, 390]];
// The communication shape from happy-app sync/storageTypes.ts AgentCommunicationSchema.
const form = { kind: 'form', createdAt: 1700000001500, toolUseId: 'call-1', form: { questions: [
  { id: 'scope', header: 'Scope', question: 'How large should the change be?', options: [{ label: 'Small change', description: 'Keep the patch focused.' }] },
  { id: 'note', header: 'Note', question: 'Anything else?', options: [], allowCustom: true, required: false },
] } };

async function withAgentState(server: HappyServer, state: Json) {
  server.sessions[0].agentState = await server.encryption.encrypt(state, server.dataKey);
}

for (const [width, height] of viewports) {
  test(`a question form should cancel with the form kind at ${width}x${height}`, async ({ page }, testInfo) => {
    // Arrange
    const server = new HappyServer();
    await server.install(page);
    await page.setViewportSize({ width, height });
    await withAgentState(server, { communications: { question: form } });
    const workspace = new AgentRequestsPage(page);
    await workspace.openSession();
    const touch = !!testInfo.project.use.hasTouch;
    // Act
    await expect(workspace.requests().getByText('How large should the change be?', { exact: true })).toBeVisible();
    await workspace.expectRequestUsable(touch);
    if (width === 320) await workspace.capture(`${testInfo.project.name}-question-cancel-320`);
    await workspace.tapOrClickDismiss(touch);
    // Assert
    await expect.poll(() => server.communicationReplies).toEqual([{ id: 'question', kind: 'form', status: 'cancelled' }]);
    await expect(workspace.requests()).toHaveCount(0);
  });
  test(`an unsupported communication kind should offer a cancel at ${width}x${height}`, async ({ page }, testInfo) => {
    // Arrange
    const server = new HappyServer();
    await server.install(page);
    await page.setViewportSize({ width, height });
    await withAgentState(server, { communications: { pick: { kind: 'file-pick', createdAt: 1700000001500, title: 'Choose a file to review' } } });
    const workspace = new AgentRequestsPage(page);
    await workspace.openSession();
    const touch = !!testInfo.project.use.hasTouch;
    // Act
    await expect(workspace.requests().getByText('Choose a file to review', { exact: true })).toBeVisible();
    await expect(workspace.requests()).toContainText('Rayno cannot show a “file-pick” request.');
    await expect(workspace.requests()).not.toContainText('Happy app');
    await workspace.expectRequestUsable(touch);
    if (width === 320) await workspace.capture(`${testInfo.project.name}-unsupported-request-320`);
    await workspace.tapOrClickDismiss(touch);
    // Assert
    await expect.poll(() => server.communicationReplies).toEqual([{ id: 'pick', kind: 'file-pick', status: 'cancelled' }]);
    await expect(workspace.requests()).toHaveCount(0);
  });
}

test('a question form should send only answered questions with the form kind', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const checks = { id: 'checks', header: 'Checks', question: 'Which checks should run?', options: [{ label: 'Lint' }, { label: 'Tests' }], multiSelect: true, required: false };
  const withChecks = { ...form, form: { questions: [...form.form.questions, checks] } };
  await withAgentState(server, { communications: { question: withChecks, empty: { kind: 'form', form: { questions: [] } } } });
  const workspace = new AgentRequestsPage(page);
  await workspace.openSession();
  // Act
  await expect(workspace.requests().getByText('Choose as many as apply', { exact: true })).toBeVisible();
  await workspace.requests().getByLabel('Small change', { exact: true }).check();
  await workspace.requests().getByLabel('Lint', { exact: true }).check();
  await workspace.requests().getByLabel('Tests', { exact: true }).check();
  await workspace.submitQuestion();
  // Assert
  await expect.poll(() => server.communicationReplies).toEqual([
    { id: 'question', kind: 'form', status: 'answered', answers: { scope: { options: ['Small change'] }, checks: { options: ['Lint', 'Tests'] } } },
  ]);
  await expect(workspace.requests()).toHaveCount(0);
});
