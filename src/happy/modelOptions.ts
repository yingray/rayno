import { currentModel, isRig, record, type Json } from './normalize';

export type ModelOption = {
  value: string;
  label: string;
  provider?: string;
  thinkingLevels?: string[];
  defaultThinkingLevel?: string;
  disabled?: boolean;
};

// Adapted from the inspected v1 catalog. Daemon catalogs take precedence.
const CLAUDE_MODELS = [
  ['claude-fable-5-1', 'Fable 5.1'], ['claude-fable-5', 'Fable 5'],
  ['claude-opus-5-5', 'Opus 5.5'], ['claude-opus-5', 'Opus 5'],
  ['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-haiku-5-5', 'Haiku 5.5'],
];
const CODEX_MODELS = [
  ['gpt-6-astra', 'GPT-6 Astra'], ['gpt-6.1-sol', 'GPT-6.1 Sol'],
  ['gpt-6-sol', 'GPT-6 Sol'], ['gpt-6-luna', 'GPT-6 Luna'],
  ['gpt-5.6-sol', 'GPT-5.6 Sol'], ['gpt-5.6-terra', 'GPT-5.6 Terra'],
  ['gpt-5.6-luna', 'GPT-5.6 Luna'],
];
const strings = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string => typeof item === 'string' && !!item))]
  : [];
const name = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value ? value : fallback;
export const effortLabel = (value: string | null) => value === null
  ? 'Not supported'
  : value === 'xhigh' ? 'xHigh' : value.charAt(0).toUpperCase() + value.slice(1);

export const isConcreteModel = (value: unknown): value is string => typeof value === 'string' &&
  !!value.trim() && !['default', 'Agent default'].includes(value) && !value.endsWith(':default');

export function modelOptions(metadata: Json, configured = currentModel(metadata)): ModelOption[] {
  const rig = isRig(metadata);
  let options: ModelOption[] = (Array.isArray(metadata.models) ? metadata.models : [])
    .flatMap((raw: unknown) => {
      const model = record(raw);
      const id = name(model.id, name(model.code, ''));
      const provider = name(model.provider?.id, name(model.providerId, ''));
      if (!isConcreteModel(id) || (rig && !provider)) return [];
      return [{
        value: rig ? `${provider}:${id}` : id,
        label: name(model.name, name(model.value, id)),
        provider: rig ? name(model.provider?.name, name(model.providerName, provider)) : undefined,
        thinkingLevels: Array.isArray(model.thinkingLevels) ? strings(model.thinkingLevels) : undefined,
        defaultThinkingLevel: name(model.defaultThinkingLevel, '') || undefined,
      }];
    });
  if (!options.length && !rig) {
    const catalog = metadata.flavor === 'codex' ? CODEX_MODELS
      : !metadata.flavor || metadata.flavor === 'claude' ? CLAUDE_MODELS : [];
    options = catalog.map(([value, label]) => ({ value, label }));
  }
  if (isConcreteModel(configured) && !options.some((option) => option.value === configured))
    options.push({ value: configured, label: configured, disabled: rig });
  return options.filter((option, index) => options.findIndex((other) => other.value === option.value) === index);
}

export function canSelectModel(metadata: Json): boolean {
  return metadata.session?.modelLocked !== true && metadata.capabilities?.modelSelection !== false;
}

export function effortOptions(metadata: Json, model: string): string[] {
  if (metadata.capabilities?.reasoningSelection === false) return [];
  const selected = modelOptions(metadata, model).find((option) => option.value === model);
  if (selected?.thinkingLevels !== undefined) return selected.thinkingLevels;
  if (isRig(metadata)) {
    const levels = strings(metadata.reasoning?.levels);
    return levels.length ? levels : strings(metadata.thoughtLevels?.map((level: Json) => level.code));
  }
  if (!metadata.flavor || metadata.flavor === 'claude') return ['low', 'medium', 'high', 'xhigh', 'max'];
  if (metadata.flavor === 'codex') {
    const levels = ['low', 'medium', 'high', 'xhigh'];
    if (CODEX_MODELS.some(([id]) => id === model)) {
      levels.push('max');
      if (!model.endsWith('luna')) levels.push('ultra');
    }
    return levels;
  }
  return [];
}

export function defaultEffort(metadata: Json, model: string): string | null {
  const selected = modelOptions(metadata, model).find((option) => option.value === model);
  const levels = effortOptions(metadata, model);
  return selected?.defaultThinkingLevel && levels.includes(selected.defaultThinkingLevel)
    ? selected.defaultThinkingLevel : levels.includes('high') ? 'high' : levels[0] || null;
}
