import { describe, expect, it } from 'vitest';
import { groupChatActivity } from './chatBlocks';
import type { Message } from './types';

const tool = (id: string, name = 'Read'): Message => ({
  id, role: 'assistant', content: '', tools: [name],
});

describe('Chat activity groups', () => {
  it('should group consecutive tools and retain repeated calls in their original order', () => {
    // Arrange
    const messages = [tool('read-1'), tool('read-2'), tool('edit', 'Edit')];
    // Act
    const blocks = groupChatActivity(messages);
    // Assert
    expect(blocks).toEqual([{ kind: 'tools', id: 'tools:read-1', tools: ['Read', 'Read', 'Edit'] }]);
    expect(messages[0].tools).toEqual(['Read']);
  });

  it('should separate tool runs at assistant text, user messages, and attachments', () => {
    // Arrange
    const messages: Message[] = [
      tool('first'),
      { id: 'text', role: 'assistant', content: 'A result' },
      tool('second'),
      { id: 'user', role: 'user', content: 'Continue' },
      tool('third'),
      { id: 'file', role: 'assistant', content: '', attachments: [{ name: 'report.txt', size: 2, type: 'text/plain' }] },
      tool('fourth'),
    ];
    // Act
    const blocks = groupChatActivity(messages);
    // Assert
    expect(blocks.map((block) => block.id)).toEqual([
      'tools:first', 'message:text', 'tools:second', 'message:user',
      'tools:third', 'message:file', 'tools:fourth',
    ]);
  });

  it('should keep mixed message content and use a stable group ID when another tool arrives', () => {
    // Arrange
    const mixed: Message = { ...tool('mixed'), content: 'The result', duration: '4s' };
    // Act
    const blocks = groupChatActivity([mixed, tool('next'), tool('last', 'Edit')]);
    const before = groupChatActivity([mixed, tool('next')]);
    // Assert
    expect(blocks[0]).toMatchObject({ kind: 'tools', duration: '4s' });
    expect(blocks[1]).toEqual({ kind: 'message', id: 'message:mixed', message: mixed });
    expect(blocks[2]).toMatchObject({ id: before[2].id, tools: ['Read', 'Edit'] });
  });
});
