import type {
  ProviderChatUIConfig,
  ProviderModeSelectorConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { GROK_PROVIDER_ICON } from '../../../shared/icons';
import {
  GROK_DEFAULT_MODEL_ID,
  GROK_DEFAULT_MODELS,
  isGrokModelId,
  parseGrokCustomModels,
} from '../models';
import {
  getGrokProviderSettings,
  updateGrokProviderSettings,
} from '../settings';

const GROK_CONTEXT_WINDOW = 1_000_000;
const GROK_REASONING_OPTIONS: ProviderReasoningOption[] = [
  { label: 'Off', value: 'off' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'XHigh', value: 'xhigh' },
  { label: 'Max', value: 'max' },
];
const GROK_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Default',
  activeValue: 'yolo',
  activeLabel: 'Auto',
  planValue: 'plan',
  planLabel: 'Plan',
};
const GROK_MODE_SELECTOR_OPTIONS: ProviderUIOption[] = [
  {
    value: 'normal',
    label: 'Chat/Plan',
    description: 'Run Grok in normal chat mode.',
  },
  {
    value: 'plan',
    label: 'Plan',
    description: 'Ask Grok to plan first with --permission-mode plan.',
  },
];

export const grokChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings): ProviderUIOption[] {
    const grokSettings = getGrokProviderSettings(settings);
    const customModels = parseGrokCustomModels(grokSettings.customModels);
    const options: ProviderUIOption[] = [...GROK_DEFAULT_MODELS];
    const seen = new Set(options.map(option => option.value));

    for (const model of customModels) {
      if (seen.has(model)) {
        continue;
      }
      seen.add(model);
      options.push({
        value: model,
        label: model,
        description: 'Grok CLI model alias',
      });
    }

    const selectedModels = [
      typeof settings.model === 'string' ? settings.model : '',
      typeof grokSettings.model === 'string' ? grokSettings.model : '',
      getSavedProviderModel(settings),
    ];

    for (const model of selectedModels) {
      if (!model || seen.has(model) || !isGrokModelId(model, customModels)) {
        continue;
      }
      seen.add(model);
      options.push({
        value: model,
        label: model,
        description: 'Selected in an existing session',
      });
    }

    return options;
  },

  ownsModel(model: string, settings: Record<string, unknown>): boolean {
    const customModels = parseGrokCustomModels(getGrokProviderSettings(settings).customModels);
    return isGrokModelId(model, customModels);
  },

  isAdaptiveReasoningModel(): boolean {
    return true;
  },

  getReasoningOptions(): ProviderReasoningOption[] {
    return GROK_REASONING_OPTIONS;
  },

  getDefaultReasoningValue(): string {
    return 'off';
  },

  getContextWindowSize(
    model: string,
    customLimits?: Record<string, number>,
  ): number {
    return customLimits?.[model] ?? GROK_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return model === GROK_DEFAULT_MODEL_ID;
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    settingsBag.model = model || GROK_DEFAULT_MODEL_ID;
    settingsBag.effortLevel = 'off';
    settingsBag.thinkingBudget = 'off';
    updateGrokProviderSettings(settingsBag, { model: settingsBag.model as string });
  },

  applyReasoningSelection(_model: string, value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const normalized = normalizeGrokEffort(value);
    (settings as Record<string, unknown>).effortLevel = normalized ?? 'off';
    (settings as Record<string, unknown>).thinkingBudget = 'off';
  },

  normalizeModelVariant(model: string): string {
    return model || GROK_DEFAULT_MODEL_ID;
  },

  getCustomModelIds(envVars: Record<string, string>): Set<string> {
    const model = envVars.GROK_MODEL ?? envVars.XAI_MODEL;
    return model ? new Set([model]) : new Set<string>();
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return GROK_PERMISSION_MODE_TOGGLE;
  },

  resolvePermissionMode(settings: Record<string, unknown>): string | null {
    return typeof settings.permissionMode === 'string'
      ? settings.permissionMode
      : 'normal';
  },

  applyPermissionMode(value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }
    (settings as Record<string, unknown>).permissionMode = value;
  },

  getModeSelector(settings: Record<string, unknown>): ProviderModeSelectorConfig {
    const permissionMode = typeof settings.permissionMode === 'string'
      ? settings.permissionMode
      : 'normal';
    return {
      activeValue: 'plan',
      label: 'Plan',
      options: GROK_MODE_SELECTOR_OPTIONS,
      value: permissionMode === 'plan' ? 'plan' : 'normal',
    };
  },

  applyModeSelection(value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    settingsBag.permissionMode = value === 'plan' ? 'plan' : 'normal';
  },

  getProviderIcon() {
    return GROK_PROVIDER_ICON;
  },
};

function normalizeGrokEffort(value: unknown): string | null {
  return typeof value === 'string'
    && ['off', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value)
    ? value
    : null;
}

function getSavedProviderModel(settings: Record<string, unknown>): string {
  const savedProviderModel = settings.savedProviderModel;
  if (!savedProviderModel || typeof savedProviderModel !== 'object' || Array.isArray(savedProviderModel)) {
    return '';
  }

  const value = (savedProviderModel as Record<string, unknown>).grok;
  return typeof value === 'string' ? value : '';
}
