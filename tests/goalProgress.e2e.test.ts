import { expect, test, type Page } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { GoalProgressPage } from './pages/GoalProgressPage';

const goalText = 'Finish the goal and todo port with phone checks, then report the remaining gaps to the reviewer';
const todos = [
  { content: 'Read the Happy goal sources', status: 'completed', activeForm: 'Reading the Happy goal sources' },
  { content: 'Port the goal bar above the composer', status: 'in_progress', activeForm: 'Porting the goal bar' },
  { content: 'Verify phone layouts', status: 'pending', activeForm: 'Verifying phone layouts' },
];
// happy-cli claude/utils/sessionProtocolMapper.ts envelopes for one TodoWrite call.
const envelope = (ev: object) => ({ role: 'session', content: {
  id: `cmh1${JSON.stringify(ev).length}`, time: 1700000001000, role: 'agent', turn: 'cmh1turn00000000000000000', ev,
}, meta: { sentFrom: 'cli' } });
// happy-cli claude/claudeGoalStatus.ts: an unmet goal_status attachment with the confirmed actions.
const claudeGoal = (text = goalText) => ({
  source: 'claude', observedAt: 1700000001000, sourceSessionId: 'claude-session-1',
  sourceRevision: 'a3f1c2d4-0b7e-4c55-9a3e-2f8f1d1f0b01', status: 'active', text, capabilities: { clear: true, edit: true },
});

async function openGoalSession(page: Page, goal: object | null = claudeGoal()) {
  const server = new HappyServer();
  await server.install(page);
  await server.updateMetadata({ claudeSessionId: 'claude-session-1' });
  await server.updateAgentState(goal ? { agentGoalStatus: goal } : {});
  await server.setMessages([
    { role: 'user', content: { type: 'text', text: 'Port the goal bar' } },
    envelope({ t: 'tool-call-start', call: 'toolu_todo', name: 'TodoWrite', title: 'TodoWrite call', description: 'TodoWrite call', args: { todos } }),
    envelope({ t: 'tool-call-end', call: 'toolu_todo' }),
    envelope({ t: 'text', text: 'I updated the todo list.' }),
  ]);
  const workspace = new GoalProgressPage(page);
  await workspace.openGoalChat();
  await workspace.expectConnected();
  return { server, workspace };
}

for (const [width, height] of [[320, 740], [360, 740], [390, 360], [430, 844], [844, 390]]) {
  test(`goal and todo progress should stay compact and usable above the composer at ${width}x${height}`, async ({ page }, testInfo) => {
    // Arrange
    await page.setViewportSize({ width, height });
    const touch = !!testInfo.project.use.hasTouch;
    const { server, workspace } = await openGoalSession(page);
    // Act / Assert: the dock row
    await expect(workspace.goal(goalText)).toBeVisible();
    await expect(workspace.todoChip(1, 3)).toContainText('1/3');
    for (const control of [workspace.goal(goalText), workspace.todoChip(1, 3), workspace.goalAction('Edit goal'), workspace.goalAction('Clear goal')])
      await workspace.expectReachable(control, touch);
    expect((await workspace.dock().boundingBox())!.height).toBeLessThanOrEqual(56);
    // A short phone viewport gets a one-line dock, so more of the conversation stays readable.
    if (touch && height <= 500) {
      expect((await workspace.dock().boundingBox())!.height).toBeLessThanOrEqual(46);
      expect(await workspace.conversationSpace()).toBeGreaterThanOrEqual(112);
    }
    await workspace.expectDockAboveComposer();
    await workspace.expectNoPageOverflow();
    await workspace.capture(`${testInfo.project.name}-goal-dock-${width}x${height}`);
    // Act / Assert: the full goal and the todo list
    await workspace.press(workspace.goal(goalText), touch);
    const details = workspace.dialog('Current goal');
    await expect(details.getByText(goalText, { exact: true })).toBeVisible();
    await workspace.expectReachable(details.getByRole('button', { name: 'Clear goal', exact: true }), touch);
    await workspace.press(details.getByRole('button', { name: 'Close Current goal', exact: true }), touch);
    await workspace.press(workspace.todoChip(1, 3), touch);
    const list = workspace.dialog('Todo list');
    await expect(list.getByRole('list', { name: 'Todo items', exact: true }).getByRole('listitem')).toHaveText([
      'Done: Read the Happy goal sources', 'In progress: Port the goal bar above the composer', 'Pending: Verify phone layouts',
    ]);
    await workspace.press(list.getByRole('button', { name: 'Close Todo list', exact: true }), touch);
    // Act / Assert: edit, then clear
    await workspace.editGoal('Ship the goal port', touch);
    await expect(workspace.dialog('Edit goal')).toHaveCount(0);
    await expect(workspace.goal('Ship the goal port')).toBeVisible();
    await workspace.press(workspace.goalAction('Clear goal'), touch);
    await expect(workspace.dock().getByRole('button', { name: /^Current goal/ })).toHaveCount(0);
    expect(server.goalActions).toEqual([{ action: 'edit', objective: 'Ship the goal port' }, { action: 'clear' }]);
    await expect(workspace.todoChip(1, 3)).toContainText('Port the goal bar above the composer');
    await workspace.expectReachable(workspace.todoChip(1, 3), touch);
    await workspace.expectNoPageOverflow();
  });
}

test('an unchanged edit should send nothing and an agent refusal should show its error', async ({ page }, testInfo) => {
  // Arrange
  const touch = !!testInfo.project.use.hasTouch;
  const { server, workspace } = await openGoalSession(page);
  // Act
  await workspace.editGoal(`  ${goalText}  `, touch);
  server.goalFailure = 'Claude goal action is not ready while Claude is thinking';
  await workspace.press(workspace.goalAction('Clear goal'), touch);
  // Assert
  await expect(page.getByRole('alert')).toContainText('Claude goal action is not ready while Claude is thinking');
  expect(server.goalActions).toEqual([{ action: 'clear' }]);
  await expect(workspace.goal(goalText)).toBeVisible();
});

test('an ended session should hide the dock and the TodoWrite row should show its list', async ({ page }, testInfo) => {
  // Arrange
  const { server, workspace } = await openGoalSession(page);
  await expect(workspace.goal(goalText)).toBeVisible();
  // Act
  server.setSessionActive('real-session', false);
  await workspace.expandToolGroup(0);
  // Assert
  await expect(workspace.dock()).toHaveCount(0);
  const row = workspace.toolGroups().first();
  await expect(row.getByText('Todo list · 1 of 3 done', { exact: true })).toBeVisible();
  await expect(row.getByRole('list', { name: 'Todo items', exact: true }).getByRole('listitem')).toHaveCount(3);
  await workspace.capture(`${testInfo.project.name}-todo-tool-row`);
});

test('a goal from another Claude session should not show', async ({ page }) => {
  // Arrange
  const { workspace } = await openGoalSession(page, { ...claudeGoal(), sourceSessionId: 'older-claude-session' });
  // Assert
  await expect(workspace.todoChip(1, 3)).toBeVisible();
  await expect(workspace.dock().getByRole('button', { name: /^Current goal/ })).toHaveCount(0);
});

test('the goal button name should include the goal progress', async ({ page }) => {
  // Arrange
  const progress = { currentStep: 1, totalSteps: 2, steps: [
    { text: 'Inspect the source', status: 'in_progress' }, { text: 'Write the fix', status: 'pending' },
  ] };
  // Act
  const { workspace } = await openGoalSession(page, { ...claudeGoal(), progress });
  // Assert
  await expect(workspace.goal(goalText, 'Step 1 of 2')).toBeVisible();
  await expect(workspace.goal(goalText, 'Step 1 of 2')).toContainText('Current goal · Step 1 of 2');
});

test('a TodoWrite row without a valid list should show its raw arguments', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setMessages([
    { role: 'user', content: { type: 'text', text: 'Port the goal bar' } },
    envelope({ t: 'tool-call-start', call: 'toolu_bad', name: 'TodoWrite', title: 'TodoWrite call', description: 'TodoWrite call',
      args: { todos: [{ content: 'Wrong status', status: 'done' }] } }),
    envelope({ t: 'tool-call-end', call: 'toolu_bad' }),
    envelope({ t: 'text', text: 'I updated the todo list.' }),
  ]);
  const workspace = new GoalProgressPage(page);
  await workspace.openGoalChat();
  // Act
  await workspace.expandToolGroup(0);
  const row = workspace.toolGroups().first();
  await workspace.press(row.locator('summary', { hasText: 'TodoWrite call' }), !!testInfo.project.use.hasTouch);
  // Assert
  await expect(row.getByText(/"status": "done"/)).toBeVisible();
  await expect(row.getByRole('list', { name: 'Todo items', exact: true })).toHaveCount(0);
});
