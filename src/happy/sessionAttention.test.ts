import { describe, expect, it } from 'vitest';
import { attentionMessage, receiveAttention, restoreAttention, mergeAttention } from './sessionAttention';
import type { MessageRecord } from './normalize';
import { agentSubagentTurn } from './subagentEnvelopes.fixture';

const row = (seq: number, content: string, role = 'agent'): MessageRecord => ({
  id: String(seq), seq, createdAt: seq,
  raw: role === 'user' ? { role, content: { type: 'text', text: content } }
    : { role, content: { type: 'codex', data: { type: 'message', message: content } } },
});
describe('Session attention', () => {
  it('should establish a first-use baseline and retain newer unread replies across reload', () => {
    // Arrange
    const initial = restoreAttention(null, 10);
    // Act
    const old = receiveAttention(initial, row(9, 'An old reply'));
    const incoming = receiveAttention(old, row(11, 'A new reply'));
    const restored = restoreAttention(JSON.stringify(incoming), 100);
    // Assert
    expect(old.assistantSeq).toBeLessThanOrEqual(old.readSeq);
    expect(restored.assistantSeq).toBeGreaterThan(restored.readSeq);
    expect(restored.readSeq).toBe(10);
    expect(restoreAttention('{broken', 12).readSeq).toBe(12);
    expect(restoreAttention(JSON.stringify({ ...incoming, readSeq: -1 }), 12).readSeq).toBe(12);
  });
  it('should ignore tool activity and hidden receipts and not revive an old reply', () => {
    // Arrange
    const state = receiveAttention(restoreAttention(null, 20), row(18, 'An old reply'));
    const tool: MessageRecord = { ...row(21, ''), raw: { role: 'session', content: {
      role: 'agent', ev: { t: 'tool-call-start', name: 'Read' },
    } } };
    const receipt: MessageRecord = { ...row(22, ''), raw: { role: 'session', content: {
      role: 'agent', ev: { t: 'user-message-accepted', ref: 'old' },
    } } };
    // Act / Assert
    expect(attentionMessage(tool)).toBeNull();
    expect(attentionMessage(receipt)).toBeNull();
    expect(receiveAttention(receiveAttention(state, tool), receipt)).toEqual(state);
    expect(receiveAttention(state, row(5, 'History')).assistantSeq).toBe(18);
  });
  it('should keep real options pending until a later user reply and exclude code examples', () => {
    // Arrange
    const question = row(11, '<options><option>繼續 ✓</option></options>');
    let state = receiveAttention(restoreAttention(null, 10), question);
    // Act / Assert
    expect(state.optionsSeq).toBeGreaterThan(state.userSeq);
    state = receiveAttention(state, row(12, 'More details'));
    expect(state.optionsSeq).toBeGreaterThan(state.userSeq);
    state = receiveAttention(state, row(13, '繼續 ✓', 'user'));
    expect(state.optionsSeq).toBeLessThan(state.userSeq);
    state = receiveAttention(state, row(14, '```xml\n<options><option>Example</option></options>\n```'));
    expect(state.optionsSeq).toBe(11);
  });
  it('should not count a hidden recap request as a user reply to pending options', () => {
    // Arrange
    const question = row(11, '<options><option>Continue</option></options>');
    const request: MessageRecord = { ...row(12, ''), raw: { role: 'user', content: { type: 'text', text: '[rayno] Recap your previous reply.' },
      meta: { raynoRecap: true, displayText: 'Recap' } } };
    const answer = row(13, '<rayno-recap>\nAsk to continue.\n</rayno-recap>');
    let state = receiveAttention(restoreAttention(null, 10), question);
    // Act
    state = receiveAttention(receiveAttention(state, request), answer);
    // Assert
    expect(attentionMessage(request)).toBeNull();
    expect(state.userSeq).toBe(0);
    expect(state.optionsSeq).toBe(11);
    expect(state.optionsSeq).toBeGreaterThan(state.userSeq);
    expect(state.assistantSeq).toBe(13);
  });
  it('should count a terminal prompt as a user reply and ignore sidechain options', () => {
    // Arrange
    const question = row(11, '<options><option>Continue</option></options>');
    const typed: MessageRecord = { ...row(12, ''), raw: { role: 'agent', content: { type: 'output', data: {
      type: 'user', isSidechain: false, uuid: 'ddf5d729-6843-4230-b696-3f671a2603c7', message: { role: 'user', content: 'Continue' },
    } } } };
    const subagentPrompt: MessageRecord = { ...row(13, ''), raw: { role: 'agent', content: { type: 'output', data: {
      type: 'user', isSidechain: true, parentUuid: null, uuid: '7e733248-6fc5-4581-b3d3-db3741158fdd',
      message: { role: 'user', content: 'Search the web for TypeScript 5.6.' },
    } } } };
    const sidechainOptions: MessageRecord = { ...row(14, ''), raw: { role: 'agent', content: { type: 'output', data: {
      type: 'assistant', isSidechain: true, uuid: '317a6037-41ef-4625-8d61-df44e398f533',
      message: { role: 'assistant', model: 'claude-sonnet-4-20250514', content: [{ type: 'text', text: '<options><option>More</option></options>' }] },
    } } } };
    // Act
    const answered = receiveAttention(receiveAttention(restoreAttention(null, 10), question), typed);
    const later = [subagentPrompt, sidechainOptions].reduce(receiveAttention, answered);
    // Assert
    expect(attentionMessage(typed)).toBe('user');
    expect(answered.userSeq).toBe(12);
    expect(answered.optionsSeq).toBeLessThan(answered.userSeq);
    expect([subagentPrompt, sidechainOptions].map(attentionMessage)).toEqual([null, null]);
    expect(later).toEqual(answered);
  });
  it('should set needs reply for options in a main reply that the CLI tags with a finished subagent', () => {
    // Arrange
    const rows = agentSubagentTurn.map((raw, index) => ({ id: raw.content.id, seq: 21 + index, createdAt: raw.content.time, raw }));
    const final = rows.find((item) => item.raw.content.ev.text?.startsWith('TURN1'))!;
    // Act
    const state = rows.reduce(receiveAttention, receiveAttention(restoreAttention(null, 10), row(20, 'Ask the agent', 'user')));
    // Assert
    expect(attentionMessage(final)).toBe('assistant');
    expect(state.optionsSeq).toBe(final.seq);
    expect(state.optionsSeq).toBeGreaterThan(state.userSeq);
  });
  it('should merge another tab without moving any read or reply cursor backward', () => {
    // Arrange
    const current = { readSeq: 11, assistantSeq: 15, userSeq: 12, optionsSeq: 10, inspectedSeq: 15 };
    const other = { readSeq: 15, assistantSeq: 13, userSeq: 14, optionsSeq: 13, inspectedSeq: 13 };
    // Act / Assert
    expect(mergeAttention(current, other)).toEqual({
      readSeq: 15, assistantSeq: 15, userSeq: 14, optionsSeq: 13, inspectedSeq: 15,
    });
  });
});
