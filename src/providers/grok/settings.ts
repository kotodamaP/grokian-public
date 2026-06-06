import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../core/types/settings';
import {
  getHostnameKey,
  getLegacyHostnameKey,
  migrateLegacyHostnameKeyedMap,
} from '../../utils/env';
import { GROK_DEFAULT_MODEL_ID } from './models';

export interface GrokProviderSettings {
  agentProfile: string;
  enabled: boolean;
  enableSubagents: boolean;
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  customModels: string;
  model: string;
  subagentsJson: string;
  environmentVariables: string;
  environmentHash: string;
}

export const DEFAULT_GROK_PROVIDER_SETTINGS: Readonly<GrokProviderSettings> = Object.freeze({
  agentProfile: '',
  enabled: true,
  enableSubagents: true,
  cliPath: '',
  cliPathsByHost: {},
  customModels: '',
  model: GROK_DEFAULT_MODEL_ID,
  subagentsJson: '',
  environmentVariables: '',
  environmentHash: '',
});

function normalizeHostnameCliPaths(value: unknown): HostnameCliPaths {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: HostnameCliPaths = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.trim()) {
      result[key] = entry.trim();
    }
  }
  return result;
}

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function getGrokProviderSettings(settings: Record<string, unknown>): GrokProviderSettings {
  const config = getProviderConfig(settings, 'grok');
  const normalizedCliPathsByHost = normalizeHostnameCliPaths(config.cliPathsByHost);
  const cliPathsByHost = Object.keys(normalizedCliPathsByHost).length > 0
    ? migrateLegacyHostnameKeyedMap(
      normalizedCliPathsByHost,
      getHostnameKey(),
      getLegacyHostnameKey(),
    )
    : normalizedCliPathsByHost;
  const model = normalizeString(config.model, DEFAULT_GROK_PROVIDER_SETTINGS.model).trim()
    || DEFAULT_GROK_PROVIDER_SETTINGS.model;

  return {
    agentProfile: normalizeString(config.agentProfile, DEFAULT_GROK_PROVIDER_SETTINGS.agentProfile),
    enabled: (config.enabled as boolean | undefined)
      ?? DEFAULT_GROK_PROVIDER_SETTINGS.enabled,
    enableSubagents: (config.enableSubagents as boolean | undefined)
      ?? DEFAULT_GROK_PROVIDER_SETTINGS.enableSubagents,
    cliPath: normalizeString(config.cliPath, DEFAULT_GROK_PROVIDER_SETTINGS.cliPath),
    cliPathsByHost,
    customModels: normalizeString(config.customModels, DEFAULT_GROK_PROVIDER_SETTINGS.customModels),
    model,
    subagentsJson: normalizeString(config.subagentsJson, DEFAULT_GROK_PROVIDER_SETTINGS.subagentsJson),
    environmentVariables: normalizeString(
      config.environmentVariables,
      getProviderEnvironmentVariables(settings, 'grok')
        || DEFAULT_GROK_PROVIDER_SETTINGS.environmentVariables,
    ),
    environmentHash: normalizeString(config.environmentHash, DEFAULT_GROK_PROVIDER_SETTINGS.environmentHash),
  };
}

export function updateGrokProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<GrokProviderSettings>,
): GrokProviderSettings {
  const current = getGrokProviderSettings(settings);
  const next: GrokProviderSettings = {
    ...current,
    ...updates,
    agentProfile: 'agentProfile' in updates
      ? normalizeString(updates.agentProfile).trim()
      : current.agentProfile,
    cliPath: 'cliPath' in updates
      ? normalizeString(updates.cliPath).trim()
      : current.cliPath,
    cliPathsByHost: 'cliPathsByHost' in updates
      ? normalizeHostnameCliPaths(updates.cliPathsByHost)
      : { ...current.cliPathsByHost },
    customModels: 'customModels' in updates
      ? normalizeString(updates.customModels)
      : current.customModels,
    model: normalizeString(updates.model, current.model).trim() || GROK_DEFAULT_MODEL_ID,
    subagentsJson: 'subagentsJson' in updates
      ? normalizeString(updates.subagentsJson).trim()
      : current.subagentsJson,
  };

  setProviderConfig(settings, 'grok', {
    agentProfile: next.agentProfile,
    enabled: next.enabled,
    enableSubagents: next.enableSubagents,
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    customModels: next.customModels,
    model: next.model,
    subagentsJson: next.subagentsJson,
    environmentVariables: next.environmentVariables,
    environmentHash: next.environmentHash,
  });
  return next;
}
