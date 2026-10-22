import { describe, expect, it } from 'vitest';
import { toolAnswers, toolSections, toolSectionsText, type ToolSection } from './toolResults';
import type { ToolCall } from './types';

// The result values copy Claude Code `toolUseResult` records from real transcripts and the Happy
// test data (happy-app sync/__testdata__/trace_0.json, happy-cli claude/utils/__fixtures__/task_sdk.jsonl).
const call = (name: string, result: unknown, extra: Partial<ToolCall> = {}): ToolCall => ({ id: 'toolu_1', name, input: {}, result, ...extra });
const text = (sections: ToolSection[]) => toolSectionsText(sections).join('\n');

describe('tool result views', () => {
  it('should show Bash stdout, stderr, and its exit status', () => {
    // Arrange
    const success = call('Bash', { stdout: '      17\n/tmp/systemPrompt.js', stderr: '', interrupted: false, isImage: false,
      returnCodeInterpretation: 'No matches found', noOutputExpected: false });
    const failed = call('Bash', 'Error: Exit code 1\nError: Transform failed with 1 error:\n Test Files  1 failed (1)', {
      isError: true, resultText: 'Exit code 1\nError: Transform failed with 1 error:\n Test Files  1 failed (1)' });
    const background = call('Bash', { stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false,
      backgroundTaskId: 'b670tzx3v', timedOutAfterMs: 120000 });
    const warning = call('Bash', { stdout: 'done', stderr: 'warning: deprecated', interrupted: true, isImage: false });
    // Act
    const views = [success, failed, background, warning].map(toolSections);
    // Assert
    expect(views[0]).toEqual([{ kind: 'note', text: 'No matches found', error: false },
      { kind: 'text', label: 'Output', text: '      17\n/tmp/systemPrompt.js' }]);
    expect(views[1]).toEqual([{ kind: 'note', text: 'Exit code 1', error: true },
      { kind: 'text', label: 'Output', text: 'Error: Transform failed with 1 error:\n Test Files  1 failed (1)', error: true }]);
    expect(text(views[2])).toBe('Moved to the background after 120 s · Runs in the background (b670tzx3v)');
    expect(views[3]).toContainEqual({ kind: 'text', label: 'Error output', text: 'warning: deprecated', error: true });
    expect(text(views[3])).toContain('Interrupted');
  });

  it('should show Edit and Write changes from the structured patch', () => {
    // Arrange
    const edit = call('Edit', { filePath: '/repo/src/styles/global.css', oldString: '  color: var(--secondary);\n}',
      newString: '  color: var(--secondary);\n}\n.screenError {\n}', originalFile: 'body {\n}\n',
      structuredPatch: [{ oldStart: 88, oldLines: 3, newStart: 88, newLines: 5,
        lines: ['   color: var(--secondary);', ' }', '+.screenError {', '+}', ' button,'] }],
      userModified: false, replaceAll: false }, { input: { file_path: '/repo/src/styles/global.css', old_string: 'a', new_string: 'b' } });
    const created = call('Write', { type: 'create', filePath: '/repo/MEMORY.md', content: '- [Diagram](diagram.md)\n',
      structuredPatch: [], originalFile: null, userModified: false });
    // Act
    const [editView, writeView] = [edit, created].map(toolSections);
    // Assert
    expect(editView).toEqual([{ kind: 'diff', label: 'Changes · /repo/src/styles/global.css', more: 0, lines: [
      { kind: 'hunk', text: '@@ -88,3 +88,5 @@' }, { kind: 'context', text: '   color: var(--secondary);' },
      { kind: 'context', text: ' }' }, { kind: 'add', text: '+.screenError {' }, { kind: 'add', text: '+}' },
      { kind: 'context', text: ' button,' }] }]);
    expect(text(editView)).not.toContain('body {');
    expect(writeView[0]).toEqual({ kind: 'note', text: 'Created /repo/MEMORY.md' });
    expect(writeView[1]).toMatchObject({ kind: 'diff', lines: [{ kind: 'add', text: '+ - [Diagram](diagram.md)' }] });
  });

  it('should show MultiEdit arguments as a diff until a patch arrives and limit long diffs', () => {
    // Arrange
    const pending = call('MultiEdit', undefined, { input: { file_path: 'a.ts', edits: [
      { old_string: 'one', new_string: 'two' }, { old_string: 'three', new_string: 'four' }] } });
    const long = call('Write', { type: 'create', filePath: 'long.txt', content: Array.from({ length: 450 }, (_, index) => `line ${index}`).join('\n'),
      structuredPatch: [], originalFile: null });
    // Act
    const [pendingView, longView] = [pending, long].map(toolSections);
    // Assert
    expect(pendingView[0]).toMatchObject({ kind: 'diff', label: 'Changes', lines: [
      { kind: 'remove', text: '- one' }, { kind: 'add', text: '+ two' }, { kind: 'remove', text: '- three' }, { kind: 'add', text: '+ four' }] });
    expect(pendingView[1]).toEqual({ kind: 'text', label: 'Result', text: 'No result reported yet.' });
    expect(longView[1]).toMatchObject({ kind: 'diff', more: 50 });
  });

  it('should show Read, Glob, and Grep results without raw JSON', () => {
    // Arrange
    const read = call('Read', { type: 'text', file: { filePath: '/repo/src/api/auth.ts', content: "import axios from 'axios';",
      numLines: 1, startLine: 1, totalLines: 40 } });
    const image = call('Read', { type: 'image', file: { base64: 'iVBORw0KGgo'.repeat(40), type: 'image/png', originalSize: 1200 } });
    const glob = call('Glob', { filenames: ['/repo/src/ui/qrcode.test.ts', '/repo/src/api/auth.ts'], durationMs: 12, numFiles: 2, truncated: true });
    const grepFiles = call('Grep', { mode: 'files_with_matches', filenames: ['a.js', 'b.js'], numFiles: 2, totalFiles: 15, appliedLimit: 2 });
    const grepContent = call('Grep', { mode: 'content', numFiles: 0, filenames: [], content: '211:[Omitted long matching line]', numLines: 1, totalLines: 1 });
    const grepCount = call('Grep', { mode: 'count', numFiles: 1, filenames: [], content: 'bundle.diff:14', numMatches: 14 });
    // Act
    const views = [read, image, glob, grepFiles, grepContent, grepCount].map((item) => text(toolSections(item)));
    // Assert
    expect(views[0]).toBe("Lines 1–1 of 40\n/repo/src/api/auth.ts\nimport axios from 'axios';");
    expect(views[1]).toBe('Image (image/png). The image is not shown here.');
    expect(views[2]).toBe('2 files · list truncated\nFiles\n/repo/src/ui/qrcode.test.ts\n/repo/src/api/auth.ts');
    expect(views[3]).toBe('2 files · limit 2\nFiles\na.js\nb.js');
    expect(views[4]).toBe('1 line\nMatches\n211:[Omitted long matching line]');
    expect(views[5]).toBe('14 matches in 1 file\nMatches\nbundle.diff:14');
  });

  it('should show the tool_result text for Read results without a text range', () => {
    // Arrange: FileReadOutput shapes from @anthropic-ai/claude-agent-sdk sdk-tools.d.ts and a real transcript.
    const unchanged = call('Read', { type: 'file_unchanged', file: { filePath: '/repo/memory/MEMORY.md' } },
      { resultText: 'Wasted call — file unchanged since your last Read. Refer to that earlier tool_result instead.' });
    const notebook = call('Read', { type: 'notebook', file: { filePath: '/repo/a.ipynb', cells: [{ cell_type: 'code', source: 'print(1)' }] } });
    const pdf = call('Read', { type: 'pdf', file: { filePath: '/repo/spec.pdf', base64: 'JVBERi0x'.repeat(40), originalSize: 2048 } });
    // Act
    const views = [unchanged, notebook, pdf].map((item) => text(toolSections(item)));
    // Assert
    expect(views[0]).toBe('Result\nWasted call — file unchanged since your last Read. Refer to that earlier tool_result instead.');
    expect(views[1]).toContain('"cell_type": "code"');
    expect(views[2]).toContain('"base64": "[320 characters of encoded data]"');
    expect(views[2]).not.toContain('Image');
  });

  it('should show a finished session tool call that has no result', () => {
    // Arrange: normalize.ts stores null for a tool-call-end without a result.
    const done = call('Bash', null);
    const failed = call('Bash', null, { isError: true });
    // Act
    const views = [done, failed].map(toolSections);
    // Assert
    expect(views[0]).toEqual([{ kind: 'note', text: 'The tool call finished. The agent sent no result text.' }]);
    expect(views[1]).toEqual([{ kind: 'note', text: 'The tool call failed. The agent sent no details.', error: true }]);
  });

  it('should show Task reports, background agents, and todo lists', () => {
    // Arrange
    const task = call('Task', { content: [{ type: 'text', text: '## 5 Major AI Breakthroughs in 2025' }], totalDurationMs: 51327,
      totalTokens: 20915, totalToolUseCount: 2, usage: { input_tokens: 4 } });
    const agent = call('Agent', { isAsync: true, status: 'async_launched', agentId: 'a6be2013d249a372e',
      description: 'Shift-Left QA for ACE-16006', prompt: 'Run QA', outputFile: '/tmp/a.output' });
    const todos = call('TodoWrite', { oldTodos: [], newTodos: [{ content: 'New authoritative task state', status: 'completed' }] },
      { input: { todos: [{ content: 'Old task state', status: 'pending' }] } });
    const running = call('TodoWrite', undefined, { input: { todos: [{ content: 'Write tests', status: 'in_progress' }] } });
    // Act
    const views = [task, agent, todos, running].map(toolSections);
    // Assert
    expect(text(views[0])).toBe('2 tool uses · 20,915 tokens · 51 s\nReport\n## 5 Major AI Breakthroughs in 2025');
    expect(text(views[1])).toBe('Started in the background: Shift-Left QA for ACE-16006');
    expect(views[2]).toEqual([{ kind: 'todos', items: [{ content: 'New authoritative task state', status: 'completed' }] }]);
    expect(views[3][0]).toEqual({ kind: 'todos', items: [{ content: 'Write tests', status: 'in_progress' }] });
  });

  it('should list AskUserQuestion answers by question', () => {
    // Arrange
    const question = call('AskUserQuestion', {
      questions: [{ question: 'How should the build run?', header: 'Build', multiSelect: false,
        options: [{ label: 'host (Recommended)', description: 'Run on the host.' }, { label: 'sandbox', description: 'Run in a VM.' }] }],
      answers: { 'How should the build run?': 'host (Recommended)' },
    }, { resultText: 'Your questions have been answered: "How should the build run?"="host (Recommended)".' });
    // Act
    const answers = toolAnswers(question);
    // Assert
    expect(answers).toEqual([{ question: 'How should the build run?', answer: 'host (Recommended)' }]);
    expect(toolSections(question)).toEqual([{ kind: 'answers', items: answers }]);
  });

  it('should keep a readable fallback for unknown structured results', () => {
    // Arrange
    const known = call('mcp__tool', { rows: 2 }, { resultText: 'Two rows changed.' });
    const unknown = call('mcp__tool', { rows: 2, data: 'A'.repeat(500), originalFile: 'secret body' });
    const list = call('mcp__tool', [{ type: 'text', text: 'Listed' }]);
    // Act
    const views = [known, unknown, list].map((item) => text(toolSections(item)));
    // Assert
    expect(views[0]).toBe('Result\nTwo rows changed.');
    expect(views[1]).toBe('Result\n{\n  "rows": 2,\n  "data": "[500 characters of encoded data]"\n}');
    expect(views[2]).toContain('"text": "Listed"');
  });
});
