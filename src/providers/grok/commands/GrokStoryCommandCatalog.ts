import type {
  ProviderCommandCatalog,
  ProviderCommandDropdownConfig,
} from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type { SlashCommand } from '../../../core/types';
import { extractFirstParagraph, parsedToSlashCommand, parseSlashCommandContent } from '../../../utils/slashCommand';

type GrokStoryCommandName =
  | 'plan-scene'
  | 'generate-beats'
  | 'continue-draft'
  | 'rewrite-selection'
  | 'consistency-check'
  | 'update-story-bible';

type GrokCliPassthroughCommandName =
  | 'help'
  | 'inspect'
  | 'mcp'
  | 'memory'
  | 'model'
  | 'models'
  | 'sessions';

interface GrokStoryCommandDefinition {
  argumentHint: string;
  content: string;
  description: string;
  name: GrokStoryCommandName;
}

type SkillOwner = 'grok' | 'claude' | 'codex';

interface SkillRootDefinition {
  displayPrefix: string;
  owner: SkillOwner;
  rootPath: string;
  sourceLabel: string;
  scope: 'vault' | 'home';
}

interface SkillRootRuntimeDefinition extends SkillRootDefinition {
  adapter: SkillFileAdapter;
}

type SkillFileAdapter = Pick<VaultFileAdapter, 'exists' | 'listFolders' | 'read'>;

const STORY_CONTEXT_NOTE = [
  'Use the active manuscript Markdown as the source of truth.',
  'Use `.grokian/project.json` for project metadata when available.',
  'Use `.grokian/story-plan.yaml` for story bible and scene planning when available.',
  'Do not overwrite manuscript text directly; return a candidate, patch, or checklist the writer can accept.',
].join('\n');

export const GROK_STORY_COMMANDS: readonly GrokStoryCommandDefinition[] = Object.freeze([
  {
    name: 'plan-scene',
    description: 'Plan a scene with goal, conflict, turn, and exit hook.',
    argumentHint: '<scene goal or chapter>',
    content: [
      'Plan the next scene for this novel project.',
      STORY_CONTEXT_NOTE,
      '',
      'User direction:',
      '$ARGUMENTS',
      '',
      'Return:',
      '1. Scene purpose',
      '2. POV and emotional state',
      '3. Setting and sensory anchors',
      '4. Conflict and escalation',
      '5. Turn/reversal',
      '6. Exit hook',
      '7. Risks for continuity',
    ].join('\n'),
  },
  {
    name: 'generate-beats',
    description: 'Generate compact story beats for a chapter or sequence.',
    argumentHint: '<chapter, arc, or premise>',
    content: [
      'Generate story beats for the requested chapter or sequence.',
      STORY_CONTEXT_NOTE,
      '',
      'User direction:',
      '$ARGUMENTS',
      '',
      'Return 8-12 beats. Keep each beat actionable and manuscript-facing.',
      'Mark optional beats separately from required beats.',
    ].join('\n'),
  },
  {
    name: 'continue-draft',
    description: 'Continue the current draft in the existing voice.',
    argumentHint: '<direction, mood, or target length>',
    content: [
      'Continue the current manuscript draft.',
      STORY_CONTEXT_NOTE,
      '',
      'User direction:',
      '$ARGUMENTS',
      '',
      'Match the existing prose voice and pacing.',
      'Return only candidate manuscript prose unless a continuity issue blocks the continuation.',
    ].join('\n'),
  },
  {
    name: 'rewrite-selection',
    description: 'Rewrite the selected passage as an accept/reject candidate.',
    argumentHint: '<rewrite instruction>',
    content: [
      'Rewrite the selected manuscript passage.',
      STORY_CONTEXT_NOTE,
      '',
      'User direction:',
      '$ARGUMENTS',
      '',
      'Preserve factual continuity and character intent.',
      'Return the replacement candidate first, followed by a short rationale.',
    ].join('\n'),
  },
  {
    name: 'consistency-check',
    description: 'Check continuity, voice, timeline, and unresolved setup.',
    argumentHint: '<scope to check>',
    content: [
      'Run a novel consistency check.',
      STORY_CONTEXT_NOTE,
      '',
      'Scope:',
      '$ARGUMENTS',
      '',
      'Return findings grouped by: continuity, character, timeline, world rules, prose voice, and open loops.',
      'For each issue, include severity and a concrete fix suggestion.',
    ].join('\n'),
  },
  {
    name: 'update-story-bible',
    description: 'Propose updates for .grokian/story-plan.yaml.',
    argumentHint: '<new facts or scene outcome>',
    content: [
      'Propose story bible updates for `.grokian/story-plan.yaml`.',
      STORY_CONTEXT_NOTE,
      '',
      'New facts or scene outcome:',
      '$ARGUMENTS',
      '',
      'Do not rewrite the whole file.',
      'Return a concise patch-style proposal grouped by characters, locations, scenes, themes, and notes.',
    ].join('\n'),
  },
]);

const GROK_CLI_PASSTHROUGH_COMMANDS: readonly {
  argumentHint: string;
  description: string;
  name: GrokCliPassthroughCommandName;
}[] = Object.freeze([
  {
    name: 'model',
    description: 'Open or invoke the Grok CLI model selector when supported by the local CLI.',
    argumentHint: '<optional model>',
  },
  {
    name: 'models',
    description: 'Ask Grok CLI to list or discuss available local account models.',
    argumentHint: '<optional filter>',
  },
  {
    name: 'help',
    description: 'Pass through to Grok CLI help/slash help.',
    argumentHint: '<optional topic>',
  },
  {
    name: 'inspect',
    description: 'Pass through to Grok CLI configuration inspection.',
    argumentHint: '<optional scope>',
  },
  {
    name: 'mcp',
    description: 'Pass through to Grok CLI MCP management/help.',
    argumentHint: '<optional command>',
  },
  {
    name: 'memory',
    description: 'Pass through to Grok CLI memory management/help.',
    argumentHint: '<optional command>',
  },
  {
    name: 'sessions',
    description: 'Pass through to Grok CLI session management/help.',
    argumentHint: '<optional query>',
  },
]);

const SKILL_ROOTS: readonly SkillRootDefinition[] = Object.freeze([
  {
    displayPrefix: '/grok:',
    owner: 'grok',
    rootPath: '.grok/skills',
    sourceLabel: 'Grok skill (vault)',
    scope: 'vault',
  },
  {
    displayPrefix: '/grok:',
    owner: 'grok',
    rootPath: '.grokian/skills',
    sourceLabel: 'Grok skill (vault)',
    scope: 'vault',
  },
  {
    displayPrefix: '/claude:',
    owner: 'claude',
    rootPath: '.claude/skills',
    sourceLabel: 'Claude skill (vault)',
    scope: 'vault',
  },
  {
    displayPrefix: '/claude:',
    owner: 'claude',
    rootPath: '.agents/skills',
    sourceLabel: 'Claude skill (vault)',
    scope: 'vault',
  },
  {
    displayPrefix: '/codex:',
    owner: 'codex',
    rootPath: '.codex/skills',
    sourceLabel: 'Codex',
    scope: 'vault',
  },
]);

const HOME_SKILL_ROOTS: readonly SkillRootDefinition[] = Object.freeze([
  {
    displayPrefix: '/grok:',
    owner: 'grok',
    rootPath: '.grok/skills',
    sourceLabel: 'Grok skill (home)',
    scope: 'home',
  },
  {
    displayPrefix: '/claude:',
    owner: 'claude',
    rootPath: '.claude/skills',
    sourceLabel: 'Claude skill (home)',
    scope: 'home',
  },
  {
    displayPrefix: '/claude:',
    owner: 'claude',
    rootPath: '.agents/skills',
    sourceLabel: 'Claude skill (home)',
    scope: 'home',
  },
  {
    displayPrefix: '/codex:',
    owner: 'codex',
    rootPath: '.codex/skills',
    sourceLabel: 'Codex',
    scope: 'home',
  },
]);

const slashExpansionCache = new Map<string, ProviderCommandEntry>();

export class GrokStoryCommandCatalog implements ProviderCommandCatalog {
  constructor(
    private readonly vaultAdapter?: SkillFileAdapter,
    private readonly homeAdapter?: SkillFileAdapter,
  ) {}

  setRuntimeCommands(_commands: SlashCommand[]): void {}

  async listDropdownEntries(_context: { includeBuiltIns: boolean }): Promise<ProviderCommandEntry[]> {
    const entries = [
      ...GROK_STORY_COMMANDS.map(commandToEntry),
      ...GROK_CLI_PASSTHROUGH_COMMANDS.map(cliPassthroughCommandToEntry),
      ...await this.loadSkillEntries(),
    ];
    refreshSlashExpansionCache(entries);
    return entries;
  }

  async listVaultEntries(): Promise<ProviderCommandEntry[]> {
    return this.listDropdownEntries({ includeBuiltIns: false });
  }

  async saveVaultEntry(_entry: ProviderCommandEntry): Promise<void> {
    throw new Error('Grokian story commands are built in and are not editable yet.');
  }

  async deleteVaultEntry(_entry: ProviderCommandEntry): Promise<void> {
    throw new Error('Grokian story commands are built in and are not deletable.');
  }

  getDropdownConfig(): ProviderCommandDropdownConfig {
    return {
      builtInPrefix: '/',
      commandPrefix: '/',
      providerId: 'grok',
      skillPrefix: '/',
      triggerChars: ['/'],
    };
  }

  async refresh(): Promise<void> {}

  private async loadSkillEntries(): Promise<ProviderCommandEntry[]> {
    const roots = this.getSkillRoots();
    if (roots.length === 0) {
      return [];
    }

    const entriesByKey = new Map<string, ProviderCommandEntry>();
    for (const root of roots) {
      for (const entry of await this.loadSkillRoot(root)) {
        const key = `${root.owner}:${entry.name.toLowerCase()}`;
        if (!entriesByKey.has(key)) {
          entriesByKey.set(key, entry);
        }
      }
    }
    return [...entriesByKey.values()];
  }

  private getSkillRoots(): SkillRootRuntimeDefinition[] {
    const roots: SkillRootRuntimeDefinition[] = [];
    if (this.vaultAdapter) {
      roots.push(...SKILL_ROOTS.map(root => ({ ...root, adapter: this.vaultAdapter! })));
    }
    if (this.homeAdapter) {
      roots.push(...HOME_SKILL_ROOTS.map(root => ({ ...root, adapter: this.homeAdapter! })));
    }
    return roots;
  }

  private async loadSkillRoot(root: SkillRootRuntimeDefinition): Promise<ProviderCommandEntry[]> {
    let folders: string[];
    try {
      folders = await root.adapter.listFolders(root.rootPath);
    } catch {
      return [];
    }

    const entries = await Promise.all(folders.map(folder => this.loadSkillFolder(root, folder)));
    return entries.filter((entry): entry is ProviderCommandEntry => entry !== null);
  }

  private async loadSkillFolder(
    root: SkillRootRuntimeDefinition,
    folder: string,
  ): Promise<ProviderCommandEntry | null> {
    const skillName = folder.split('/').pop()?.trim();
    if (!skillName) {
      return null;
    }

    const skillDirPath = `${root.rootPath}/${skillName}`;
    try {
      const skillPath = await resolveSkillPath(root.adapter, skillDirPath);
      if (!skillPath) {
        return null;
      }

      const content = await root.adapter.read(skillPath);
      const parsed = parseSlashCommandContent(content);
      const command = {
        ...parsedToSlashCommand(parsed, {
          id: `grokian-${root.owner}-${root.scope}-skill-${skillName}`,
          name: skillName,
          source: 'user',
        }),
        description: parsed.description ?? extractFirstParagraph(parsed.promptContent),
        kind: 'skill' as const,
      };
      return skillToEntry(command, root, skillPath);
    } catch {
      // Non-critical: skip malformed or unreadable skill files.
      return null;
    }
  }
}

export function expandGrokStoryCommand(input: string): string | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^\/(?:(grok|claude|codex):)?([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/i);
  if (!match) {
    return null;
  }

  const owner = match[1]?.toLowerCase() as SkillOwner | undefined;
  const name = match[2].toLowerCase();
  const cacheKey = owner ? `${owner}:${name}` : name;
  if (!owner && GROK_CLI_PASSTHROUGH_COMMANDS.some(entry => entry.name === name)) {
    return trimmed;
  }
  const cachedEntry = slashExpansionCache.get(cacheKey);
  if (cachedEntry) {
    const argumentsText = match[3]?.trim() || '(no extra direction provided)';
    return cachedEntry.content.replaceAll('$ARGUMENTS', argumentsText);
  }

  const command = GROK_STORY_COMMANDS.find(entry => entry.name === name);
  if (!command) {
    return null;
  }

  const argumentsText = match[3]?.trim() || '(no extra direction provided)';
  return command.content.replaceAll('$ARGUMENTS', argumentsText);
}

function refreshSlashExpansionCache(entries: ProviderCommandEntry[]): void {
  slashExpansionCache.clear();
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    if (entry.kind === 'skill' && entry.persistenceKey?.startsWith('grok:')) {
      slashExpansionCache.set(`grok:${name}`, entry);
      if (!slashExpansionCache.has(name)) {
        slashExpansionCache.set(name, entry);
      }
      continue;
    }
    if (entry.kind === 'skill' && entry.persistenceKey?.startsWith('claude:')) {
      slashExpansionCache.set(`claude:${name}`, entry);
      if (!slashExpansionCache.has(name)) {
        slashExpansionCache.set(name, entry);
      }
      continue;
    }
    if (entry.kind === 'skill' && entry.persistenceKey?.startsWith('codex:')) {
      slashExpansionCache.set(`codex:${name}`, entry);
      if (!slashExpansionCache.has(name)) {
        slashExpansionCache.set(name, entry);
      }
      continue;
    }
    slashExpansionCache.set(name, entry);
  }
}

function commandToEntry(command: GrokStoryCommandDefinition): ProviderCommandEntry {
  return {
    argumentHint: command.argumentHint,
    content: command.content,
    description: command.description,
    displayPrefix: '/',
    id: `grokian:${command.name}`,
    insertPrefix: '/',
    isDeletable: false,
    isEditable: false,
    kind: 'command',
    name: command.name,
    providerId: 'grok',
    scope: 'system',
    source: 'builtin',
  };
}

function cliPassthroughCommandToEntry(command: typeof GROK_CLI_PASSTHROUGH_COMMANDS[number]): ProviderCommandEntry {
  return {
    argumentHint: command.argumentHint,
    content: `/${command.name} $ARGUMENTS`,
    description: command.description,
    displayPrefix: '/',
    id: `grok-cli:${command.name}`,
    insertPrefix: '/',
    isDeletable: false,
    isEditable: false,
    kind: 'command',
    name: command.name,
    providerId: 'grok',
    scope: 'runtime',
    source: 'builtin',
    sourceLabel: 'Grok CLI',
  };
}

async function resolveSkillPath(adapter: SkillFileAdapter, skillDirPath: string): Promise<string | null> {
  const candidates = [
    `${skillDirPath}/SKILL.md`,
    `${skillDirPath}/SKILL.MD`,
    `${skillDirPath}/skill.md`,
  ];
  for (const candidate of candidates) {
    if (await adapter.exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function skillToEntry(
  command: SlashCommand,
  root: SkillRootDefinition,
  skillPath: string,
): ProviderCommandEntry {
  return {
    argumentHint: command.argumentHint,
    content: command.content,
    description: command.description,
    displayPrefix: root.displayPrefix,
    id: command.id,
    insertPrefix: root.displayPrefix,
    isDeletable: false,
    isEditable: false,
    kind: 'skill',
    name: command.name,
    providerId: 'grok',
    scope: root.scope === 'vault' ? 'vault' : 'user',
    source: command.source ?? 'user',
    sourceLabel: root.sourceLabel,
    persistenceKey: `${root.owner}:${root.scope}:${skillPath}`,
    allowedTools: command.allowedTools,
    model: command.model,
    disableModelInvocation: command.disableModelInvocation,
    userInvocable: command.userInvocable,
    context: command.context,
    agent: command.agent,
    hooks: command.hooks,
  };
}
