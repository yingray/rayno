import { test, expect } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { ToolResultsPage } from './pages/ToolResultsPage';

type Json = Record<string, any>;
// Legacy Claude output records. Older CLIs sent these before the session protocol. A session can switch modes:
// local mode copied the Claude Code JSONL record, so its tool results carry `toolUseResult` and no `permissions`.
// Remote mode (claudeRemoteLauncher.ts, sdkToLogConverter.ts) added `permissions` and sent no `toolUseResult`.
const assistant = (uuid: string, content: Json[]) => ({ role: 'agent', content: { type: 'output', data: {
  type: 'assistant', uuid, message: { role: 'assistant', content } } } });
const local = (uuid: string, chunk: Json, toolUseResult: unknown) => ({ role: 'agent', content: { type: 'output', data: {
  type: 'user', uuid, message: { role: 'user', content: [{ type: 'tool_result', ...chunk }] }, toolUseResult } } });
const remote = (uuid: string, chunk: Json) => ({ role: 'agent', content: { type: 'output', data: {
  type: 'user', uuid, message: { role: 'user', content: [{ type: 'tool_result', ...chunk }] } } } });
// The current CLI wraps each Claude record in a session envelope (api/apiSession.ts, claude/utils/sessionProtocolMapper.ts).
// Its tool-call-end carries only `call`.
let time = 1700000000000;
const envelope = (ev: Json) => ({ role: 'session', content: { id: `cmh${++time}`, time, role: 'agent', turn: 'turn-1', ev },
  meta: { sentFrom: 'cli' } });
const question = 'Which build should run?';

async function setAgentState(server: HappyServer, state: Json) {
  server.sessions[0].agentState = await server.encryption.encrypt(state, server.dataKey);
}

async function arrange(server: HappyServer) {
  const records = [
    assistant('a1', [{ type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'npm test', description: 'Run tests' } }]),
    local('r1', { tool_use_id: 'toolu_bash', content: 'Tests passed\nwarning: slow test' },
      { stdout: 'Tests passed', stderr: 'warning: slow test', interrupted: false, isImage: false, noOutputExpected: false }),
    assistant('a2', [{ type: 'tool_use', id: 'toolu_edit', name: 'Edit', input: { file_path: '/real/project/README.md', old_string: 'old line', new_string: 'new line' } }]),
    local('r2', { tool_use_id: 'toolu_edit', content: 'The file /real/project/README.md has been updated successfully.' },
      { filePath: '/real/project/README.md', oldString: 'old line', newString: 'new line', originalFile: 'ORIGINAL FILE BODY\nold line\n',
        structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' # Project', '-old line', '+new line'] }],
        userModified: false, replaceAll: false }),
    assistant('a3', [{ type: 'tool_use', id: 'toolu_question', name: 'AskUserQuestion', input: { questions: [
      { question, header: 'Build', multiSelect: false, options: [{ label: 'host (Recommended)', description: 'Run here.' }, { label: 'sandbox', description: 'Run in a VM.' }] }] } }]),
    local('r3', { tool_use_id: 'toolu_question', content: `Your questions have been answered: "${question}"="host (Recommended)". You can now continue with these answers in mind.` },
      { questions: [{ question, header: 'Build', multiSelect: false, options: [{ label: 'host (Recommended)', description: 'Run here.' }] }],
        answers: { [question]: 'host (Recommended)' } }),
    assistant('a4', [{ type: 'tool_use', id: 'toolu_todo', name: 'TodoWrite', input: { todos: [{ content: 'Ship it', status: 'in_progress' }] } }]),
    local('r4', { tool_use_id: 'toolu_todo', content: 'Todos have been modified successfully.' },
      { oldTodos: [], newTodos: [{ content: 'Ship it', status: 'completed' }, { content: 'Write notes', status: 'pending' }] }),
    assistant('a5', [{ type: 'tool_use', id: 'toolu_write', name: 'Write', input: { file_path: '/real/project/NOTES.md', content: 'notes' } }]),
    remote('r5', { tool_use_id: 'toolu_write', content: 'File created successfully at: /real/project/NOTES.md',
      permissions: { date: 1700000003000, result: 'approved', mode: 'acceptEdits' } }),
    assistant('a6', [{ type: 'tool_use', id: 'toolu_fetch', name: 'WebFetch', input: { url: 'https://example.com', prompt: 'Read it' } }]),
    remote('r6', { tool_use_id: 'toolu_fetch', is_error: true, content: 'The user doesn\'t want to proceed with this tool use.',
      permissions: { date: 1700000004000, result: 'denied' } }),
    { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'All checks are done.' } } },
  ];
  for (const raw of records) await server.pushEvent(raw);
  // The denial reason only exists in agentState.completedRequests (claude/utils/permissionHandler.ts).
  await setAgentState(server, { completedRequests: {
    toolu_fetch: { tool: 'WebFetch', arguments: { url: 'https://example.com' }, createdAt: 1, completedAt: 2, status: 'denied', reason: 'Not this site' },
  } });
}

test('structured tool results and past replies should stay readable in the transcript', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await arrange(server);
  const workspace = new ToolResultsPage(page);
  await workspace.openSession();
  await expect(page.getByText('All checks are done.', { exact: true })).toBeVisible();
  // Act
  await workspace.collapseTools();
  // Assert: the answer is visible while the tool group is collapsed.
  await workspace.expectAnswer(question, 'host (Recommended)');
  const bash = await workspace.openTool('Bash');
  await expect(bash).toContainText('Output');
  await expect(bash.locator('pre').filter({ hasText: 'warning: slow test' })).toHaveAttribute('data-tone', 'error');
  await expect(bash).not.toContainText('"stdout"');
  const edit = await workspace.openTool('Edit');
  await expect(edit.getByLabel('Tool diff')).toContainText('+new line');
  await expect(edit).toContainText('Changes · /real/project/README.md');
  await expect(edit).not.toContainText('ORIGINAL FILE BODY');
  const write = await workspace.openTool('Write');
  await workspace.expectDecision('Write', 'Allowed · Edits');
  await expect(write).toContainText('File created successfully at: /real/project/NOTES.md');
  const todo = await workspace.openTool('TodoWrite');
  await expect(todo.getByRole('listitem', { name: 'Ship it, Done' })).toBeVisible();
  await expect(todo.getByRole('listitem', { name: 'Write notes, To do' })).toBeVisible();
  const fetch = await workspace.openTool('WebFetch');
  await workspace.expectDecision('WebFetch', 'Denied');
  await expect(fetch).toContainText('Denied: Not this site');
  // The answered questions group shows the answers, so the open row does not repeat them.
  const answers = await workspace.openTool('AskUserQuestion');
  await expect(answers.getByRole('heading', { name: 'Answers', exact: true })).toHaveCount(0);
  await expect(workspace.answeredQuestions()).toBeVisible();
  await workspace.expectNoPageOverflow();
});

test('current session-protocol tool calls should show the reply from the agent state', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  for (const ev of [
    { t: 'tool-call-start', call: 'toolu_bash', name: 'Bash', title: 'Run tests', description: 'Run tests', args: { command: 'npm test', description: 'Run tests' } },
    { t: 'tool-call-end', call: 'toolu_bash' },
    { t: 'tool-call-start', call: 'toolu_edit', name: 'Edit', title: 'Edit call', description: 'Edit call',
      args: { file_path: '/real/project/README.md', old_string: 'old line', new_string: 'new line' } },
    { t: 'tool-call-end', call: 'toolu_edit' },
    { t: 'text', text: 'All checks are done.' },
  ]) await server.pushEvent(envelope(ev));
  await setAgentState(server, { completedRequests: {
    toolu_bash: { tool: 'Bash', arguments: { command: 'npm test' }, createdAt: 1, completedAt: 2, status: 'approved',
      allowTools: ['Bash(npm test)'], allowedTools: ['Bash(npm test)'] },
    toolu_edit: { tool: 'Edit', arguments: {}, createdAt: 3, completedAt: 4, status: 'denied', reason: 'Not this file' },
  } });
  const workspace = new ToolResultsPage(page);
  await workspace.openSession();
  await expect(page.getByText('All checks are done.', { exact: true })).toBeVisible();
  // Act
  const bash = await workspace.openTool('Run tests');
  // Assert
  await workspace.expectDecision('Run tests', 'Allowed for session');
  await expect(bash).toContainText('Allowed tools: Bash(npm test).');
  await expect(bash).toContainText('The tool call finished. The agent sent no result text.');
  await expect(bash).not.toContainText('No result reported yet.');
  const edit = await workspace.openTool('Edit call');
  await workspace.expectDecision('Edit call', 'Denied');
  await expect(edit).toContainText('Denied: Not this file');
  await expect(edit.getByLabel('Tool diff')).toContainText('+ new line');
  await workspace.expectNoPageOverflow();
});

test('tool details and answered questions should stay usable on phone viewports', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await arrange(server);
  const workspace = new ToolResultsPage(page);
  await workspace.openSession();
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 900], [360, 350], [844, 390]]) {
    // Act
    await page.setViewportSize({ width, height });
    await workspace.collapseTools();
    // Assert
    await workspace.expectAnswer(question, 'host (Recommended)');
    const edit = await workspace.openTool('Edit');
    await expect(edit.getByLabel('Tool diff')).toBeVisible();
    const diff = (await edit.getByLabel('Tool diff').boundingBox())!;
    expect(diff.x + diff.width).toBeLessThanOrEqual(width);
    const summary = edit.locator('summary');
    if (width < 768) await workspace.expectTouchTarget(summary);
    await workspace.expectNoPageOverflow();
    if (width === 320) await workspace.capture('tool-results-320');
  }
});
