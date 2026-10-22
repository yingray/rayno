import { expect, it } from 'vitest';
import { withRequestHistory } from './toolHistory';
import type { Message } from '../data/types';

it('should retain a denied command that never emitted a tool call', () => {
  // Arrange
  const messages: Message[] = [{ id: 'reply', role: 'assistant', content: 'The command was not run.' }];
  const state = { completedRequests: { request: { toolUseId: 'command', tool: 'Bash',
    arguments: { command: 'rm example' }, status: 'denied', reason: 'Keep it', createdAt: 10 } } };
  // Act
  const result = withRequestHistory(messages, state, [{ id: 'reply', seq: 1, createdAt: 20, raw: {} }]);
  // Assert
  expect(result[0].toolCalls?.[0]).toMatchObject({ id: 'command', permission: { status: 'denied', reason: 'Keep it' },
    ended: true, result: 'The request was denied before execution.' });
  expect(result[1]).toBe(messages[0]);
});

it('should avoid duplicate decisions for nested calls and approved requests', () => {
  // Arrange
  const messages: Message[] = [{ id: 'parent', role: 'assistant', content: '', toolCalls: [{ id: 'parent-call', name: 'Agent',
    children: [{ id: 'child', role: 'assistant', content: '', toolCalls: [{ id: 'nested', name: 'Bash' }] }] }] }];
  const state = { completedRequests: { nested: { tool: 'Bash', status: 'canceled' }, approved: { tool: 'Bash', status: 'approved' } } };
  // Act
  const result = withRequestHistory(messages, state, []);
  // Assert
  expect(result).toBe(messages);
});
