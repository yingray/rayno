import type { Message, ToolCall } from './types';

// Adapted from Happy Web sync/storageTypes.ts (TodoItemSchema), components/tools/views/TodoView.tsx,
// the TodoWrite entry in components/tools/knownTools.tsx, and latestTodos in sync/reducer/reducer.ts.
export type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed'; priority?: 'high' | 'medium' | 'low'; id?: string };

const statuses = new Set(['pending', 'in_progress', 'completed']);
const priorities = new Set(['high', 'medium', 'low']);
const field = (value: unknown, key: string) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;

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

// TodoView: the input list, replaced by the result's newTodos when the result has a valid list.
const validTodos = (call: ToolCall) => todoItems(field(call.resultData ?? call.result, 'newTodos')) ?? todoItems(field(call.input, 'todos'));
export const toolTodos = (call: ToolCall): Todo[] => validTodos(call) ?? [];
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

// The list from the newest main-thread TodoWrite call that finished without an error. A context reset clears the list.
// Session-protocol tool ends carry no result, so the call input supplies the list, as in TodoView.
// Subagent calls and calls without a valid list do not change the list, as in Happy Web sync/reducer/reducer.ts.
export function latestTodos(messages: readonly Message[]): Todo[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.contextReset) return [];
    const calls = message.toolCalls || [];
    for (let index = calls.length - 1; index >= 0; index--) {
      const call = calls[index];
      const todos = isTodoWrite(call) && call.ended && !call.isError && !call.sidechain ? validTodos(call) : null;
      if (todos) return todos;
    }
  }
  return [];
}
