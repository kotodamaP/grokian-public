import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as path from 'node:path';

import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type { ChatMessage, ImageAttachment } from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import {
  resolveWindowsCmdShimSpawnSpec,
  terminateSpawnedProcess,
  type WindowsCmdShimSpawnSpec,
} from '../../../utils/windowsCmdShim';
import { GROK_DEFAULT_MODEL_ID, resolveGrokCliModel } from '../models';
import { getGrokProviderSettings, type GrokProviderSettings } from '../settings';

const STDERR_BUFFER_LIMIT = 8_000;

export interface GrokHeadlessQueryOptions {
  abortSignal?: AbortSignal;
  conversationHistory?: ChatMessage[];
  images?: ImageAttachment[];
  model?: string;
  onTextDelta?: (deltaText: string, accumulatedText: string) => void;
  plugin: ClaudianPlugin;
  prompt: string;
  systemPrompt?: string;
}

interface ActiveProcess {
  proc: ChildProcessWithoutNullStreams;
  spawnSpec: WindowsCmdShimSpawnSpec;
}

export interface GrokHeadlessArgsOptions {
  cwd: string;
  effortLevel?: string;
  model: string | null;
  permissionMode?: string;
  prompt: string;
  promptJson?: string;
  settings: GrokProviderSettings;
}

export async function runGrokHeadlessQuery(options: GrokHeadlessQueryOptions): Promise<string> {
  const command = resolveGrokCommand(options.plugin);
  const cwd = resolveWorkingDirectory(options.plugin);
  const providerSettings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
    options.plugin.settings as unknown as Record<string, unknown>,
    'grok',
  );
  const grokSettings = getGrokProviderSettings(providerSettings);
  const prompt = buildHeadlessPrompt({
    conversationHistory: options.conversationHistory,
    prompt: options.prompt,
    systemPrompt: options.systemPrompt,
  });
  const promptJson = buildGrokPromptJson(prompt, options.images);
  const cliModel = resolveGrokCliModel(
    options.model ?? resolveProviderModel(providerSettings),
  );
  const args = buildGrokHeadlessArgs({
    cwd,
    effortLevel: typeof providerSettings.effortLevel === 'string'
      ? providerSettings.effortLevel
      : undefined,
    model: cliModel,
    permissionMode: typeof providerSettings.permissionMode === 'string'
      ? providerSettings.permissionMode
      : undefined,
    prompt,
    promptJson,
    settings: grokSettings,
  });
  const envText = getRuntimeEnvironmentText(
    options.plugin.settings as unknown as Record<string, unknown>,
    'grok',
  );
  const customEnv = parseEnvironmentVariables(envText);
  const env = {
    ...process.env,
    ...customEnv,
  };
  const resolvedSpawnSpec = resolveWindowsCmdShimSpawnSpec({ command, args });

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let stdoutText = '';
    let stderrText = '';
    let activeProcess: ActiveProcess | null = null;

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      options.abortSignal?.removeEventListener('abort', abortHandler);
      callback();
    };

    const abortHandler = (): void => {
      if (!activeProcess) {
        settle(() => reject(new Error('Cancelled')));
        return;
      }

      terminateSpawnedProcess(activeProcess.proc, 'SIGTERM', spawn, activeProcess.spawnSpec);
      settle(() => reject(new Error('Cancelled')));
    };

    if (options.abortSignal?.aborted) {
      reject(new Error('Cancelled'));
      return;
    }

    options.abortSignal?.addEventListener('abort', abortHandler, { once: true });

    const proc = spawn(resolvedSpawnSpec.command, resolvedSpawnSpec.args, {
      cwd,
      env: {
        ...env,
        PATH: getEnhancedPath(
          env.PATH,
          path.isAbsolute(command) ? command : undefined,
        ),
      },
      stdio: 'pipe',
      windowsHide: true,
      ...(resolvedSpawnSpec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });
    activeProcess = { proc, spawnSpec: resolvedSpawnSpec };

    proc.stdout.on('data', (chunk: Buffer | string) => {
      const delta = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      stdoutText += delta;
      options.onTextDelta?.(delta, stdoutText);
    });

    proc.stderr.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      stderrText = `${stderrText}${text}`.slice(-STDERR_BUFFER_LIMIT);
    });

    proc.on('error', (error) => {
      settle(() => reject(error));
    });

    proc.on('exit', (code, signal) => {
      if (code === 0 && signal === null) {
        // Grok CLI may write optional MCP/auth diagnostics to stderr while still
        // returning a valid answer on stdout. A clean exit keeps those nonfatal.
        settle(() => resolve(stdoutText));
        return;
      }

      const stderr = stderrText.trim();
      const exitSummary = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
      settle(() => reject(new Error(stderr || `Grok CLI exited with ${exitSummary}.`)));
    });
  });
}

function resolveGrokCommand(plugin: ClaudianPlugin): string {
  return plugin.getResolvedProviderCliPath('grok') ?? 'grok';
}

export function buildGrokHeadlessArgs(options: GrokHeadlessArgsOptions): string[] {
  const args = [
    '--no-auto-update',
    '--no-alt-screen',
    '--cwd',
    options.cwd,
    '--output-format',
    'plain',
  ];

  const permissionMode = resolveGrokCliPermissionMode(options.permissionMode);
  if (permissionMode) {
    args.push('--permission-mode', permissionMode);
  }
  if (permissionMode !== 'plan') {
    args.push('--no-plan');
  }

  const effort = resolveGrokCliEffort(options.effortLevel);
  if (effort) {
    args.push('--effort', effort);
  }

  if (!options.settings.enableSubagents) {
    args.push('--no-subagents');
  }

  const agentProfile = options.settings.agentProfile.trim();
  if (agentProfile) {
    args.push('--agent', agentProfile);
  }

  const subagentsJson = options.settings.subagentsJson.trim();
  if (subagentsJson) {
    validateSubagentsJson(subagentsJson);
    args.push('--agents', subagentsJson);
  }

  if (options.model) {
    args.push('-m', options.model);
  }

  if (options.promptJson) {
    args.push('--prompt-json', options.promptJson);
  } else {
    args.push('-p', options.prompt);
  }
  return args;
}

export function buildGrokPromptJson(
  prompt: string,
  images?: ImageAttachment[],
): string | undefined {
  const imageBlocks = (images ?? []).flatMap((image) => {
    if (!image.data || !image.mediaType.startsWith('image/')) {
      return [];
    }
    return [{
      data: image.data,
      mimeType: image.mediaType,
      type: 'image' as const,
    }];
  });

  if (imageBlocks.length === 0) {
    return undefined;
  }

  return JSON.stringify([
    { type: 'text', text: prompt },
    ...imageBlocks,
  ]);
}

function resolveProviderModel(providerSettings: Record<string, unknown>): string {
  return typeof providerSettings.model === 'string'
    ? providerSettings.model
    : GROK_DEFAULT_MODEL_ID;
}

function resolveGrokCliPermissionMode(permissionMode: string | undefined): string | null {
  switch (permissionMode) {
    case 'plan':
      return 'plan';
    case 'yolo':
      return 'bypassPermissions';
    case 'normal':
      return 'default';
    default:
      return null;
  }
}

function resolveGrokCliEffort(effortLevel: string | undefined): string | null {
  switch (effortLevel) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return effortLevel;
    default:
      return null;
  }
}

function validateSubagentsJson(value: string): void {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error();
    }
  } catch {
    throw new Error('Grok subagents JSON must be a JSON object.');
  }
}

function resolveWorkingDirectory(plugin: ClaudianPlugin): string {
  try {
    return getVaultPath(plugin.app) ?? process.cwd();
  } catch {
    return process.cwd();
  }
}

function buildHeadlessPrompt(params: {
  conversationHistory?: ChatMessage[];
  prompt: string;
  systemPrompt?: string;
}): string {
  const sections: string[] = [];
  const systemPrompt = params.systemPrompt?.trim();
  if (systemPrompt) {
    sections.push(`<system>\n${systemPrompt}\n</system>`);
  }

  const history = buildHistoryContext(params.conversationHistory ?? []);
  if (history) {
    sections.push(`<conversation_so_far>\n${history}\n</conversation_so_far>`);
  }

  sections.push(params.prompt);
  return sections.join('\n\n');
}

function buildHistoryContext(messages: ChatMessage[]): string {
  const visibleMessages = messages
    .filter(message => !message.isRebuiltContext && message.content.trim())
    .slice(-12);
  if (visibleMessages.length === 0) {
    return '';
  }

  return visibleMessages
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content.trim()}`)
    .join('\n\n');
}
