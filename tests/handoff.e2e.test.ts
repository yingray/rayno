import { test, expect } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';
import type { Json } from '../src/happy/normalize';

test('Hand Off should keep the context out of the task field and send it first only after Start', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.updateMetadata({ homeDir: '/real', claudeSessionId: 'claude-original' });
  await server.setWorking(true);
  const original = JSON.stringify(server.sessions[0]);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  // Act
  await workspace.handOff();
  // Assert
  await expect(page.getByLabel('Computer', { exact: true })).toHaveValue('computer');
  await expect(page.getByLabel('Folder', { exact: true })).toHaveValue('~/project');
  await expect(page.getByRole('group', { name: 'Agent', exact: true }).getByRole('button', { name: 'Codex', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Session type', exact: true }).getByRole('button', { name: 'Simple', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(workspace.taskDescription()).toHaveValue('');
  await expect(workspace.handoffContext()).toBeVisible();
  await expect(workspace.taskDescription()).toHaveAttribute('placeholder', 'Add instructions, or start to continue the work');
  await workspace.expectTaskFocusFrame();
  expect(server.spawns).toEqual([]);
  expect(server.sends).toEqual([]);
  expect(server.mutations).toEqual([]);
  await workspace.expectNoPageOverflow();
  await workspace.capture(`${testInfo.project.name}-handoff-draft`);
  // Act
  await page.keyboard.insertText('Continue by checking the pending change.');
  await page.reload();
  // Assert
  await expect(workspace.taskDescription()).toHaveValue('Continue by checking the pending change.');
  await expect(workspace.handoffContext()).toBeVisible();
  await workspace.expectTaskCaretAtEnd();
  // Act
  await workspace.startDraft();
  // Assert
  await expect(page).toHaveURL(/\/session\/created-session$/);
  expect(server.spawns).toHaveLength(1);
  expect(server.spawns[0]).toMatchObject({ directory: '/real/project', agent: 'codex' });
  expect(server.sends).toHaveLength(1);
  const raw = await server.encryption.decrypt<Json>(server.sends[0].content, server.dataKey);
  expect(raw.content.text).toBe([
    'Continue the work from Happy session `real-session` (Claude Code, in `~/project`).', '',
    'Read the transcript of that session first:', '`~/.claude/projects/*/claude-original.jsonl`', '',
    'Continue by checking the pending change.',
  ].join('\n'));
  expect(JSON.stringify(server.sends)).not.toContain('claude-original');
  expect(JSON.stringify(server.sessions.find((session) => session.id === 'real-session'))).toBe(original);
  expect(server.mutations.some((method) => method.endsWith(':abort') || method.endsWith(':killSession'))).toBe(false);
});

test('Hand Off from Codex should reuse the exact registered worktree with Claude', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const checkout = '/real/project/.dev/worktree/old-checkout';
  await server.updateMetadata({ flavor: 'codex', path: checkout, codexThreadId: 'thread-original', gitBranch: 'feature/review' });
  server.worktreeListing = `worktree /real/project\nHEAD abc\nbranch refs/heads/main\n\nworktree ${checkout}\nHEAD def\nbranch refs/heads/feature/review\n\n`;
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  // Act
  await workspace.handOff();
  // Assert
  await expect(page.getByLabel('Folder', { exact: true })).toHaveValue('~/project');
  await expect(page.getByLabel('Worktree', { exact: true })).toHaveValue(checkout);
  await expect(page.getByRole('group', { name: 'Agent', exact: true }).getByRole('button', { name: 'Claude', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(workspace.taskDescription()).toHaveValue('');
  await expect(workspace.handoffContext()).toBeVisible();
  expect(server.spawns).toEqual([]);
  // Act
  await workspace.startDraft();
  // Assert
  await expect(page).toHaveURL(/\/session\/created-session$/);
  expect(server.spawns[0]).toMatchObject({ directory: checkout, agent: 'claude' });
  expect(server.bashCommands).toEqual([expect.objectContaining({ command: 'git worktree list --porcelain', cwd: '/real/project' })]);
  expect(server.spawns).toHaveLength(1);
  expect(server.sends).toHaveLength(1);
  const raw = await server.encryption.decrypt<Json>(server.sends[0].content, server.dataKey);
  expect(raw.content.text).toContain('~/.codex/sessions/*/*/*/rollout-*-thread-original.jsonl');
});

test('an unregistered checkout should stop before a new worktree or agent is created', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.updateMetadata({ path: '/real/project/.dev/worktree/missing' });
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  // Act
  await workspace.handOff();
  await workspace.startDraft();
  // Assert
  await expect(page.getByRole('alert').filter({ hasText: 'not a registered worktree' })).toBeVisible();
  expect(server.spawns).toEqual([]);
  expect(server.sends).toEqual([]);
  expect(server.bashCommands).toHaveLength(1);
  expect(server.bashCommands[0].command).toBe('git worktree list --porcelain');
});

test('the worktree picker should still create a new checkout from a branch name', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await page.goto('/new');
  // Act
  await page.getByLabel('Folder', { exact: true }).fill('/real/project');
  await page.getByRole('group', { name: 'Session type', exact: true }).getByRole('button', { name: 'Worktree', exact: true }).click();
  await page.getByLabel('Worktree', { exact: true }).fill('feature/new-checkout');
  await workspace.taskDescription().fill('Start in a new worktree');
  await workspace.startDraft();
  // Assert
  await expect(page).toHaveURL(/\/session\/created-session$/);
  expect(server.spawns[0].directory).toBe('/real/project/.dev/worktree/feature/new-checkout');
  expect(server.bashCommands.map((params) => params.command)).toEqual([
    'git worktree list --porcelain',
    "git worktree add -b 'feature/new-checkout' '/real/project/.dev/worktree/feature/new-checkout'",
  ]);
});

test('the demo should prepare a local handoff, explain a missing transcript, and let the user remove the context', async ({ page }) => {
  // Arrange
  await page.addInitScript(() => localStorage.setItem('rayno.mode', 'demo'));
  const workspace = new LiveWorkspacePage(page);
  await page.goto('/session/floating-panels');
  // Act
  await workspace.handOff();
  // Assert
  await expect(workspace.taskDescription()).toHaveValue('');
  await expect(page.getByText('Continues with the context of “Build the floating panels layout”', { exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Agent', exact: true }).getByRole('button', { name: 'Codex', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await workspace.expectNoPageOverflow();
  // Act
  await workspace.startDraft();
  // Assert
  await expect(page).toHaveURL(/\/session\/[^/]+$/);
  await expect(page.getByText(/Happy session `floating-panels`/).first()).toBeVisible();
  await expect(page.getByText(/Ask me for the context that you need\./).first()).toBeVisible();
  // Act
  await page.goto('/session/floating-panels');
  await workspace.handOff();
  await page.getByRole('button', { name: 'Remove handoff context', exact: true }).click();
  await workspace.startDraft();
  // Assert
  await expect(workspace.handoffContext()).toHaveCount(0);
  await expect(workspace.taskDescription()).toHaveAttribute('placeholder', 'What should the agent do?');
  await expect(page.getByRole('alert').filter({ hasText: 'Describe what the agent should do.' })).toBeVisible();
});
