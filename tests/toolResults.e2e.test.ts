import { test, expect } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { ToolResultsPage } from './pages/ToolResultsPage';

type Json = Record<string, any>;
// Claude output records as happy-cli sdkToLogConverter.ts sends them. The tool results carry the
// `toolUseResult` values of Claude Code and the `permissions` field of claudeRemoteLauncher.ts.
const assistant = (uuid: string, content: Json[]) => ({ role: 'agent', content: { type: 'output', data: {
  type: 'assistant', uuid, message: { role: 'assistant', content } } } });
const result = (uuid: string, chunk: Json, toolUseResult: unknown) => ({ role: 'agent', content: { type: 'output', data: {
  type: 'user', uuid, message: { role: 'user', content: [{ type: 'tool_result', ...chunk }] }, toolUseResult } } });
const question = 'Which build should run?';

async function arrange(server: HappyServer) {
  const records = [
    assistant('a1', [{ type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'npm test', description: 'Run tests' } }]),
    result('r1', { tool_use_id: 'toolu_bash', content: 'Tests passed\nwarning: slow test',
      permissions: { date: 1700000002000, result: 'approved', allowedTools: ['Bash(npm test)'] } },
    { stdout: 'Tests passed', stderr: 'warning: slow test', interrupted: false, isImage: false, noOutputExpected: false }),
    assistant('a2', [{ type: 'tool_use', id: 'toolu_edit', name: 'Edit', input: { file_path: '/real/project/README.md', old_string: 'old line', new_string: 'new line' } }]),
    result('r2', { tool_use_id: 'toolu_edit', content: 'The file /real/project/README.md has been updated successfully.',
      permissions: { date: 1700000003000, result: 'approved', mode: 'acceptEdits' } },
    { filePath: '/real/project/README.md', oldString: 'old line', newString: 'new line', originalFile: 'ORIGINAL FILE BODY\nold line\n',
      structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' # Project', '-old line', '+new line'] }],
      userModified: false, replaceAll: false }),
    assistant('a3', [{ type: 'tool_use', id: 'toolu_question', name: 'AskUserQuestion', input: { questions: [
      { question, header: 'Build', multiSelect: false, options: [{ label: 'host (Recommended)', description: 'Run here.' }, { label: 'sandbox', description: 'Run in a VM.' }] }] } }]),
    result('r3', { tool_use_id: 'toolu_question', content: `Your questions have been answered: "${question}"="host (Recommended)". You can now continue with these answers in mind.`,
      permissions: { date: 1700000004000, result: 'approved' } },
      { questions: [{ question, header: 'Build', multiSelect: false, options: [{ label: 'host (Recommended)', description: 'Run here.' }] }],
        answers: { [question]: 'host (Recommended)' } }),
    assistant('a4', [{ type: 'tool_use', id: 'toolu_todo', name: 'TodoWrite', input: { todos: [{ content: 'Ship it', status: 'in_progress' }] } }]),
    result('r4', { tool_use_id: 'toolu_todo', content: 'Todos have been modified successfully.' },
      { oldTodos: [], newTodos: [{ content: 'Ship it', status: 'completed' }, { content: 'Write notes', status: 'pending' }] }),
    assistant('a5', [{ type: 'tool_use', id: 'toolu_fetch', name: 'WebFetch', input: { url: 'https://example.com', prompt: 'Read it' } }]),
    result('r5', { tool_use_id: 'toolu_fetch', is_error: true, content: 'The user doesn\'t want to proceed with this tool use.' },
      'Error: The user doesn\'t want to proceed with this tool use.'),
    { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'All checks are done.' } } },
  ];
  for (const raw of records) await server.pushEvent(raw);
  // The WebFetch reply only exists in agentState.completedRequests (claude/utils/permissionHandler.ts).
  server.sessions[0].agentState = await server.encryption.encrypt({ completedRequests: {
    toolu_fetch: { tool: 'WebFetch', arguments: { url: 'https://example.com' }, createdAt: 1, completedAt: 2, status: 'denied', reason: 'Not this site' },
  } }, server.dataKey);
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
  await workspace.expectDecision('Bash', 'Allowed for session');
  await expect(bash).toContainText('Allowed tools: Bash(npm test).');
  await expect(bash).toContainText('Output');
  await expect(bash.locator('pre').filter({ hasText: 'warning: slow test' })).toHaveAttribute('data-tone', 'error');
  await expect(bash).not.toContainText('"stdout"');
  const edit = await workspace.openTool('Edit');
  await workspace.expectDecision('Edit', 'Allowed · Edits');
  await expect(edit.getByLabel('Tool diff')).toContainText('+new line');
  await expect(edit).toContainText('Changes · /real/project/README.md');
  await expect(edit).not.toContainText('ORIGINAL FILE BODY');
  const todo = await workspace.openTool('TodoWrite');
  await expect(todo.getByRole('listitem', { name: 'Ship it, Done' })).toBeVisible();
  await expect(todo.getByRole('listitem', { name: 'Write notes, To do' })).toBeVisible();
  const fetch = await workspace.openTool('WebFetch');
  await workspace.expectDecision('WebFetch', 'Denied');
  await expect(fetch).toContainText('Denied: Not this site');
  await workspace.expectDecision('AskUserQuestion', 'Answered');
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
