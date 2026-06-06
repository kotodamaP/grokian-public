import type { ProviderUIOption } from '../../core/providers/types';

export const GROK_DEFAULT_MODEL_ID = 'grok';
export const GROK_DEFAULT_MODEL_LABEL = 'Grok CLI default';

export const GROK_DEFAULT_MODELS: ProviderUIOption[] = [
  {
    value: GROK_DEFAULT_MODEL_ID,
    label: GROK_DEFAULT_MODEL_LABEL,
    description: 'Use the model configured in the local Grok CLI',
  },
  {
    value: 'grok-composer-2.5-fast',
    label: 'Composer 2.5',
    description: 'Grok CLI default writing/coding model when available',
  },
  {
    value: 'grok-build',
    label: 'Grok Build',
    description: 'Grok CLI coding/build model when available',
  },
];

export function parseGrokCustomModels(input: unknown): string[] {
  if (typeof input !== 'string') {
    return [];
  }

  const seen = new Set<string>();
  const models: string[] = [];
  for (const line of input.split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('#') || seen.has(value)) {
      continue;
    }

    seen.add(value);
    models.push(value);
  }
  return models;
}

export function isGrokModelId(model: string, customModels: string[] = []): boolean {
  return model === GROK_DEFAULT_MODEL_ID
    || model.toLowerCase().startsWith('grok-')
    || model.toLowerCase().startsWith('grok:')
    || customModels.includes(model);
}

export function resolveGrokCliModel(model: string | undefined): string | null {
  const trimmed = model?.trim();
  if (!trimmed || trimmed === GROK_DEFAULT_MODEL_ID) {
    return null;
  }

  return trimmed;
}
