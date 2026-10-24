import { describe, expect, it } from 'vitest';
import { groupChatActivity } from './chatBlocks';
import { parseTranscriptAnchor, recapTargetBlock, searchTranscript } from './transcript';
import type { Message } from './types';

describe('transcript data navigation', () => {
  const messages: Message[] = [
    { id: 'u1', role: 'user', content: 'First task' },
    { id: 'tool1', role: 'assistant', content: '', tools: ['Read'], toolCalls: [{ id: 'call1', name: 'Read', input: { path: 'src/alpha.ts' }, result: 'Old diagnostic' }] },
    { id: 'a1', role: 'assistant', content: 'The **alpha check** passed.' },
    { id: 'u2', role: 'user', content: 'Second task' },
    { id: 'tool2', role: 'assistant', content: '', tools: ['Bash'], toolCalls: [{ id: 'call2', name: 'Bash', input: { command: 'npm test' }, result: 'Current diagnostic' }] },
    { id: 'a2', role: 'assistant', content: 'The beta check passed.' },
  ];
  it('should locate a quote in an unmounted reply with rendered Markdown text', () => {
    // Arrange
    const blocks = groupChatActivity(messages);
    // Act / Assert
    expect(recapTargetBlock(blocks, 'a1', 'alpha check')).toBe('message:a1');
  });
  it('should locate a tool quote only within the reply turn', () => {
    // Arrange
    const blocks = groupChatActivity(messages);
    // Act / Assert
    expect(recapTargetBlock(blocks, 'a2', 'Current diagnostic')).toBe('tools:tool2');
    expect(recapTargetBlock(blocks, 'a2', 'Old diagnostic')).toBeUndefined();
    expect(recapTargetBlock(blocks, 'a2', '')).toBeUndefined();
  });
  it('should search loaded replies and tool input without DOM nodes', () => {
    // Arrange
    const blocks = groupChatActivity(messages);
    // Act / Assert
    expect(searchTranscript(blocks, 'ALPHA').map(result => result.id)).toEqual(['tools:tool1', 'message:a1']);
    expect(searchTranscript(blocks, 'npm test')[0]).toMatchObject({ id: 'tools:tool2', tools: true });
    expect(searchTranscript(blocks, 'unloaded text')).toEqual([]);
    expect(searchTranscript(blocks, '  ')).toEqual([]);
  });
  it('should accept finite saved anchors and reject invalid persisted values', () => {
    // Arrange
    const anchor = { id: 'message:a1', inset: -15, pinned: false, full: true };
    // Act / Assert
    expect(parseTranscriptAnchor(JSON.stringify(anchor))).toEqual(anchor);
    expect(parseTranscriptAnchor('{"id":42,"inset":0,"pinned":false,"full":false}')).toBeUndefined();
    expect(parseTranscriptAnchor('{"inset":"bad","pinned":false,"full":false}')).toBeUndefined();
    expect(parseTranscriptAnchor('not JSON')).toBeUndefined();
  });
});
