import { formatToolValue, type ChatBlock } from './chatBlocks';
import { recapSourceText } from './recapView';
import { findRecapQuote, RECAP_BLOCK_BREAK } from './recapQuote';
import { toolSections, toolSectionsText } from './toolResults';

export type TranscriptAnchor = { id?: string; inset: number; pinned: boolean; full: boolean };
export type TranscriptMemory = {
  loaded?: boolean;
  anchor?: TranscriptAnchor;
  layout: string;
  heights: Map<string, number>;
  groups: Map<string, boolean>;
  details: Map<string, boolean>;
};
export const createTranscriptMemory = (): TranscriptMemory => ({ layout: '', heights: new Map(), groups: new Map(), details: new Map() });
export function parseTranscriptAnchor(raw: string | null): TranscriptAnchor | undefined {
  try {
    const value = JSON.parse(raw || 'null');
    if (value && typeof value.pinned === 'boolean' && typeof value.full === 'boolean'
      && typeof value.inset === 'number' && Number.isFinite(value.inset)
      && (value.id === undefined || typeof value.id === 'string')) return value;
  } catch { /* A missing or invalid view starts at the latest message. */ }
}

const textCache = new WeakMap<ChatBlock, string>();
export function transcriptText(block: ChatBlock): string {
  let text = textCache.get(block);
  if (text !== undefined) return text;
  text = block.kind === 'message' ? (block.message.role === 'user' ? block.message.content : recapSourceText(block.message))
    + '\n' + (block.message.attachments?.map(file => file.name).join('\n') || '')
    : block.kind === 'tools' ? block.tools.map((name, index) => {
      const call = block.details?.[index];
      return [name, block.thinking?.[index] || '', ...(call ? [formatToolValue(call.input),
        ...toolSectionsText(toolSections(call)), ...(call.children?.map(child => child.content) || [])] : [])].join('\n');
    }).join(RECAP_BLOCK_BREAK) : block.text;
  textCache.set(block, text);
  return text;
}

// A recap searches its reply and the tool groups since the previous user turn.
export function recapTurnGroups(blocks: readonly ChatBlock[], messageId: string): string[] {
  const end = blocks.findIndex(block => block.kind === 'message' && block.message.id === messageId);
  const groups: string[] = [];
  for (let index = end - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.kind === 'message' && block.message.role === 'user') break;
    if (block.kind === 'tools') groups.push(block.id);
  }
  return groups;
}

export function recapTargetBlock(blocks: readonly ChatBlock[], messageId: string, quote: string): string | undefined {
  const reply = blocks.find(block => block.kind === 'message' && block.message.id === messageId);
  if (reply && findRecapQuote(quote, [transcriptText(reply)])) return reply.id;
  const groups = new Set(recapTurnGroups(blocks, messageId));
  return blocks.find(block => groups.has(block.id) && findRecapQuote(quote, [transcriptText(block)]))?.id;
}

export function searchTranscript(blocks: readonly ChatBlock[], query: string, limit = 50) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const results: { id: string; text: string; tools: boolean }[] = [];
  for (const block of blocks) {
    const text = transcriptText(block).split(RECAP_BLOCK_BREAK).join('\n');
    const index = text.toLocaleLowerCase().indexOf(needle);
    if (index < 0) continue;
    results.push({ id: block.id, text: text.slice(Math.max(0, index - 35), index + needle.length + 100), tools: block.kind === 'tools' });
    if (results.length === limit) break;
  }
  return results;
}
