import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderTabWarmupPolicy,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { HomeFileAdapter } from '../../../core/storage/HomeFileAdapter';
import { GrokStoryCommandCatalog } from '../commands/GrokStoryCommandCatalog';
import { GrokCliResolver } from '../runtime/GrokCliResolver';
import { grokSettingsTabRenderer } from '../ui/GrokSettingsTab';

export type GrokWorkspaceServices = ProviderWorkspaceServices;

const grokTabWarmupPolicy: ProviderTabWarmupPolicy = {
  resolveMode() {
    return 'none';
  },
};

export async function createGrokWorkspaceServices(): Promise<GrokWorkspaceServices> {
  return {
    cliResolver: new GrokCliResolver(),
    commandCatalog: new GrokStoryCommandCatalog(),
    settingsTabRenderer: grokSettingsTabRenderer,
    tabWarmupPolicy: grokTabWarmupPolicy,
  };
}

export const grokWorkspaceRegistration: ProviderWorkspaceRegistration<GrokWorkspaceServices> = {
  initialize: async (context) => ({
    cliResolver: new GrokCliResolver(),
    commandCatalog: new GrokStoryCommandCatalog(context.vaultAdapter, new HomeFileAdapter()),
    settingsTabRenderer: grokSettingsTabRenderer,
    tabWarmupPolicy: grokTabWarmupPolicy,
  }),
};

export function maybeGetGrokWorkspaceServices(): GrokWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('grok') as GrokWorkspaceServices | null;
}
