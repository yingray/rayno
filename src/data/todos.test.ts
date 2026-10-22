import { describe, expect, it } from 'vitest';
import { visibleMessages, type MessageRecord } from '../happy/normalize';
import { latestTodos, todoItems, todoProgress, todoRowList, toolTodos } from './todos';

const row = (id: string, seq: number, raw: object): MessageRecord => ({ id, seq, raw, createdAt: 1000 + seq });
const claude = { userType: 'external', cwd: '/Users/steve/Develop/slopus/happy-cli', sessionId: '2c74184e-6979-476d-a52f-0ac183bffe3a',
  version: '1.0.71', gitBranch: 'main' };
const output = (data: object) => ({ role: 'agent', content: { type: 'output', data }, meta: { sentFrom: 'cli' } });
// happy-cli claude/utils/sessionProtocolMapper.ts: tool-call-start has the raw name, a `<name> call` title, and no end result.
const envelope = (ev: object, extra: object = {}) => ({ role: 'session', content: {
  id: 'cmh1envelope0000000000000', time: 1000, role: 'agent', turn: 'cmh1turn00000000000000000', ev, ...extra,
}, meta: { sentFrom: 'cli' } });
const todoCall = (id: string, seq: number, list: object[], extra: object = {}) => [
  row(`start-${id}`, seq, envelope({ t: 'tool-call-start', call: id, name: 'TodoWrite', title: 'TodoWrite call',
    description: 'TodoWrite call', args: { todos: list } }, extra)),
  row(`end-${id}`, seq + 1, envelope({ t: 'tool-call-end', call: id }, extra)),
];
const todos = [
  { content: 'Implement OPTION_B follow-up', status: 'completed', activeForm: 'Implementing OPTION_B follow-up' },
  { content: 'Inspect ../sibling-dir boundary', status: 'in_progress', activeForm: 'Inspecting ../sibling-dir boundary' },
  { content: 'Reply with DONE', status: 'pending', activeForm: 'Replying with DONE' },
];
const legacyCall = (id: string, seq: number, input: object) => row(`call-${id}`, seq, output({ ...claude, type: 'assistant', uuid: `uuid-${id}`,
  message: { role: 'assistant', model: 'claude-sonnet-4-20250514', content: [{ type: 'tool_use', id, name: 'TodoWrite', input }] } }));
const legacyResult = (id: string, seq: number, toolUseResult: object, isError = false) => row(`result-${id}`, seq, output({
  ...claude, type: 'user', uuid: `uuid-result-${id}`, isSidechain: false,
  message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', is_error: isError,
    content: 'Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress.' }] },
  toolUseResult,
}));

describe('todo list', () => {
  it('should read newTodos from a structured Claude toolUseResult over the call input', () => {
    // Arrange
    const updated = todos.map(todo => ({ ...todo, status: 'completed' }));
    const rows = [legacyCall('toolu_todo', 1, { todos }), legacyResult('toolu_todo', 2, { oldTodos: todos, newTodos: updated })];
    // Act
    const [message] = visibleMessages(rows);
    // Assert
    expect(message.toolCalls?.[0]).toMatchObject({ name: 'TodoWrite', ended: true, resultData: { newTodos: updated } });
    expect(toolTodos(message.toolCalls![0]).map(todo => todo.status)).toEqual(['completed', 'completed', 'completed']);
    expect(latestTodos([message])).toHaveLength(3);
  });

  it('should use the call input for a session-protocol TodoWrite that ended without a result', () => {
    // Arrange
    const rows = [
      row('start', 1, envelope({ t: 'tool-call-start', call: 'toolu_todo', name: 'TodoWrite', title: 'TodoWrite call',
        description: 'TodoWrite call', args: { todos } })),
      row('end', 2, envelope({ t: 'tool-call-end', call: 'toolu_todo' })),
    ];
    // Act
    const messages = visibleMessages(rows);
    // Assert
    expect(messages[0].toolCalls?.[0]).toMatchObject({ name: 'TodoWrite call', tool: 'TodoWrite', ended: true });
    expect(todoProgress(latestTodos(messages))).toEqual({ done: 1, total: 3, current: { content: 'Inspect ../sibling-dir boundary', status: 'in_progress' } });
  });

  it('should ignore a running, failed, or invalid TodoWrite and keep the earlier list', () => {
    // Arrange
    const rows = [
      legacyCall('first', 1, { todos }), legacyResult('first', 2, { oldTodos: [], newTodos: todos }),
      legacyCall('failed', 3, { todos: [{ content: 'Broken update', status: 'pending' }] }),
      legacyResult('failed', 4, { error: 'InputValidationError' }, true),
      legacyCall('running', 5, { todos: [{ content: 'Not confirmed yet', status: 'pending' }] }),
      ...todoCall('toolu_invalid', 6, [{ content: 'Wrong status', status: 'done' }]),
    ];
    // Act
    const latest = latestTodos(visibleMessages(rows));
    // Assert
    expect(latest.map(todo => todo.content)).toEqual(todos.map(todo => todo.content));
    expect(latestTodos(visibleMessages([...rows, ...todoCall('toolu_empty', 8, [])]))).toEqual([]);
  });

  it('should ignore a subagent TodoWrite and use a main TodoWrite that keeps the finished subagent id', () => {
    // Arrange
    const subagent = { subagent: 'c744020fe7d250cca47a5ae1' };
    const main = [{ content: 'Main step', status: 'in_progress', activeForm: 'Doing the main step' }];
    const child = [{ content: 'Subagent step', status: 'in_progress', activeForm: 'Doing the subagent step' }];
    const after = [{ content: 'Main step', status: 'completed', activeForm: 'Doing the main step' },
      { content: 'Main follow-up', status: 'in_progress', activeForm: 'Doing the main follow-up' }];
    const rows = [
      ...todoCall('toolu_main', 1, main),
      row('agent', 3, envelope({ t: 'tool-call-start', call: 'toolu_agent', name: 'Agent', title: 'Find config', description: 'Find config',
        args: { description: 'Find config', prompt: 'Find the config file.', subagent_type: 'general-purpose', sessionSubagent: subagent.subagent } })),
      row('sub-start', 4, envelope({ t: 'start', title: 'Find config' }, subagent)),
      ...todoCall('toolu_child', 5, child, subagent),
    ];
    const finished = [
      ...rows,
      row('sub-stop', 7, envelope({ t: 'stop' }, subagent)),
      row('agent-end', 8, envelope({ t: 'tool-call-end', call: 'toolu_agent' }, subagent)),
      ...todoCall('toolu_after', 9, after, subagent),
    ];
    // Act
    const running = visibleMessages(rows);
    const done = visibleMessages(finished);
    // Assert
    expect(running.find(message => message.id === 'start-toolu_child')?.toolCalls?.[0]).toMatchObject({ ended: true, sidechain: true });
    expect(latestTodos(running).map(todo => todo.content)).toEqual(['Main step']);
    expect(done.find(message => message.id === 'start-toolu_after')?.toolCalls?.[0].sidechain).toBeUndefined();
    expect(latestTodos(done).map(todo => todo.content)).toEqual(['Main step', 'Main follow-up']);
  });

  it('should clear the list after the CLI context reset event', () => {
    // Arrange
    const rows = [
      legacyCall('first', 1, { todos }), legacyResult('first', 2, { oldTodos: [], newTodos: todos }),
      row('reset', 3, { role: 'agent', content: { id: 'event-1', type: 'event', data: { type: 'message', message: 'Context was reset' } } }),
    ];
    // Act
    const messages = visibleMessages(rows);
    // Assert
    expect(messages.at(-1)).toMatchObject({ content: '', contextReset: true });
    expect(latestTodos(messages)).toEqual([]);
  });

  it('should reject a list with one malformed item, as TodoItemsSchema does', () => {
    // Arrange
    const invalid = [{ content: 'Fine', status: 'pending' }, { content: 'Wrong', status: 'done' }];
    // Act / Assert
    expect(todoItems(invalid)).toBeNull();
    expect(todoItems('[{"content":"Broken","status":"pending"}]')).toBeNull();
    expect(todoItems([{ id: '1', content: 'Fix errors', status: 'completed', priority: 'high' }]))
      .toEqual([{ id: '1', content: 'Fix errors', status: 'completed', priority: 'high' }]);
    expect(toolTodos({ id: 'x', name: 'TodoWrite', input: { todos: invalid } })).toEqual([]);
  });

  it('should show the raw values of a TodoWrite row without a valid list or with an error', () => {
    // Arrange
    const call = { id: 'toolu_todo', name: 'TodoWrite call', tool: 'TodoWrite', ended: true };
    // Act / Assert
    expect(todoRowList({ ...call, input: { todos } })).toHaveLength(3);
    expect(todoRowList({ ...call, ended: false, input: { todos } })).toHaveLength(3);
    expect(todoRowList({ ...call, input: { todos: [{ content: 'Wrong', status: 'done' }] } })).toBeNull();
    expect(todoRowList({ ...call, input: { todos: [] } })).toBeNull();
    expect(todoRowList({ ...call, input: { todos }, isError: true, result: 'InputValidationError' })).toBeNull();
    expect(todoRowList({ id: 'x', name: 'Read', input: { todos } })).toBeNull();
  });
});
