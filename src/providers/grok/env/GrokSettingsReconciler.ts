import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { GROK_DEFAULT_MODEL_ID, isGrokModelId, parseGrokCustomModels } from '../models';
import {
  getGrokProviderSettings,
  updateGrokProviderSettings,
} from '../settings';

export const grokSettingsReconciler: ProviderSettingsReconciler = {
  handleEnvironmentChange(): boolean {
    return false;
  },

  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    _conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const grokSettings = getGrokProviderSettings(settings);
    const customModels = parseGrokCustomModels(grokSettings.customModels);
    const model = typeof settings.model === 'string'
      ? settings.model
      : grokSettings.model;

    if (!model || isGrokModelId(model, customModels)) {
      return { changed: false, invalidatedConversations: [] };
    }

    settings.model = GROK_DEFAULT_MODEL_ID;
    updateGrokProviderSettings(settings, { model: GROK_DEFAULT_MODEL_ID });
    return { changed: true, invalidatedConversations: [] };
  },

  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    const grokSettings = getGrokProviderSettings(settings);
    const normalized = grokSettings.model.trim() || GROK_DEFAULT_MODEL_ID;
    if (normalized === grokSettings.model) {
      return false;
    }

    updateGrokProviderSettings(settings, { model: normalized });
    if (settings.settingsProvider === 'grok') {
      settings.model = normalized;
    }
    return true;
  },
};
