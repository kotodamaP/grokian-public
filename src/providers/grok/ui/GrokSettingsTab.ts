import * as fs from 'fs';
import { Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { maybeGetGrokWorkspaceServices } from '../app/GrokWorkspaceServices';
import { GROK_DEFAULT_MODEL_ID } from '../models';
import {
  getGrokProviderSettings,
  updateGrokProviderSettings,
} from '../settings';

export const grokSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const workspace = maybeGetGrokWorkspaceServices();
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const grokSettings = getGrokProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();

    new Setting(container).setName('Setup').setHeading();

    new Setting(container)
      .setName('Enable Grok')
      .setDesc('Launch the local Grok CLI in headless mode for Grokian conversations.')
      .addToggle((toggle) =>
        toggle
          .setValue(grokSettings.enabled)
          .onChange(async (value) => {
            updateGrokProviderSettings(settingsBag, { enabled: value });
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          })
      );

    const cliPathSetting = new Setting(container)
      .setName('Grok CLI path')
      .setDesc('Optional absolute path to the Grok CLI for this computer. Leave empty to use `grok` from PATH.');

    const validationEl = container.createDiv({
      cls: 'claudian-cli-path-validation claudian-setting-validation claudian-setting-validation-error claudian-hidden',
    });

    const validatePath = (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      const expandedPath = expandHomePath(trimmed);
      if (!fs.existsSync(expandedPath)) {
        return 'Path does not exist';
      }

      const stat = fs.statSync(expandedPath);
      if (!stat.isFile()) {
        return 'Path must point to a file';
      }

      return null;
    };

    const updateCliPathValidation = (value: string, inputEl?: HTMLInputElement): boolean => {
      const error = validatePath(value);
      if (error) {
        validationEl.setText(error);
        validationEl.toggleClass('claudian-hidden', false);
        if (inputEl) {
          inputEl.toggleClass('claudian-input-error', true);
        }
        return false;
      }

      validationEl.toggleClass('claudian-hidden', true);
      if (inputEl) {
        inputEl.toggleClass('claudian-input-error', false);
      }
      return true;
    };

    const cliPathsByHost = { ...grokSettings.cliPathsByHost };
    const currentValue = grokSettings.cliPathsByHost[hostnameKey] || '';
    let cliPathInputEl: HTMLInputElement | null = null;

    const persistCliPath = async (value: string): Promise<boolean> => {
      const isValid = updateCliPathValidation(value, cliPathInputEl ?? undefined);
      if (!isValid) {
        return false;
      }

      const trimmed = value.trim();
      if (trimmed) {
        cliPathsByHost[hostnameKey] = trimmed;
      } else {
        delete cliPathsByHost[hostnameKey];
      }

      updateGrokProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      await context.plugin.saveSettings();
      workspace?.cliResolver?.reset();
      await recycleGrokRuntime();
      return true;
    };

    const recycleGrokRuntime = async (): Promise<void> => {
      for (const view of context.plugin.getAllViews()) {
        const tabManager = view.getTabManager();
        if (tabManager?.broadcastToProviderTabs) {
          await tabManager.broadcastToProviderTabs('grok', (service) => Promise.resolve(service.cleanup()));
        } else {
          await tabManager?.broadcastToAllTabs(
            (service) => Promise.resolve(service.cleanup()),
          );
        }
        view.refreshModelSelector?.();
      }
    };

    cliPathSetting.addText((text) => {
        text
          .setPlaceholder(process.platform === 'win32'
          ? 'C:\\path\\to\\grok.exe'
          : '/usr/local/bin/grok')
        .setValue(currentValue)
        .onChange(async (value) => {
          await persistCliPath(value);
        });

      text.inputEl.addClass('claudian-settings-cli-path-input');
      cliPathInputEl = text.inputEl;
      updateCliPathValidation(currentValue, text.inputEl);
    });

    new Setting(container).setName('Models').setHeading();

    new Setting(container)
      .setName('Custom models')
      .setDesc('Append extra Grok CLI model aliases to the picker, one per line. Built-ins include Composer 2.5 and Grok Build; add Grok 4.x aliases here when your CLI account exposes them.')
      .addTextArea((text) => {
        let pendingCustomModels = grokSettings.customModels;
        let savedCustomModels = grokSettings.customModels;

        const commitCustomModels = async (): Promise<void> => {
          if (pendingCustomModels === savedCustomModels) {
            return;
          }

          updateGrokProviderSettings(settingsBag, { customModels: pendingCustomModels });
          savedCustomModels = pendingCustomModels;
          if (settingsBag.settingsProvider === 'grok') {
            const currentModel = typeof settingsBag.model === 'string'
              ? settingsBag.model
              : GROK_DEFAULT_MODEL_ID;
            settingsBag.model = currentModel || GROK_DEFAULT_MODEL_ID;
          }
          await context.plugin.saveSettings();
          context.refreshModelSelectors();
        };

        text
          .setPlaceholder('grok-4.3\ngrok-4.20-non-reasoning')
          .setValue(grokSettings.customModels)
          .onChange((value) => {
            pendingCustomModels = value;
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 40;
        text.inputEl.addEventListener('blur', () => {
          void commitCustomModels();
        });
      });

    new Setting(container).setName('Agents').setHeading();

    new Setting(container)
      .setName('Enable subagents')
      .setDesc('Allow Grok CLI to spawn or use subagents. Turn this off to pass `--no-subagents`.')
      .addToggle((toggle) =>
        toggle
          .setValue(grokSettings.enableSubagents)
          .onChange(async (value) => {
            updateGrokProviderSettings(settingsBag, { enableSubagents: value });
            await context.plugin.saveSettings();
            await recycleGrokRuntime();
          })
      );

    new Setting(container)
      .setName('Agent profile')
      .setDesc('Optional Grok agent name or agent definition path passed with `--agent`.')
      .addText((text) => {
        text
          .setPlaceholder('general-purpose')
          .setValue(grokSettings.agentProfile)
          .onChange(async (value) => {
            updateGrokProviderSettings(settingsBag, { agentProfile: value });
            await context.plugin.saveSettings();
            await recycleGrokRuntime();
          });
      });

    const subagentsValidationEl = container.createDiv({
      cls: 'claudian-setting-validation claudian-setting-validation-error claudian-hidden',
    });

    const updateSubagentsJsonValidation = (value: string, inputEl?: HTMLTextAreaElement): boolean => {
      const trimmed = value.trim();
      if (!trimmed) {
        subagentsValidationEl.toggleClass('claudian-hidden', true);
        inputEl?.toggleClass('claudian-input-error', false);
        return true;
      }

      try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error();
        }
      } catch {
        subagentsValidationEl.setText('Subagents JSON must be a JSON object.');
        subagentsValidationEl.toggleClass('claudian-hidden', false);
        inputEl?.toggleClass('claudian-input-error', true);
        return false;
      }

      subagentsValidationEl.toggleClass('claudian-hidden', true);
      inputEl?.toggleClass('claudian-input-error', false);
      return true;
    };

    new Setting(container)
      .setName('Inline subagents JSON')
      .setDesc('Optional JSON object passed directly to `--agents`. Leave empty to use Grok CLI defaults and discovered agents.')
      .addTextArea((text) => {
        let pendingSubagentsJson = grokSettings.subagentsJson;
        let savedSubagentsJson = grokSettings.subagentsJson;

        const commitSubagentsJson = async (): Promise<void> => {
          if (pendingSubagentsJson === savedSubagentsJson) {
            return;
          }
          if (!updateSubagentsJsonValidation(pendingSubagentsJson, text.inputEl)) {
            return;
          }

          updateGrokProviderSettings(settingsBag, { subagentsJson: pendingSubagentsJson });
          savedSubagentsJson = pendingSubagentsJson;
          await context.plugin.saveSettings();
          await recycleGrokRuntime();
        };

        text
          .setPlaceholder('{"story-planner":{"description":"Plan novel scenes","prompt":"Help plan scenes."}}')
          .setValue(grokSettings.subagentsJson)
          .onChange((value) => {
            pendingSubagentsJson = value;
            updateSubagentsJsonValidation(value, text.inputEl);
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 40;
        updateSubagentsJsonValidation(grokSettings.subagentsJson, text.inputEl);
        text.inputEl.addEventListener('blur', () => {
          void commitSubagentsJson();
        });
      });

    renderEnvironmentSettingsSection({
      container,
      plugin: context.plugin,
      scope: 'provider:grok',
      heading: 'Environment',
      name: 'Grok environment',
      desc: 'Grok-owned runtime variables only. Use this for XAI_* and GROK_* settings. Prefer local Grok login when possible.',
      placeholder: 'GROK_MODEL=grok-composer-2.5-fast',
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'grok'),
    });
  },
};
