import { markSubagents, subagentOf, type MessageRecord, type SubagentMarks } from '../happy/normalize';
import type { Message, Todo, ToolCall } from './types';

// Adapted from Happy Web sync/storageTypes.ts (TodoItemSchema), components/tools/views/TodoView.tsx,
// the TodoWrite entry in components/tools/knownTools.tsx, and latestTodos in sync/reducer/reducer.ts.
export type { Todo } from './types';

const statuses = new Set(['pending', 'in_progress', 'completed']);
const priorities = new Set(['high', 'medium', 'low']);
const field = (value: unknown, key: string) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
const object = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value);

// The whole list fails, as with a zod array, when one item has the wrong shape.
export function todoItems(value: unknown): Todo[] | null {
  if (!Array.isArray(value)) return null;
  const todos: Todo[] = [];
  for (const item of value) {
    const content = field(item, 'content'), status = field(item, 'status'), priority = field(item, 'priority'), id = field(item, 'id');
    if (typeof content !== 'string' || !statuses.has(status as string)) return null;
    if (priority !== undefined && !priorities.has(priority as string)) return null;
    if (id !== undefined && typeof id !== 'string') return null;
    todos.push({ content, status: status as Todo['status'], ...(priority ? { priority: priority as Todo['priority'] } : {}), ...(id !== undefined ? { id } : {}) });
  }
  return todos;
}

export const isTodoWrite = (call: ToolCall) => (call.tool ?? call.name) === 'TodoWrite';

// knownTools TodoWrite `result`: an object whose optional oldTodos and newTodos are valid lists. The list is newTodos.
export function resultTodos(result: unknown): Todo[] | null {
  if (!object(result)) return null;
  const old = field(result, 'oldTodos'), next = field(result, 'newTodos');
  if (old !== undefined && !todoItems(old)) return null;
  return next === undefined ? null : todoItems(next);
}
// TodoView: the input list, replaced by the result's newTodos when the result parses. Null when neither has a valid list.
// The tool row, the generic tool view, and the progress chip all use this one parser.
export function todoList(call: ToolCall): Todo[] | null {
  const input = object(call.input) && field(call.input, 'todos') !== undefined ? todoItems(field(call.input, 'todos')) : null;
  return resultTodos(call.result) ?? input;
}
export const toolTodos = (call: ToolCall): Todo[] => todoList(call) ?? [];
// The list that a TodoWrite row shows in place of its raw values. Without a list, or with an error, the raw values show,
// as Happy Web knownTools falls back to the generic tool view.
export const todoRowList = (call: ToolCall) => {
  const todos = isTodoWrite(call) && !call.isError ? toolTodos(call) : [];
  return todos.length ? todos : null;
};

export function todoProgress(todos: readonly Todo[]) {
  return {
    done: todos.filter(todo => todo.status === 'completed').length,
    total: todos.length,
    current: todos.find(todo => todo.status === 'in_progress'),
  };
}

const copyMarks = (marks?: SubagentMarks): SubagentMarks =>
  new Map([...marks || []].map(([id, entry]) => [id, { ...entry, bounds: new Map(entry.bounds) }]));

// The list from the newest main-thread TodoWrite call that finished without an error. A context reset clears the list.
// Session-protocol tool ends carry no result, so the call input supplies the list, as in TodoView.
// Calls without a valid list do not change the list. Subagent calls do not change it either, as Happy Web
// sync/reducer/reducer.ts skips sidechain messages. `visibleMessages` nests the calls inside the loaded subagent bounds.
// With `rows` and `known` (the bounds that the client read on other pages or before a reload), a call whose row is
// inside a subagent is skipped too. A row without a known bound stays a main row.
export function latestTodos(messages: readonly Message[], rows: Iterable<MessageRecord> = [], known?: SubagentMarks): Todo[] {
  const byId = new Map<string, MessageRecord>();
  for (const row of rows) byId.set(row.id, row);
  const marks = markSubagents(copyMarks(known), byId.values());
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.contextReset) return [];
    const row = byId.get(message.id);
    if (row && subagentOf(row, marks)) continue;
    const calls = message.toolCalls || [];
    for (let index = calls.length - 1; index >= 0; index--) {
      const call = calls[index];
      const todos = isTodoWrite(call) && call.ended && !call.isError ? todoList(call) : null;
      if (todos) return todos;
    }
  }
  return [];
}
