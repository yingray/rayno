import { currentPermission, isRig, record, type Json } from './normalize';
import { compareVersionsWithPrerelease, isWellFormedVersion } from './versionUtils';

export type PermissionOption = { value: string; label: string; description?: string; disabled?: boolean };

// Adapted from the inspected v1 catalogs. Published catalogs own their labels.
const LABELS: Record<string, string> = {
  auto: 'Auto', default: 'Default', acceptEdits: 'Edits', plan: 'Plan',
  bypassPermissions: 'Yolo', 'safe-yolo': 'Workspace', 'read-only': 'Read', yolo: 'Yolo',
};
const label = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value : fallback;

function publishedModes(metadata: Json): PermissionOption[] {
  return (Array.isArray(metadata.operatingModes) ? metadata.operatingModes : []).flatMap((raw: unknown) => {
    const mode = record(raw);
    if (typeof mode.code !== 'string' || !mode.code.trim()) return [];
    return [{ value: mode.code, label: label(mode.value, mode.code),
      description: label(mode.description, '') || undefined }];
  });
}

export function permissionLabel(metadata: Json, value: string | undefined): string {
  if (!value) return 'Not reported';
  return publishedModes(metadata).find((option) => option.value === value)?.label
    || (isRig(metadata) ? value : LABELS[value] || value);
}

export function canSelectPermission(metadata: Json): boolean {
  return metadata.capabilities?.permissionModeSelection !== false;
}

export function resolveNewSessionPermission(metadata: Json, candidates: (string | null | undefined)[]): string {
  const options = permissionOptions(metadata);
  const fallback = metadata.flavor === 'codex' ? 'yolo' : 'bypassPermissions';
  return [...candidates, fallback].find((value) => options.some((option) => option.value === value && !option.disabled))
    || options.find((option) => !option.disabled)?.value || 'default';
}

export function permissionOptions(metadata: Json, configured = currentPermission(metadata)): PermissionOption[] {
  let options = publishedModes(metadata);
  if (!options.length && !isRig(metadata)) {
    const codes = metadata.flavor === 'codex'
      ? ['auto', 'safe-yolo', 'read-only', 'yolo', 'default']
      : !metadata.flavor || metadata.flavor === 'claude'
        ? ['auto', 'acceptEdits', 'plan', 'bypassPermissions', 'default'] : ['default'];
    const autoSupported = !metadata.version || (isWellFormedVersion(metadata.version)
      && compareVersionsWithPrerelease(metadata.version, '1.2.1-beta.2') >= 0);
    options = codes.filter((value) => value !== 'auto' || autoSupported)
      .map((value) => ({ value, label: permissionLabel(metadata, value) }));
  }
  if (configured && !options.some((option) => option.value === configured))
    options.push({ value: configured, label: permissionLabel(metadata, configured), disabled: true,
      description: 'This mode is not in the current catalog.' });
  return options.filter((option, index) => options.findIndex((other) => other.value === option.value) === index);
}
