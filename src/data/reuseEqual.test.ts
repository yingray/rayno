import { describe, expect, it } from 'vitest';
import { reuseEqual } from './reuseEqual';
import { groupChatActivity, type ToolActivityBlock } from './chatBlocks';
import { visibleMessages, type MessageRecord } from '../happy/normalize';
import { toolHeavyHistory } from '../../tests/fixtures/toolHeavyHistory';

const records = (raws: Record<string, unknown>[]): MessageRecord[] =>
  raws.map((raw, index) => ({ id: `row-${index + 1}`, seq: index + 1, createdAt: 1700000000000 + index, raw }));

describe('reuseEqual', () => {
  it('should return the previous object when all values are equal', () => {
    // Arrange
    const previous = { id: 'a', tools: ['Bash'], input: { command: 'ls' } };
    // Act
    const result = reuseEqual(previous, { id: 'a', tools: ['Bash'], input: { command: 'ls' } });
    // Assert
    expect(result).toBe(previous);
  });
  it('should keep the unchanged children of a changed object', () => {
    // Arrange
    const previous = { id: 'a', calls: [{ id: 'one', ended: false }, { id: 'two', ended: true }] };
    // Act
    const result = reuseEqual(previous, { id: 'a', calls: [{ id: 'one', ended: true }, { id: 'two', ended: true }] });
    // Assert
    expect(result).not.toBe(previous);
    expect(result.calls[0]).toEqual({ id: 'one', ended: true });
    expect(result.calls[1]).toBe(previous.calls[1]);
  });
  it('should match list items by id when older items load at the top', () => {
    // Arrange
    const previous = [{ id: 'b', text: 'B' }, { id: 'c', text: 'C' }];
    // Act
    const result = reuseEqual(previous, [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }]);
    // Assert
    expect(result[1]).toBe(previous[0]);
    expect(result[2]).toBe(previous[1]);
  });
  it('should keep old tool messages and tool groups when one text reply arrives', () => {
    // Arrange: 50 turns with 250 tool calls, like the performance fixture.
    const raws = toolHeavyHistory(50, 'Done');
    const before = reuseEqual(undefined, visibleMessages(records(raws)));
    const blocksBefore = groupChatActivity(before);
    const reply = { role: 'session', content: { id: 'reply', time: 1800000000000, role: 'agent', turn: 'next',
      ev: { t: 'text', text: 'One more reply' } }, meta: { sentFrom: 'cli' } };
    // Act
    const after = reuseEqual(before, visibleMessages(records([...raws, reply])));
    const blocksAfter = reuseEqual(blocksBefore, groupChatActivity(after));
    // Assert
    const tools = before.filter((message) => message.toolCalls?.length);
    expect(tools.length).toBeGreaterThan(50);
    expect(tools.filter((message) => after.includes(message))).toHaveLength(tools.length);
    const groups = blocksBefore.filter((block): block is ToolActivityBlock => block.kind === 'tools');
    expect(groups.filter((group) => blocksAfter.includes(group))).toHaveLength(groups.length);
    expect(after.at(-1)!.content).toBe('One more reply');
  });
});
