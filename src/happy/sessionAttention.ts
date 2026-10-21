import { partsForMessage } from '../data/messageOptions';
import { normalizeMessage, type MessageRecord } from './normalize';

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

export function mergeAttention(a: SessionAttention, b: SessionAttention): SessionAttention {
  return {
    readSeq: Math.max(a.readSeq, b.readSeq), assistantSeq: Math.max(a.assistantSeq, b.assistantSeq),
    userSeq: Math.max(a.userSeq, b.userSeq), optionsSeq: Math.max(a.optionsSeq, b.optionsSeq),
    inspectedSeq: Math.max(a.inspectedSeq, b.inspectedSeq),
  };
}

export function attentionMessage(row: MessageRecord): 'user' | 'assistant' | null {
  const message = normalizeMessage(row);
  if (!message || (!message.content.trim() && !message.attachments?.length)) return null;
  return message.role;
}

export function receiveAttention(state: SessionAttention, row: MessageRecord): SessionAttention {
  const kind = attentionMessage(row);
  if (kind === 'user') return { ...state, userSeq: Math.max(state.userSeq, row.seq) };
  if (kind !== 'assistant') return state;
  const message = normalizeMessage(row)!;
  const options = partsForMessage(message).some((part) => part.kind === 'options');
  return { ...state, assistantSeq: Math.max(state.assistantSeq, row.seq),
    optionsSeq: options ? Math.max(state.optionsSeq, row.seq) : state.optionsSeq };
}
