import type { Json } from './normalize';
export function resumeUnavailable(metadata: Json, machine: Json, online: boolean): string {
  if (metadata.flavor === 'rig' || metadata.client?.id === 'rig' || metadata.capabilities?.resume === false || metadata.bot)
    return 'This agent does not support session recovery.';
  if (!metadata.machineId) return 'The original computer is not recorded for this session.';
  if (!metadata.claudeSessionId && !metadata.codexThreadId) return 'This session has no Claude or Codex recovery ID.';
  if (!online) return 'Bring the original computer online to resume this session.';
  if (machine.resumeSupport?.rpcAvailable !== true) return 'Update Happy CLI on the original computer to enable session recovery.';
  return '';
}
