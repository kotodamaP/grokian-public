import {
  GROKIAN_CANDIDATES_PATH,
  GROKIAN_PROJECT_PATH,
  GROKIAN_STORAGE_PATH,
  GROKIAN_STORY_PLAN_PATH,
} from '../bootstrap/StoragePaths';
import type { VaultFileAdapter } from '../storage/VaultFileAdapter';

export const GROKIAN_PROJECT_SCHEMA_VERSION = 1;

export interface GrokianSessionMapping {
  conversationId: string;
  manuscriptPath: string;
  providerSessionId?: string | null;
  updatedAt: number;
}

export interface GrokianProjectMetadata {
  createdAt: number;
  defaultLanguage: string;
  manuscriptRoot: string;
  schemaVersion: typeof GROKIAN_PROJECT_SCHEMA_VERSION;
  sessions: Record<string, GrokianSessionMapping>;
  title: string;
  updatedAt: number;
}

export interface StorySidecarInitializeOptions {
  defaultLanguage?: string;
  manuscriptRoot?: string;
  now?: number;
  projectTitle?: string;
}

export interface StoryCandidateInput {
  content: string;
  conversationId?: string;
  createdAt?: number;
  id?: string;
  instruction?: string;
  manuscriptPath?: string;
  title?: string;
}

export interface StoryCandidateRecord extends Required<Pick<StoryCandidateInput, 'content' | 'id'>> {
  conversationId?: string;
  createdAt: number;
  instruction?: string;
  manuscriptPath?: string;
  path: string;
  title?: string;
}

export interface StorySessionMappingInput {
  conversationId: string;
  manuscriptPath: string;
  now?: number;
  providerSessionId?: string | null;
}

export class StorySidecarStorage {
  constructor(private readonly adapter: VaultFileAdapter) {}

  async ensureBaseFolders(): Promise<void> {
    await this.adapter.ensureFolder(GROKIAN_STORAGE_PATH);
    await this.adapter.ensureFolder(GROKIAN_CANDIDATES_PATH);
  }

  async ensureInitialized(options: StorySidecarInitializeOptions = {}): Promise<GrokianProjectMetadata> {
    await this.ensureBaseFolders();

    const now = options.now ?? Date.now();
    if (!(await this.adapter.exists(GROKIAN_PROJECT_PATH))) {
      await this.saveProject(this.createDefaultProject(options, now));
    }
    if (!(await this.adapter.exists(GROKIAN_STORY_PLAN_PATH))) {
      await this.adapter.write(GROKIAN_STORY_PLAN_PATH, createDefaultStoryPlanYaml());
    }

    const loaded = await this.loadProject();
    if (loaded) {
      return loaded;
    }

    const fallback = this.createDefaultProject(options, now);
    await this.saveProject(fallback);
    return fallback;
  }

  async loadProject(): Promise<GrokianProjectMetadata | null> {
    if (!(await this.adapter.exists(GROKIAN_PROJECT_PATH))) {
      return null;
    }

    try {
      const parsed = JSON.parse(await this.adapter.read(GROKIAN_PROJECT_PATH));
      return normalizeProjectMetadata(parsed);
    } catch {
      return null;
    }
  }

  async saveProject(project: GrokianProjectMetadata): Promise<void> {
    const normalized = normalizeProjectMetadata(project) ?? project;
    await this.adapter.write(
      GROKIAN_PROJECT_PATH,
      `${JSON.stringify(normalized, null, 2)}\n`,
    );
  }

  async upsertSessionMapping(input: StorySessionMappingInput): Promise<GrokianProjectMetadata> {
    const now = input.now ?? Date.now();
    const project = await this.ensureInitialized({ now });
    project.sessions[input.conversationId] = {
      conversationId: input.conversationId,
      manuscriptPath: input.manuscriptPath,
      providerSessionId: input.providerSessionId ?? null,
      updatedAt: now,
    };
    project.updatedAt = now;
    await this.saveProject(project);
    return project;
  }

  async saveCandidate(input: StoryCandidateInput): Promise<StoryCandidateRecord> {
    await this.ensureBaseFolders();

    const createdAt = input.createdAt ?? Date.now();
    const id = sanitizeCandidateId(input.id) ?? `candidate-${createdAt}`;
    const path = `${GROKIAN_CANDIDATES_PATH}/${id}.md`;
    const record: StoryCandidateRecord = {
      content: input.content,
      createdAt,
      id,
      path,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.instruction ? { instruction: input.instruction } : {}),
      ...(input.manuscriptPath ? { manuscriptPath: input.manuscriptPath } : {}),
      ...(input.title ? { title: input.title } : {}),
    };

    await this.adapter.write(path, serializeCandidate(record));
    return record;
  }

  async listCandidatePaths(): Promise<string[]> {
    return (await this.adapter.listFiles(GROKIAN_CANDIDATES_PATH))
      .filter(path => path.endsWith('.md'))
      .sort();
  }

  private createDefaultProject(
    options: StorySidecarInitializeOptions,
    now: number,
  ): GrokianProjectMetadata {
    return {
      createdAt: now,
      defaultLanguage: options.defaultLanguage ?? 'ja',
      manuscriptRoot: options.manuscriptRoot ?? '',
      schemaVersion: GROKIAN_PROJECT_SCHEMA_VERSION,
      sessions: {},
      title: normalizeTitle(options.projectTitle) ?? 'Grokian Project',
      updatedAt: now,
    };
  }
}

function normalizeProjectMetadata(value: unknown): GrokianProjectMetadata | null {
  if (!isRecord(value)) {
    return null;
  }

  const createdAt = normalizeNumber(value.createdAt) ?? Date.now();
  const updatedAt = normalizeNumber(value.updatedAt) ?? createdAt;
  return {
    createdAt,
    defaultLanguage: normalizeString(value.defaultLanguage) ?? 'ja',
    manuscriptRoot: normalizeString(value.manuscriptRoot) ?? '',
    schemaVersion: GROKIAN_PROJECT_SCHEMA_VERSION,
    sessions: normalizeSessionMappings(value.sessions),
    title: normalizeTitle(value.title) ?? 'Grokian Project',
    updatedAt,
  };
}

function normalizeSessionMappings(value: unknown): Record<string, GrokianSessionMapping> {
  if (!isRecord(value)) {
    return {};
  }

  const mappings: Record<string, GrokianSessionMapping> = {};
  for (const [conversationId, rawMapping] of Object.entries(value)) {
    if (!isRecord(rawMapping)) {
      continue;
    }

    const normalizedConversationId = normalizeString(rawMapping.conversationId) ?? conversationId;
    const manuscriptPath = normalizeString(rawMapping.manuscriptPath);
    if (!normalizedConversationId || !manuscriptPath) {
      continue;
    }

    mappings[normalizedConversationId] = {
      conversationId: normalizedConversationId,
      manuscriptPath,
      providerSessionId: normalizeNullableString(rawMapping.providerSessionId),
      updatedAt: normalizeNumber(rawMapping.updatedAt) ?? Date.now(),
    };
  }
  return mappings;
}

function createDefaultStoryPlanYaml(): string {
  return [
    'schemaVersion: 1',
    'logline: ""',
    'themes: []',
    'characters: []',
    'locations: []',
    'scenes: []',
    'notes: []',
    '',
  ].join('\n');
}

function serializeCandidate(record: StoryCandidateRecord): string {
  const lines = [
    '---',
    `id: ${yamlScalar(record.id)}`,
    `createdAt: ${record.createdAt}`,
  ];
  if (record.title) {
    lines.push(`title: ${yamlScalar(record.title)}`);
  }
  if (record.manuscriptPath) {
    lines.push(`manuscriptPath: ${yamlScalar(record.manuscriptPath)}`);
  }
  if (record.conversationId) {
    lines.push(`conversationId: ${yamlScalar(record.conversationId)}`);
  }
  if (record.instruction) {
    lines.push(`instruction: ${yamlScalar(record.instruction)}`);
  }
  lines.push('---', '', record.content.trimEnd(), '');
  return lines.join('\n');
}

function sanitizeCandidateId(value: string | undefined): string | null {
  const normalized = value?.trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || null;
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function normalizeTitle(value: unknown): string | null {
  return normalizeString(value)?.slice(0, 120) ?? null;
}

function normalizeNullableString(value: unknown): string | null {
  return value === null ? null : normalizeString(value);
}

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
