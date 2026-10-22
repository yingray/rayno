import type { ToolCall } from './types';

// Readable views of structured tool results. Shapes follow the Claude Code `toolUseResult` values that
// Happy Web reads in components/tools/knownTools.tsx and utils/toolResult.ts.
export type DiffLine = { kind: 'add' | 'remove' | 'context' | 'hunk'; text: string };
export type TodoItem = { content: string; status: string };
export type ToolSection =
  | { kind: 'note'; text: string; error?: boolean }
  | { kind: 'text'; label: string; text: string; error?: boolean }
  | { kind: 'diff'; label: string; lines: DiffLine[]; more: number }
  | { kind: 'todos'; items: TodoItem[] }
  | { kind: 'answers'; items: { question: string; answer: string }[] };

type Json = Record<string, any>;
const record = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const str = (value: unknown) => (typeof value === 'string' ? value : undefined);
const plural = (value: number, one: string, many = `${one}s`) => `${value.toLocaleString('en-US')} ${value === 1 ? one : many}`;
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
// Long diffs stay readable and cheap to render. The rest of the file stays in the agent transcript.
const DIFF_LIMIT = 400;

function diff(label: string, lines: DiffLine[]): ToolSection {
  return { kind: 'diff', label, lines: lines.slice(0, DIFF_LIMIT), more: Math.max(0, lines.length - DIFF_LIMIT) };
}
function hunkLines(hunks: unknown): DiffLine[] {
  if (!Array.isArray(hunks)) return [];
  return hunks.flatMap((value) => {
    const hunk = record(value);
    const lines = Array.isArray(hunk.lines) ? hunk.lines.filter((line): line is string => typeof line === 'string') : [];
    return [
      { kind: 'hunk' as const, text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@` },
      ...lines.map((line) => ({ kind: line[0] === '+' ? 'add' as const : line[0] === '-' ? 'remove' as const : 'context' as const, text: line })),
    ];
  });
}
const prefixed = (value: string, kind: 'add' | 'remove'): DiffLine[] =>
  value.split('\n').map((line) => ({ kind, text: `${kind === 'add' ? '+' : '-'} ${line}` }));
function editLines(edit: Json): DiffLine[] {
  return typeof edit.old_string === 'string' && typeof edit.new_string === 'string'
    ? [...prefixed(edit.old_string, 'remove'), ...prefixed(edit.new_string, 'add')] : [];
}
const todoItems = (value: unknown): TodoItem[] | undefined => Array.isArray(value)
  ? value.map(record).filter((todo) => typeof todo.content === 'string')
    .map((todo) => ({ content: todo.content, status: str(todo.status) || 'pending' }))
  : undefined;

// Large or binary fields stay out of the fallback text.
function fallbackJson(value: unknown) {
  return JSON.stringify(value, (key, item) => key === 'originalFile' ? undefined
    : typeof item === 'string' && (key === 'base64' || key === 'data') && item.length > 200 ? `[${plural(item.length, 'character')} of encoded data]`
      : item, 2);
}
function seconds(ms: unknown) {
  const value = num(ms);
  return value === undefined ? undefined : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} s`;
}

function terminal(result: Json, isError: boolean): ToolSection[] | undefined {
  if (!['stdout', 'stderr', 'output'].some((key) => typeof result[key] === 'string')) return undefined;
  const sections: ToolSection[] = [];
  const code = num(result.exitCode) ?? num(result.exit_code);
  const notes = [
    code !== undefined ? `Exit code ${code}` : undefined,
    result.interrupted === true ? 'Interrupted' : undefined,
    str(result.returnCodeInterpretation),
    num(result.timedOutAfterMs) !== undefined ? `Moved to the background after ${seconds(result.timedOutAfterMs)}` : undefined,
    str(result.backgroundTaskId) ? `Runs in the background (${result.backgroundTaskId})` : undefined,
  ].filter(Boolean);
  if (notes.length) sections.push({ kind: 'note', text: notes.join(' · '), error: isError || (code !== undefined && code !== 0) });
  const stdout = str(result.stdout) ?? str(result.output) ?? '';
  const stderr = str(result.stderr) ?? '';
  if (stdout) sections.push({ kind: 'text', label: 'Output', text: stdout });
  if (stderr) sections.push({ kind: 'text', label: 'Error output', text: stderr, error: true });
  if (!stdout && !stderr && !str(result.backgroundTaskId)) sections.push({ kind: 'note', text: 'No output.' });
  for (const file of Array.isArray(result.bashEditDiff?.files) ? result.bashEditDiff.files : [])
    sections.push(diff(`Changes · ${str(record(file).filePath) || 'file'}`, hunkLines(record(file).hunks)));
  return sections;
}

function structured(call: ToolCall, result: Json): ToolSection[] {
  const isError = call.isError === true;
  const shell = terminal(result, isError);
  if (shell) return shell;
  // Edit, MultiEdit, and Write report the applied change as a structured patch.
  if (Array.isArray(result.structuredPatch)) {
    const path = str(result.filePath);
    const created = result.type === 'create' && !result.structuredPatch.length && typeof result.content === 'string';
    const lines = created ? prefixed(result.content.replace(/\n$/, ''), 'add') : hunkLines(result.structuredPatch);
    return [
      ...(created ? [{ kind: 'note' as const, text: `Created ${path || 'the file'}` }] : []),
      ...(result.userModified === true ? [{ kind: 'note' as const, text: 'The user changed the proposed edit.' }] : []),
      lines.length ? diff(path ? `Changes · ${path}` : 'Changes', lines) : { kind: 'note', text: 'No changes.' },
    ];
  }
  const file = record(result.file);
  if (result.file && (typeof file.filePath === 'string' || typeof file.content === 'string' || typeof file.base64 === 'string')) {
    if (result.type === 'image')
      return [{ kind: 'note', text: `Image${str(file.type) ? ` (${file.type})` : ''}. The image is not shown here.` }];
    const start = num(file.startLine), lines = num(file.numLines), total = num(file.totalLines);
    const range = start !== undefined && lines !== undefined
      ? lines ? `Lines ${start}–${start + lines - 1}${total !== undefined ? ` of ${total}` : ''}` : `No lines${total !== undefined ? ` of ${total}` : ''}`
      : undefined;
    const sections: ToolSection[] = [
      ...(range ? [{ kind: 'note' as const, text: range }] : []),
      ...(typeof file.content === 'string' ? [{ kind: 'text' as const, label: str(file.filePath) || 'Content', text: file.content }] : []),
    ];
    // Unchanged files, notebooks, and PDF reads have no text range, so they show the tool_result text.
    if (sections.length) return sections;
  }
  if (Array.isArray(result.filenames)) {
    const files = result.filenames.filter((name): name is string => typeof name === 'string');
    const total = num(result.numFiles) ?? files.length;
    if (result.mode === 'content' || result.mode === 'count') {
      const matches = num(result.numMatches);
      const lines = num(result.numLines);
      return [
        { kind: 'note', text: result.mode === 'count' && matches !== undefined ? `${plural(matches, 'match', 'matches')} in ${plural(total, 'file')}`
          : lines !== undefined ? plural(lines, 'line') : 'Matches' },
        ...(str(result.content) ? [{ kind: 'text' as const, label: 'Matches', text: result.content }] : []),
      ];
    }
    const notes = [plural(total, 'file'), result.truncated === true ? 'list truncated' : undefined,
      num(result.appliedLimit) !== undefined ? `limit ${result.appliedLimit}` : undefined].filter(Boolean);
    return [{ kind: 'note', text: notes.join(' · ') }, ...(files.length ? [{ kind: 'text' as const, label: 'Files', text: files.join('\n') }] : [])];
  }
  if (Array.isArray(result.newTodos)) return [{ kind: 'todos', items: todoItems(result.newTodos) || [] }];
  if (Array.isArray(result.questions) && result.answers && typeof result.answers === 'object') {
    const answers = record(result.answers);
    const items = result.questions.map(record).filter((question) => typeof question.question === 'string')
      .map((question) => ({ question: question.question as string, answer: str(answers[question.question]) || '—' }));
    return [{ kind: 'answers', items }];
  }
  // Task and Agent: the subagent report and its totals.
  if (Array.isArray(result.content) && result.content.some((part: unknown) => record(part).type === 'text')) {
    const report = result.content.map(record).filter((part: Json) => part.type === 'text' && typeof part.text === 'string')
      .map((part: Json) => part.text).join('\n\n');
    const notes = [num(result.totalToolUseCount) !== undefined ? plural(result.totalToolUseCount, 'tool use') : undefined,
      num(result.totalTokens) !== undefined ? plural(result.totalTokens, 'token') : undefined,
      seconds(result.totalDurationMs), result.wasInterrupted === true ? 'interrupted' : undefined].filter(Boolean);
    return [...(notes.length ? [{ kind: 'note' as const, text: notes.join(' · ') }] : []), { kind: 'text', label: 'Report', text: report }];
  }
  if (result.status === 'async_launched')
    return [{ kind: 'note', text: `Started in the background${str(result.description) ? `: ${result.description}` : '.'}` }];
  if (typeof result.plan === 'string') return [{ kind: 'text', label: 'Plan', text: result.plan }];
  if (num(result.code) !== undefined && typeof result.result === 'string')
    return [{ kind: 'note', text: [`${result.code} ${str(result.codeText) || ''}`.trim(), str(result.url)].filter(Boolean).join(' · '), error: result.code >= 400 },
      { kind: 'text', label: 'Result', text: result.result }];
  if (typeof result.query === 'string' && Array.isArray(result.results)) {
    const links = result.results.flatMap((item: unknown) => Array.isArray(record(item).content) ? record(item).content.map(record) : [])
      .filter((link: Json) => typeof link.url === 'string').map((link: Json) => `${str(link.title) || link.url}\n${link.url}`);
    const summary = result.results.filter((item: unknown): item is string => typeof item === 'string').join('\n\n');
    return [{ kind: 'note', text: `Search: ${result.query}` },
      ...(links.length ? [{ kind: 'text' as const, label: 'Links', text: links.join('\n\n') }] : []),
      ...(summary ? [{ kind: 'text' as const, label: 'Summary', text: summary }] : [])];
  }
  if (result.success === true && typeof result.commandName === 'string') return [{ kind: 'note', text: `Loaded skill ${result.commandName}` }];
  return [{ kind: 'text', label: isError ? 'Error' : 'Result', text: call.resultText?.trim() ? call.resultText : fallbackJson(result), error: isError }];
}

function resultSections(call: ToolCall): ToolSection[] {
  const { result } = call;
  if (result === undefined) return [{ kind: 'text', label: 'Result', text: 'No result reported yet.' }];
  if (typeof result === 'string') {
    // A failed Claude Bash call reports its exit code on the first line.
    const exit = call.isError ? /^(?:Error: )?Exit code (\d+)(?:\n|$)/.exec(result) : null;
    if (exit) return [{ kind: 'note', text: `Exit code ${exit[1]}`, error: true },
      ...(result.slice(exit[0].length) ? [{ kind: 'text' as const, label: 'Output', text: result.slice(exit[0].length), error: true }] : [])];
    return [{ kind: 'text', label: call.isError ? 'Error' : 'Result', text: result, error: call.isError }];
  }
  if (result && typeof result === 'object' && !Array.isArray(result)) return structured(call, result as Json);
  return [{ kind: 'text', label: call.isError ? 'Error' : 'Result', text: call.resultText?.trim() ? call.resultText : fallbackJson(result), error: call.isError }];
}

// The sections of one tool row below its arguments: changes from the arguments, then the result.
export function toolSections(call: ToolCall): ToolSection[] {
  const result = resultSections(call);
  const input = record(call.input);
  const sections: ToolSection[] = [];
  if (!result.some((section) => section.kind === 'diff')) {
    const lines = Array.isArray(input.edits) ? input.edits.map(record).flatMap(editLines) : editLines(input);
    if (lines.length) sections.push(diff('Changes', lines));
  }
  const todos = todoItems(input.todos);
  if (todos?.length && !result.some((section) => section.kind === 'todos')) sections.push({ kind: 'todos', items: todos });
  return [...sections, ...result];
}

// Answers of an AskUserQuestion call, from its result.
export function toolAnswers(call: ToolCall) {
  if (!Array.isArray(record(call.result).questions)) return [];
  return resultSections(call).flatMap((section) => section.kind === 'answers' ? section.items : []);
}

export const TODO_MARK: Record<string, string> = { completed: '☑', in_progress: '◐', pending: '☐' };
// The text that a tool row shows for its sections, in order.
export function toolSectionsText(sections: ToolSection[]): string[] {
  return sections.flatMap((section) => {
    if (section.kind === 'note') return [section.text];
    if (section.kind === 'text') return [section.label, section.text];
    if (section.kind === 'diff') return [section.label, section.lines.map((line) => line.text).join('\n')];
    if (section.kind === 'todos') return [section.items.map((todo) => `${TODO_MARK[todo.status] || '☐'}${todo.content}`).join('\n')];
    return [section.items.map((item) => `${item.question}\n${item.answer}`).join('\n')];
  });
}
