import { describe, expect, it } from 'vitest';
import { normalizeMessage, visibleMessages, type MessageRecord } from './normalize';
const row = (seq: number, raw: object): MessageRecord => ({ id: String(seq), seq, raw, createdAt: seq });
describe('tool details', () => {
  it('should pair session call results by ID when tools finish in a different order', () => {
    // Arrange
    const event = (ev: object) => ({ role: 'session', content: { type: 'session', data: { role: 'agent', ev } } });
    const rows = [row(1, event({ t: 'tool-call-start', call: 'a', name: 'Read', args: { file: 'a' } })),
      row(2, event({ t: 'tool-call-start', call: 'b', name: 'Edit', args: { old_string: 'a', new_string: 'b' } })),
      row(3, event({ t: 'tool-call-end', call: 'b', result: 'diff: -a +b' })),
      row(4, event({ t: 'tool-call-end', call: 'a', result: 'Permission denied', isError: true }))];
    // Act
    const messages = visibleMessages(rows);
    // Assert
    expect(messages).toHaveLength(2);
    expect(messages[0].toolCalls?.[0]).toMatchObject({ id: 'a', input: { file: 'a' }, result: 'Permission denied', isError: true });
    expect(messages[1].toolCalls?.[0].result).toBe('diff: -a +b');
  });
  it('should expose Claude output and Codex tool details across their wire formats', () => {
    // Arrange
    const rows = [row(1, { role: 'agent', content: { type: 'output', data: { type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'read', name: 'Read', input: { file_path: 'README' } },
    ] } } } }), row(2, { role: 'agent', content: { type: 'output', data: { type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'read', content: 'Read result' },
    ] } } } }), row(3, { role: 'agent', content: { type: 'codex', data: { type: 'tool-call', callId: 'shell', name: 'shell', input: { command: 'pwd' } } } }),
    row(4, { role: 'agent', content: { type: 'codex', data: { type: 'tool-call-result', callId: 'shell', output: '/workspace' } } })];
    // Act
    const messages = visibleMessages(rows);
    // Assert
    expect(messages.map(message => message.toolCalls?.[0].result)).toEqual(['Read result', '/workspace']);
  });
  it('should pair hyphenated call IDs in legacy output records', () => {
    // Arrange
    const rows = [row(1, { role: 'agent', content: { type: 'output', data: { type: 'assistant', message: { content: [
      { type: 'tool-call', callId: 'patch', name: 'apply_patch', input: { patch: '+ line' } },
    ] } } } }), row(2, { role: 'agent', content: { type: 'output', data: { type: 'user', message: { content: [
      { type: 'tool-call-result', callId: 'patch', output: 'Patch failed', is_error: true },
    ] } } } })];
    // Act
    const messages = visibleMessages(rows);
    // Assert
    expect(messages).toHaveLength(1);
    expect(messages[0].toolCalls?.[0]).toMatchObject({ id: 'patch', result: 'Patch failed', isError: true });
  });

  it('should retain model settings on image-only sends without an empty text bubble', () => {
    // Arrange
    const settings = { model: 'gpt-6.1-sol', effort: 'xhigh', permissionMode: 'yolo' };
    const file = row(1, { role: 'session', content: { type: 'session', data: { role: 'user', ev: {
      t: 'file', ref: 'encrypted-image', name: 'image.png', size: 123,
    } } } });
    const modes = row(2, { role: 'user', content: { type: 'text', text: '' }, meta: settings });
    // Act
    const messages = visibleMessages([file, modes]);
    // Assert
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ settings, attachments: [{ ref: 'encrypted-image' }] });
    expect(normalizeMessage(modes)?.settings).toEqual(settings);
  });

});
