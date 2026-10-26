import type { ToolActivityBlock } from './chatBlocks';
import type { ToolCall } from './types';

export const callEnded = (call?: ToolCall) => !!call && (call.ended === true || call.result !== undefined);
function stepLabel(label: string, call?: ToolCall) {
  if (!call?.input || typeof call.input !== 'object' || call.name !== (call.tool ?? call.name)) return label;
  const input = call.input as Record<string, unknown>;
  const detail = input.file_path ?? input.filePath ?? input.path ?? input.pattern ?? input.command;
  return typeof detail === 'string' && detail.trim() ? `${label} ${detail.trim().split('\n')[0]}` : label;
}
export function activitySteps(block: ToolActivityBlock) {
  return block.tools.flatMap((label, index) => block.thinking?.[index] !== undefined ? []
    : [{ label: stepLabel(label, block.details?.[index]), index, call: block.details?.[index] }]);
}
export function activityTiming(block: ToolActivityBlock) {
  const steps = activitySteps(block);
  const starts = steps.flatMap(step => step.call?.startedAt !== undefined ? [step.call.startedAt] : []);
  const start = starts.length ? Math.min(...starts) : block.startedAt;
  const ends = steps.flatMap(step => step.call?.endedAt !== undefined ? [step.call.endedAt] : []);
  const end = steps.length > 0 && steps.every(step => callEnded(step.call)) && ends.length === steps.length
    ? Math.max(...ends) : undefined;
  return { start, end };
}
export function elapsedClock(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function elapsedDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
