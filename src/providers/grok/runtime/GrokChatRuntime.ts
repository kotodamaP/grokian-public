import * as path from 'node:path';

import {
  buildSystemPrompt,
  type SystemPromptSettings,
} from '../../../core/prompt/mainAgent';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderCapabilities } from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type {
  ApprovalCallback,
  AskUserQuestionCallback,
  AutoTurnCallback,
  ChatRewindMode,
  ChatRewindResult,
  ChatRuntimeConversationState,
  ChatRuntimeEnsureReadyOptions,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  ExitPlanModeCallback,
  PreparedChatTurn,
  SessionUpdateResult,
  SubagentRuntimeState,
} from '../../../core/runtime/types';
import type {
  ChatMessage,
  Conversation,
  SlashCommand,
  StreamChunk,
  ToolCallInfo,
} from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import {
  type AcpAuthMethod,
  AcpClientConnection,
  AcpJsonRpcTransport,
  type AcpSessionNotification,
  AcpSessionUpdateNormalizer,
  AcpSubprocess,
} from '../../acp';
import { GROK_PROVIDER_CAPABILITIES } from '../capabilities';
import { expandGrokStoryCommand } from '../commands/GrokStoryCommandCatalog';
import { resolveGrokCliModel } from '../models';
import { getGrokProviderSettings } from '../settings';
import { runGrokHeadlessQuery } from './GrokHeadlessQueryRunner';

class StreamTextQueue {
  private closed = false;
  private readonly items: StreamChunk[] = [];
  private readonly waiters: Array<(chunk: StreamChunk | null) => void> = [];

  push(chunk: StreamChunk): void {
    if (this.closed) {
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(chunk);
      return;
    }
    this.items.push(chunk);
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.(null);
    }
  }

  async next(): Promise<StreamChunk | null> {
    if (this.items.length > 0) {
      return this.items.shift() ?? null;
    }
    if (this.closed) {
      return null;
    }
    return new Promise<StreamChunk | null>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

export class GrokChatRuntime implements ChatRuntime {
  readonly providerId = 'grok' as const;

  private abortController: AbortController | null = null;
  private connection: AcpClientConnection | null = null;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private lastAcpError: string | null = null;
  private process: AcpSubprocess | null = null;
  private ready = false;
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  private sessionHadPrompt = false;
  private sessionId: string | null = null;
  private sessionInvalidated = false;
  private readonly sessionUpdateNormalizer = new AcpSessionUpdateNormalizer();
  private transport: AcpJsonRpcTransport | null = null;
  private unregisterTransportClose: (() => void) | null = null;

  constructor(private readonly plugin: ClaudianPlugin) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return GROK_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    const expandedStoryCommand = expandGrokStoryCommand(request.text);
    return {
      isCompact: /^\/compact(?:\s|$)/i.test(request.text),
      mcpMentions: request.enabledMcpServers ?? new Set(),
      persistedContent: request.text,
      prompt: expandedStoryCommand ?? request.text,
      request,
    };
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.add(listener);
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  setResumeCheckpoint(_checkpointId: string | undefined): void {}

  syncConversationState(conversation: ChatRuntimeConversationState | null): void {
    if (!conversation) {
      this.sessionInvalidated = false;
      this.sessionHadPrompt = false;
      this.sessionId = null;
    }
  }

  async reloadMcpServers(): Promise<void> {}

  async ensureReady(_options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const settings = getGrokProviderSettings(this.plugin.settings as unknown as Record<string, unknown>);
    const ready = settings.enabled && Boolean(this.plugin.getResolvedProviderCliPath('grok'));
    this.setReady(ready);
    return ready;
  }

  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    this.currentTurnMetadata = {};

    if (turn.isCompact) {
      yield { type: 'error', content: 'Grokian does not support /compact in Grok mode yet.' };
      yield { type: 'done' };
      return;
    }

    const cliPath = this.plugin.getResolvedProviderCliPath('grok');
    if (!cliPath) {
      yield {
        type: 'error',
        content: 'Failed to start Grok. Check the Grok CLI path, PATH, and login state.',
      };
      yield { type: 'done' };
      return;
    }

    if (this.shouldShowHeadlessModelNotice(queryOptions?.model)) {
      yield {
        type: 'notice',
        level: 'info',
        content: 'Using Grok headless mode for the selected model alias.',
      };
    }

    yield* this.queryHeadless(turn, conversationHistory, queryOptions);
  }

  cancel(): void {
    this.abortController?.abort();
    if (this.connection && this.sessionId) {
      this.connection.cancel({ sessionId: this.sessionId });
    }
  }

  resetSession(): void {
    this.cancel();
    this.sessionHadPrompt = false;
    this.sessionId = null;
    this.sessionInvalidated = true;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  consumeSessionInvalidation(): boolean {
    const invalidated = this.sessionInvalidated;
    this.sessionInvalidated = false;
    return invalidated;
  }

  isReady(): boolean {
    return this.ready;
  }

  async getSupportedCommands(): Promise<SlashCommand[]> {
    return [];
  }

  getAuxiliaryModel(): string | null {
    return getGrokProviderSettings(
      this.plugin.settings as unknown as Record<string, unknown>,
    ).model;
  }

  cleanup(): void {
    this.cancel();
    void this.shutdownAcpProcess();
  }

  async rewind(
    _userMessageId: string,
    _assistantMessageId: string,
    _mode?: ChatRewindMode,
  ): Promise<ChatRewindResult> {
    return { canRewind: false, error: 'Grok ACP mode does not support rewind yet.' };
  }

  setApprovalCallback(_callback: ApprovalCallback | null): void {}
  setApprovalDismisser(_dismisser: (() => void) | null): void {}
  setAskUserQuestionCallback(_callback: AskUserQuestionCallback | null): void {}
  setExitPlanModeCallback(_callback: ExitPlanModeCallback | null): void {}
  setPermissionModeSyncCallback(_callback: ((sdkMode: string) => void) | null): void {}
  setSubagentHookProvider(_getState: () => SubagentRuntimeState): void {}
  setAutoTurnCallback(_callback: AutoTurnCallback | null): void {}

  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = this.currentTurnMetadata;
    this.currentTurnMetadata = {};
    return metadata;
  }

  buildSessionUpdates(_params: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    return {
      updates: {
        providerState: this.sessionHadPrompt ? { acpSessionId: this.sessionId } : undefined,
        sessionId: this.sessionId,
      },
    };
  }

  resolveSessionIdForFork(_conversation: Conversation | null): string | null {
    return null;
  }

  async loadSubagentToolCalls(_agentId: string): Promise<ToolCallInfo[]> {
    return [];
  }

  async loadSubagentFinalResult(_agentId: string): Promise<string | null> {
    return null;
  }

  private async ensureAcpReady(): Promise<boolean> {
    const settings = getGrokProviderSettings(this.plugin.settings as unknown as Record<string, unknown>);
    if (!settings.enabled) {
      this.setReady(false);
      return false;
    }

    const command = this.plugin.getResolvedProviderCliPath('grok');
    if (!command) {
      this.setReady(false);
      return false;
    }

    if (
      this.connection
      && this.transport
      && !this.transport.isClosed
      && this.process?.isAlive()
      && this.sessionId
    ) {
      this.setReady(true);
      return true;
    }

    await this.shutdownAcpProcess();

    try {
      await this.startAcpProcess(command);
      this.lastAcpError = null;
      this.setReady(true);
      return true;
    } catch (error) {
      this.lastAcpError = this.formatAcpError(error);
      await this.shutdownAcpProcess();
      this.setReady(false);
      return false;
    }
  }

  private async startAcpProcess(command: string): Promise<void> {
    const cwd = this.resolveWorkingDirectory();
    const envText = getRuntimeEnvironmentText(
      this.plugin.settings as unknown as Record<string, unknown>,
      'grok',
    );
    const env = {
      ...process.env,
      ...parseEnvironmentVariables(envText),
    };
    if (!env.XAI_API_KEY && env.GROK_CODE_XAI_API_KEY) {
      env.XAI_API_KEY = env.GROK_CODE_XAI_API_KEY;
    }

    const launchEnv: NodeJS.ProcessEnv = {
      ...env,
      PATH: getEnhancedPath(
        env.PATH,
        path.isAbsolute(command) ? command : undefined,
      ),
    };
    const acpProcess = new AcpSubprocess({
      args: ['--no-auto-update', 'agent', 'stdio'],
      command,
      cwd,
      env: launchEnv,
    });
    acpProcess.start();
    const transport = new AcpJsonRpcTransport({
      input: acpProcess.stdout,
      onClose: (listener) => acpProcess.onClose(listener),
      output: acpProcess.stdin,
    });
    const connection = new AcpClientConnection({
      clientInfo: {
        name: 'grokian',
        version: this.plugin.manifest?.version ?? '0.0.0',
      },
      transport,
    });

    this.process = acpProcess;
    this.transport = transport;
    this.connection = connection;
    this.unregisterTransportClose = transport.onClose((error) => {
      if (this.transport === transport) {
        this.setReady(false);
        if (error) {
          this.lastAcpError = this.formatAcpError(error);
        }
      }
    });

    transport.start();
    const init = await connection.initialize({ clientCapabilities: {} });

    const methodId = resolveAuthMethod(init.authMethods, launchEnv);
    if (methodId) {
      const authRequest = {
        methodId,
        _meta: { headless: true },
      };
      await connection.authenticate(authRequest);
    } else if (Array.isArray(init.authMethods) && init.authMethods.length > 0) {
      throw new Error('Run `grok login` first, or set XAI_API_KEY.');
    }

    const session = await connection.newSession({
      cwd,
      mcpServers: [],
    });
    this.sessionId = session.sessionId;
    this.sessionHadPrompt = false;
  }

  private async *queryAcp(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    const connection = this.connection;
    const sessionId = this.sessionId;
    if (!connection || !sessionId) {
      throw new Error('Grok ACP is not ready.');
    }

    const queue = new StreamTextQueue();
    const abortController = new AbortController();
    this.abortController = abortController;
    this.currentTurnMetadata.wasSent = true;
    this.sessionUpdateNormalizer.reset();

    const unregister = connection.onSessionNotification((notification) => {
      this.handleAcpSessionNotification(notification, sessionId, queue);
    });
    const abortPromise = new Promise<never>((_, reject) => {
      abortController.signal.addEventListener('abort', () => {
        connection.cancel({ sessionId });
        reject(new Error('Cancelled'));
      }, { once: true });
    });

    const promptText = this.buildPromptText(turn, this.sessionHadPrompt ? [] : conversationHistory ?? []);
    const rawPromptPromise = connection.prompt({
      sessionId,
      prompt: [{ type: 'text', text: promptText }],
    });
    rawPromptPromise.catch(() => {});

    const promptPromise = Promise.race([rawPromptPromise, abortPromise])
      .then((response) => {
        if (response.userMessageId) {
          this.currentTurnMetadata.userMessageId = response.userMessageId;
        }
        this.sessionHadPrompt = true;
        queue.push({ type: 'done' });
      })
      .catch((error: unknown) => {
        if (!abortController.signal.aborted || formatError(error) !== 'Cancelled') {
          queue.push({ type: 'error', content: formatError(error) });
        }
        queue.push({ type: 'done' });
      })
      .finally(() => {
        unregister();
        if (this.abortController === abortController) {
          this.abortController = null;
        }
        queue.close();
      });

    try {
      while (true) {
        const chunk = await queue.next();
        if (!chunk) {
          break;
        }
        yield chunk;
        if (chunk.type === 'done') {
          break;
        }
      }
      await promptPromise;
    } finally {
      unregister();
      if (this.abortController === abortController) {
        this.abortController = null;
      }
    }
  }

  private async *queryHeadless(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    const queue = new StreamTextQueue();
    const abortController = new AbortController();
    this.abortController = abortController;
    this.currentTurnMetadata.wasSent = true;

    const runPromise = runGrokHeadlessQuery({
      abortSignal: abortController.signal,
      conversationHistory,
      model: queryOptions?.model,
      onTextDelta: (delta) => {
        if (delta) {
          queue.push({ type: 'text', content: delta });
        }
      },
      plugin: this.plugin,
      prompt: turn.prompt,
      images: turn.request.images,
      systemPrompt: buildSystemPrompt(this.getSystemPromptSettings()),
    })
      .then(() => {
        queue.push({ type: 'done' });
      })
      .catch((error: unknown) => {
        if (!abortController.signal.aborted) {
          queue.push({ type: 'error', content: formatError(error) });
        }
        queue.push({ type: 'done' });
      })
      .finally(() => {
        if (this.abortController === abortController) {
          this.abortController = null;
        }
        queue.close();
      });

    try {
      while (true) {
        const chunk = await queue.next();
        if (!chunk) {
          break;
        }
        yield chunk;
        if (chunk.type === 'done') {
          break;
        }
      }
      await runPromise;
    } finally {
      if (this.abortController === abortController) {
        this.abortController = null;
      }
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    }
  }

  private shouldShowHeadlessModelNotice(model: string | undefined): boolean {
    return resolveGrokCliModel(model) !== null;
  }

  private async shutdownAcpProcess(): Promise<void> {
    this.setReady(false);
    this.unregisterTransportClose?.();
    this.unregisterTransportClose = null;
    this.connection?.dispose();
    this.connection = null;
    this.transport?.dispose();
    this.transport = null;
    const acpProcess = this.process;
    this.process = null;
    this.sessionId = null;
    this.sessionHadPrompt = false;
    this.sessionUpdateNormalizer.reset();
    if (acpProcess) {
      await acpProcess.shutdown().catch(() => {});
    }
  }

  private handleAcpSessionNotification(
    notification: AcpSessionNotification,
    sessionId: string,
    queue: StreamTextQueue,
  ): void {
    if (notification.sessionId !== sessionId) {
      return;
    }

    const normalized = this.sessionUpdateNormalizer.normalize(notification.update);
    if (normalized.type !== 'message_chunk') {
      return;
    }

    if (normalized.role === 'assistant' && normalized.messageId) {
      this.currentTurnMetadata.assistantMessageId = normalized.messageId;
    }
    if (normalized.role === 'user' && normalized.messageId) {
      this.currentTurnMetadata.userMessageId = normalized.messageId;
    }
    for (const chunk of normalized.streamChunks) {
      queue.push(chunk);
    }
  }

  private buildPromptText(turn: PreparedChatTurn, conversationHistory: ChatMessage[]): string {
    const sections: string[] = [
      `<system>\n${buildSystemPrompt(this.getSystemPromptSettings())}\n</system>`,
    ];
    const history = buildHistoryContext(conversationHistory);
    if (history) {
      sections.push(`<conversation_so_far>\n${history}\n</conversation_so_far>`);
    }
    sections.push(turn.prompt);
    return sections.join('\n\n');
  }

  private getSystemPromptSettings(): SystemPromptSettings {
    return {
      customPrompt: this.plugin.settings.systemPrompt,
      mediaFolder: this.plugin.settings.mediaFolder,
      userName: this.plugin.settings.userName,
      vaultPath: this.resolveWorkingDirectory(),
    };
  }

  private resolveWorkingDirectory(): string {
    try {
      return getVaultPath(this.plugin.app) ?? process.cwd();
    } catch {
      return process.cwd();
    }
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) {
      return;
    }

    this.ready = ready;
    for (const listener of this.readyListeners) {
      listener(ready);
    }
  }

  private formatAcpError(error: unknown): string {
    const message = formatError(error);
    const stderr = this.process?.getStderrSnapshot();
    return stderr ? `${message}\n\n${stderr}` : message;
  }
}

function resolveAuthMethod(
  authMethods: readonly AcpAuthMethod[] | null | undefined,
  env: NodeJS.ProcessEnv,
): string | null {
  const ids = new Set((authMethods ?? []).map(method => method.id).filter(Boolean));
  if (ids.size === 0) {
    return null;
  }
  if ((env.XAI_API_KEY || env.GROK_CODE_XAI_API_KEY) && ids.has('xai.api_key')) {
    return 'xai.api_key';
  }
  if (ids.has('cached_token')) {
    return 'cached_token';
  }
  return ids.has('xai.api_key') ? 'xai.api_key' : null;
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
