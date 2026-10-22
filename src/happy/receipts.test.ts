import { describe, expect, it } from 'vitest';
import { deliveryMeta, messageReceipt, sendsMessageReceipts, visibleMessages } from './normalize';
import type { Json, MessageRecord } from './normalize';
import { hasOpenRecapRequest, unansweredMessageIds } from '../data/replyTurns';
import { recapView } from '../data/recapView';
import { receiveAttention, restoreAttention } from './sessionAttention';
import { latestSentModes, modeBeforePlan } from './modelPreferences';
import { RECAP_REQUEST } from './systemPrompt';

const row = (id: string, seq: number, raw: Json, createdAt = 1000, localId?: string): MessageRecord => ({ id, seq, raw, createdAt, localId });
const sent = (id: string, seq: number, text: string, meta: Json = { expectsAcceptance: true, queuedWhileBusy: false }) =>
  row(id, seq, { role: 'user', content: { type: 'text', text }, meta: { sentFrom: 'web', ...meta } }, 1000 + seq, 'local-' + id);
// Byte-for-byte the envelopes from happy-app sync/reducer/pendingUserMessages.spec.ts.
const accepted = (ref: string, seq: number) => row('server-receipt-' + seq, seq, {
  role: 'session',
  content: { id: 'accepted:' + ref, time: 4000, role: 'agent', ev: { t: 'user-message-accepted', id: 'msg-' + seq, ref, runId: 'run-1' } },
  meta: { sentFrom: 'rig' },
}, 4000, 'rig:accepted:msg-' + seq);
const rejected = (ref: string, seq: number, reason = 'That model is not available.') => row('relay-refusal-' + seq, seq, {
  role: 'session',
  content: { id: 'refused:' + ref, time: 3000, role: 'agent', ev: { t: 'user-message-rejected', ref, reason } },
  meta: { sentFrom: 'rig' },
}, 3000, 'rig:refused:' + ref);
const reply = (id: string, seq: number, text: string) => row(id, seq, { role: 'session', content: { role: 'agent', turn: 't1', ev: { t: 'text', text } } });
// From happy-app sync/__testdata__/rigMetadata.ts, with the receipt capability.
const rig = { rigMetadataVersion: 1, client: { id: 'rig', name: 'Rig', version: '0.0.30' }, flavor: 'codex',
  capabilities: { abort: true, modelSelection: true, reasoningSelection: true, permissionModeSelection: true, resume: false, messageReceipts: true } };

describe('Happy Agent message receipts', () => {
  it('should read accepted and rejected receipts in the session, database, and legacy event forms', () => {
    // Arrange
    const database = { role: 'agent', content: { type: 'session', data: { id: 'env-accepted-1', time: 4200, role: 'agent',
      ev: { t: 'user-message-accepted', id: 'agent-message-1', ref: 'server-message-1', runId: 'run-1' } } } };
    const legacy = { role: 'agent', content: { type: 'event', id: 'event-1', data: { type: 'user-message-rejected', ref: 'server-2', reason: 'Busy' } } };
    // Act
    const results = [accepted('server-1', 2).raw, rejected('server-1', 3).raw, database, legacy,
      { role: 'session', content: { role: 'agent', ev: { t: 'text', text: 'Not a receipt' } } }].map(messageReceipt);
    // Assert
    expect(results).toEqual([{ ref: 'server-1' }, { ref: 'server-1', reason: 'That model is not available.' },
      { ref: 'server-message-1' }, { ref: 'server-2', reason: 'Busy' }, null]);
  });
  it('should hold a sent message at the end until its receipt places it where the agent took it', () => {
    // Arrange
    const rows = [reply('old', 1, 'Still working'), sent('steer', 2, 'Steer me'), reply('more', 3, 'More output')];
    // Act
    const held = visibleMessages(rows, true);
    const released = visibleMessages([...rows, reply('after', 4, 'Turn end'), accepted('steer', 5), reply('answer', 6, 'Steered')], true);
    // Assert
    expect(held.map((message) => message.content)).toEqual(['Still working', 'More output', 'Steer me']);
    expect(held[2].delivery).toEqual({ status: 'pending', queued: false, since: 1002 });
    expect(released.map((message) => message.content)).toEqual(['Still working', 'More output', 'Turn end', 'Steer me', 'Steered']);
    expect(released[3]).not.toHaveProperty('delivery');
  });
  it('should keep a rejected message failed with its reason across receipt-first and message-first loads', () => {
    // Arrange
    const message = sent('server-1', 1, 'try this');
    const answer = reply('old-answer', 2, 'still working');
    // Act
    const messageFirst = visibleMessages([message, answer, rejected('server-1', 3)], true);
    const receiptFirst = visibleMessages([rejected('server-1', 3), answer, message], true);
    // Assert
    for (const messages of [messageFirst, receiptFirst]) {
      expect(messages.map((item) => item.content)).toEqual(['still working', 'try this']);
      expect(messages[1].delivery).toEqual({ status: 'rejected', reason: 'That model is not available.' });
    }
  });
  it('should use only the first receipt and never hold a message in a session without receipts', () => {
    // Arrange
    const rows = [sent('a', 1, 'First', { expectsAcceptance: true, queuedWhileBusy: true }), reply('r', 2, 'Reply'), sent('b', 3, 'Second')];
    // Act
    const queued = visibleMessages(rows, true);
    const plain = visibleMessages(rows, false);
    const twice = visibleMessages([...rows, accepted('b', 4), rejected('b', 5)], true);
    // Assert
    expect(queued.map((message) => message.delivery?.status === 'pending' && message.delivery.queued)).toEqual([false, true, false]);
    expect(plain.map((message) => message.content)).toEqual(['First', 'Reply', 'Second']);
    expect(plain.some((message) => message.delivery)).toBe(false);
    expect(twice.find((message) => message.id === 'b')).not.toHaveProperty('delivery');
  });
  it('should not let a rejected message answer the reply options before it', () => {
    // Arrange
    const messages = visibleMessages([reply('options', 1, 'Choose one'), sent('refused', 2, 'Option A'), rejected('refused', 3)], true);
    // Act
    const unanswered = unansweredMessageIds(messages);
    // Assert
    expect(unanswered.has('options')).toBe(true);
  });
  it('should detect receipt support only from an explicit Happy Agent capability', () => {
    // Arrange
    const variants = [rig, { ...rig, capabilities: { ...rig.capabilities, messageReceipts: false } },
      { ...rig, capabilities: { ...rig.capabilities, messageReceipts: undefined } }, { ...rig, rigMetadataVersion: 0 },
      { ...rig, client: { id: 'other' } }, { flavor: 'claude' }];
    // Act
    const supported = variants.map(sendsMessageReceipts);
    // Assert
    expect(supported).toEqual([true, false, false, false, false, false]);
  });
  it('should mark sends that wait behind a turn or a permission and not behind a question', () => {
    // Arrange
    const question = { communications: { q: { kind: 'form', form: { questions: [{ id: 'q1', header: 'Pick', question: 'Which?', options: [{ label: 'A' }] }] } } } };
    // Act
    const results = [
      deliveryMeta(rig, {}, false, false),
      deliveryMeta(rig, {}, true, false),
      deliveryMeta(rig, { requests: { p: { tool: 'bash', arguments: {} } } }, false, false),
      deliveryMeta(rig, question, true, false),
      deliveryMeta(rig, {}, false, true),
      deliveryMeta({ flavor: 'claude' }, {}, true, true),
    ];
    // Assert
    expect(results).toEqual([
      { expectsAcceptance: true, queuedWhileBusy: false }, { expectsAcceptance: true, queuedWhileBusy: true },
      { expectsAcceptance: true, queuedWhileBusy: true }, { expectsAcceptance: true, queuedWhileBusy: false },
      { expectsAcceptance: true, queuedWhileBusy: true }, {},
    ]);
  });
});

// The session-list fold, with the page lookup that HappyClient.fetchAttention and mergeMessages give it.
const attention = (rows: MessageRecord[], receipts = true) => {
  const byId = new Map(rows.map((item) => [item.id, item]));
  const state = rows.reduce((value, item) => receiveAttention(value, item, undefined, receipts, (ref) => byId.get(ref)), restoreAttention(null, 0));
  return state.optionsSeq > state.userSeq;
};
const choose = (id: string, seq: number) => reply(id, seq, 'Pick one\n<options><option>A</option><option>B</option></options>');
const recapRequest = (id: string, seq: number) => row(id, seq, { role: 'user', content: { type: 'text', text: RECAP_REQUEST },
  meta: { sentFrom: 'web', raynoRecap: true, displayText: 'Recap', expectsAcceptance: true, queuedWhileBusy: false } }, 1000 + seq);

describe('Happy Agent receipts in reply state', () => {
  it('should keep needs reply and the chat options in step for a queued message that the agent accepts after the options', () => {
    // Arrange
    const held = [reply('working', 1, 'Working'), sent('steer', 2, 'Steer', { expectsAcceptance: true, queuedWhileBusy: true }), choose('options', 3)];
    const settled = [...held, accepted('steer', 4), reply('done', 5, 'Steered')];
    // Act
    const states = [held, settled].map((rows) => ({
      list: attention(rows), chat: unansweredMessageIds(visibleMessages(rows, true)).has('options'),
    }));
    // Assert
    expect(states).toEqual([{ list: true, chat: true }, { list: false, chat: false }]);
  });
  it('should keep needs reply and the chat options open when the agent rejects the answer', () => {
    // Arrange
    const rows = [choose('options', 1), sent('answer', 2, 'A'), rejected('answer', 3)];
    // Act
    const list = attention(rows);
    const chat = unansweredMessageIds(visibleMessages(rows, true)).has('options');
    // Assert
    expect({ list, chat }).toEqual({ list: true, chat: true });
  });
  it('should not let an accepted recap request answer options, and count a plain send at once without receipts', () => {
    // Arrange
    const recap = [choose('options', 1), recapRequest('recap', 2), accepted('recap', 3)];
    const plain = [choose('options', 1), sent('answer', 2, 'A')];
    // Act / Assert
    expect(attention(recap)).toBe(true);
    expect(unansweredMessageIds(visibleMessages(recap, true)).has('options')).toBe(true);
    expect(attention(plain, false)).toBe(false);
    expect(attention(plain, true)).toBe(true);
  });
  it('should not let a rejected message close a recap request, hide the request, or set the last sent modes', () => {
    // Arrange
    const modes = { expectsAcceptance: true, queuedWhileBusy: false, model: 'gpt-5.4', effort: 'high', permissionMode: 'safe-yolo' };
    const rows = [sent('first', 1, 'Start', modes), accepted('first', 2), reply('answer', 3, 'Done'), recapRequest('recap', 4), accepted('recap', 5),
      sent('refused', 6, 'Try this', { ...modes, model: 'missing-model', permissionMode: 'read-only' }), rejected('refused', 7)];
    const refusedRecap = [reply('answer', 1, 'Done'), recapRequest('recap', 2), rejected('recap', 3, 'Busy')];
    // Act
    const messages = visibleMessages(rows, true);
    const refused = visibleMessages(refusedRecap, true);
    // Assert
    expect(hasOpenRecapRequest(messages)).toBe(true);
    expect(recapView(messages).pending).toEqual({ requestId: 'recap', targetId: 'answer' });
    expect(latestSentModes(messages)).toEqual({ model: 'gpt-5.4', effort: 'high', permissionMode: 'safe-yolo', sentAt: 1001 });
    expect(modeBeforePlan(null, messages, undefined, { ...rig, operatingModes: [{ code: 'safe-yolo' }, { code: 'read-only' }] })).toBe('safe-yolo');
    expect(hasOpenRecapRequest(refused)).toBe(false);
    expect(recapView(refused).hidden.has('recap')).toBe(false);
  });
});
