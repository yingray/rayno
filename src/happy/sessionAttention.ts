import { partsForMessage } from '../data/messageOptions';
import { messageReceipt, normalizeMessage, subagentOf, unplacedSubagent, type MessageRecord, type SubagentMarks } from './normalize';

export type SessionAttention = {
  readSeq: number;
  assistantSeq: number;
  userSeq: number;
  optionsSeq: number;
  inspectedSeq: number;
};

export function restoreAttention(value: string | null, baseline: number): SessionAttention {
  const fallback = { readSeq: baseline, assistantSeq: 0, userSeq: 0, optionsSeq: 0, inspectedSeq: -1 };
  try {
    const saved = JSON.parse(value || 'null');
    if (!saved || !Object.keys(fallback).every((key) => Number.isSafeInteger(saved[key])
      && saved[key] >= (key === 'inspectedSeq' ? -1 : 0))) return fallback;
    return Object.fromEntries(Object.keys(fallback).map((key) => [key, saved[key]])) as SessionAttention;
  } catch { return fallback; }
}

// Older clients could count unplaced child work as a main reply. Preserve read intent and rebuild derived counters once.
export function restoreClassifiedAttention(value: string | null, baseline: number): SessionAttention {
  const state=restoreAttention(value,baseline);
  if(!value)return state;
  try { if(JSON.parse(value)?.classificationVersion===2)return state; } catch { return state; }
  return {...state,assistantSeq:0,userSeq:0,optionsSeq:0,inspectedSeq:-1};
}

export function mergeAttention(a: SessionAttention, b: SessionAttention): SessionAttention {
  return {
    readSeq: Math.max(a.readSeq, b.readSeq), assistantSeq: Math.max(a.assistantSeq, b.assistantSeq),
    userSeq: Math.max(a.userSeq, b.userSeq), optionsSeq: Math.max(a.optionsSeq, b.optionsSeq),
    inspectedSeq: Math.max(a.inspectedSeq, b.inspectedSeq),
  };
}

const noMarks: SubagentMarks = new Map();
// A hidden recap request is not a user turn. It must not answer pending options.
// Subagent work and thinking are not replies. `marks` holds the subagent bounds that the caller knows.
export function attentionMessage(row: MessageRecord, marks = noMarks): 'user' | 'assistant' | null {
  if(unplacedSubagent(row,marks))return null;
  if(row.raw.role==='agent' && row.raw.content?.type==='output' && row.raw.content.data?.isSidechain) return null;
  const message = normalizeMessage(row);
  if (!message || message.recapRequest) return null;
  // A usage limit stops the agent, so it is news for the user like a reply.
  const limit = message.event?.type === 'limit-reached';
  if (!limit && !message.content.trim() && !message.attachments?.length) return null;
  return subagentOf(row, marks) ? null : message.role;
}

// True when the row starts a user turn, with the receipt rules of `visibleMessages`. With `receipts`, a message that
// expects a receipt starts its turn only with its accepted receipt, at the receipt's seq. A rejected message never does.
// `sent` finds the row of a receipt ref, so an accepted hidden recap request does not count. An unknown ref counts.
export function userTurn(row: MessageRecord, receipts = false, sent?: (id: string) => MessageRecord | undefined, marks = noMarks): boolean {
  const receipt = messageReceipt(row.raw);
  if (receipt) {
    const message = receipt.reason === undefined ? sent?.(receipt.ref) : undefined;
    return receipt.reason === undefined && (!message || attentionMessage(message, marks) === 'user');
  }
  return attentionMessage(row, marks) === 'user' && !(receipts && row.raw.meta?.expectsAcceptance === true);
}

export function receiveAttention(state: SessionAttention, row: MessageRecord, marks = noMarks, receipts = false,
  sent?: (id: string) => MessageRecord | undefined): SessionAttention {
  if (userTurn(row, receipts, sent, marks)) return { ...state, userSeq: Math.max(state.userSeq, row.seq) };
  if (attentionMessage(row, marks) !== 'assistant') return state;
  const message = normalizeMessage(row)!;
  const options = partsForMessage(message).some((part) => part.kind === 'options');
  return { ...state, assistantSeq: Math.max(state.assistantSeq, row.seq),
    optionsSeq: options ? Math.max(state.optionsSeq, row.seq) : state.optionsSeq };
}
