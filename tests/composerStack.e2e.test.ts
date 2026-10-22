import { expect, test, type Page } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { ComposerStackPage } from './pages/ComposerStackPage';

const todos = [
  { content: 'Read the Happy goal sources', status: 'completed', activeForm: 'Reading the Happy goal sources' },
  { content: 'Port the goal bar above the composer', status: 'in_progress', activeForm: 'Porting the goal bar' },
];
// happy-cli claude/utils/sessionProtocolMapper.ts envelopes. The mapper puts the usage on the last envelope of a reply.
const envelope = (id: string, ev: object, extra: object = {}) => ({ role: 'session', content: {
  id, time: 1700000001000, role: 'agent', turn: 'cmh1turn00000000000000000', ev, ...extra,
}, meta: { sentFrom: 'cli' } });
const usage = { input_tokens: 4000, cache_read_input_tokens: 186000, output_tokens: 120, context_window: 200000 };
// happy-cli claude/claudeGoalStatus.ts, and runClaude.ts `controlledByUser: mode === 'local'`.
const goal = { source: 'claude', observedAt: 1700000001000, sourceSessionId: 'claude-session-1',
  sourceRevision: 'a3f1c2d4-0b7e-4c55-9a3e-2f8f1d1f0b01', status: 'active', capabilities: { clear: true, edit: true },
  text: 'Finish the goal and todo port with phone checks, then report the remaining gaps' };

async function open(page: Page) {
  const server = new HappyServer();
  await server.install(page);
  await server.updateMetadata({ claudeSessionId: 'claude-session-1', slashCommands: ['compact', 'pr-review'] });
  await server.updateAgentState({ controlledByUser: true, requests: {}, agentGoalStatus: goal });
  await server.setMessages([
    { role: 'user', content: { type: 'text', text: 'Port the goal bar' } },
    envelope('cmh1todo1', { t: 'tool-call-start', call: 'toolu_todo', name: 'TodoWrite', title: 'TodoWrite call', description: 'TodoWrite call', args: { todos } }),
    envelope('cmh1todo2', { t: 'tool-call-end', call: 'toolu_todo' }),
    envelope('cmh1reply', { t: 'text', text: 'I updated the todo list.' }, { usage }),
  ]);
  const workspace = new ComposerStackPage(page);
  await page.goto('/session/real-session');
  await expect(page.getByText('I updated the todo list.', { exact: true })).toBeVisible();
  await workspace.expectConnected();
  return { server, workspace };
}

for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 360], [844, 390]]) {
  test(`terminal control, goal, todo, context, and suggestions should share the composer area at ${width}x${height}`, async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone sizes use the mobile projects.');
    // Arrange
    await page.setViewportSize({ width, height });
    const { server, workspace } = await open(page);
    // Assert: every row shows, in order, with reachable controls.
    await expect(workspace.notice()).toBeVisible();
    await expect(workspace.dock()).toBeVisible();
    await expect(workspace.context()).toHaveAttribute('data-tone', 'critical');
    const space = await workspace.expectStacked();
    expect(space).toBeGreaterThanOrEqual(height <= 400 ? 40 : 120);
    for (const control of [workspace.takeControl(), workspace.todoChip()]) await workspace.expectReachable(control);
    await workspace.expectNoPageOverflow();
    await workspace.capture(`${testInfo.project.name}-composer-stack-${width}x${height}`);
    // Act: open the command suggestions.
    await workspace.input().tap();
    await workspace.input().pressSequentially('/');
    // Assert
    await workspace.expectListUsable('Command');
    await workspace.expectStacked();
    await workspace.capture(`${testInfo.project.name}-composer-stack-suggestions-${width}x${height}`);
    // Act: pick a command and send it.
    await workspace.option('Command', '/compact').tap();
    await workspace.expectDraft('/compact ');
    await workspace.expectReachable(workspace.sendButton());
    await workspace.sendButton().tap();
    // Assert
    await expect.poll(() => server.sends.length).toBe(1);
    await workspace.expectNoPageOverflow();
  });
}
