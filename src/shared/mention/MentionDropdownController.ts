import type { TFile } from 'obsidian';
import { setIcon } from 'obsidian';

import { buildExternalContextDisplayEntries } from '../../utils/externalContext';
import { type ExternalContextFile, externalContextScanner } from '../../utils/externalContextScanner';
import { extractMcpMentions } from '../../utils/mcp';
import { SelectableDropdown } from '../components/SelectableDropdown';
import { appendMcpIcon } from '../icons';
import {
  type AgentMentionProvider,
  type FolderMentionItem,
  type MentionItem,
} from './types';

export type { AgentMentionProvider };

export interface MentionDropdownOptions {
  fixed?: boolean;
}

export interface MentionDropdownCallbacks {
  onAttachFile: (path: string) => void;
  onMcpMentionChange?: (servers: Set<string>) => void;
  onAgentMentionSelect?: (agentId: string) => void;
  getMentionedMcpServers: () => Set<string>;
  setMentionedMcpServers: (mentions: Set<string>) => boolean;
  addMentionedMcpServer: (name: string) => void;
  getExternalContexts: () => string[];
  getCachedVaultFolders: () => Array<Pick<FolderMentionItem, 'name' | 'path'>>;
  getCachedVaultFiles: () => TFile[];
  getVaultFileSearchTokens?: (file: TFile) => string[];
  normalizePathForVault: (path: string | undefined | null) => string | null;
}

export interface McpMentionProvider {
  getContextSavingServers: () => Array<{ name: string }>;
}

export class MentionDropdownController {
  private containerEl: HTMLElement;
  private inputEl: HTMLTextAreaElement | HTMLInputElement;
  private callbacks: MentionDropdownCallbacks;
  private dropdown: SelectableDropdown<MentionItem>;
  private mentionStartIndex = -1;
  private selectedMentionIndex = 0;
  private filteredMentionItems: MentionItem[] = [];
  private filteredContextFiles: ExternalContextFile[] = [];
  private activeContextFilter: { folderName: string; contextRoot: string } | null = null;
  private activeAgentFilter = false;
  private mcpManager: McpMentionProvider | null = null;
  private agentService: AgentMentionProvider | null = null;
  private fixed: boolean;
  private debounceTimer: number | null = null;

  constructor(
    containerEl: HTMLElement,
    inputEl: HTMLTextAreaElement | HTMLInputElement,
    callbacks: MentionDropdownCallbacks,
    options: MentionDropdownOptions = {}
  ) {
    this.containerEl = containerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;
    this.fixed = options.fixed ?? false;

    this.dropdown = new SelectableDropdown<MentionItem>(this.containerEl, {
      listClassName: 'claudian-mention-dropdown',
      itemClassName: 'claudian-mention-item',
      emptyClassName: 'claudian-mention-empty',
      fixed: this.fixed,
      fixedClassName: 'claudian-mention-dropdown-fixed',
    });
  }

  setMcpManager(manager: McpMentionProvider | null): void {
    this.mcpManager = manager;
  }

  setAgentService(service: AgentMentionProvider | null): void {
    if (this.agentService !== service && this.dropdown.isVisible()) {
      this.hide();
    }
    this.agentService = service;
  }

  preScanExternalContexts(): void {
    const externalContexts = this.callbacks.getExternalContexts() || [];
    if (externalContexts.length === 0) return;

    window.setTimeout(() => {
      try {
        externalContextScanner.scanPaths(externalContexts);
      } catch {
        // Pre-scan is best-effort, ignore failures
      }
    }, 0);
  }

  isVisible(): boolean {
    return this.dropdown.isVisible();
  }

  hide(): void {
    this.dropdown.hide();
    this.mentionStartIndex = -1;
  }

  containsElement(el: Node): boolean {
    return this.dropdown.getElement()?.contains(el) ?? false;
  }

  destroy(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    this.dropdown.destroy();
  }

  updateMcpMentionsFromText(text: string): void {
    if (!this.mcpManager) return;

    const validNames = new Set(
      this.mcpManager.getContextSavingServers().map(s => s.name)
    );

    const newMentions = extractMcpMentions(text, validNames);
    const changed = this.callbacks.setMentionedMcpServers(newMentions);

    if (changed) {
      this.callbacks.onMcpMentionChange?.(newMentions);
    }
  }

  handleInputChange(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      const text = this.inputEl.value;
      this.updateMcpMentionsFromText(text);

      const cursorPos = this.inputEl.selectionStart || 0;
      const textBeforeCursor = text.substring(0, cursorPos);
      const lastAtIndex = textBeforeCursor.lastIndexOf('@');

      if (lastAtIndex === -1) {
        this.hide();
        return;
      }

      const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
      if (!/\s/.test(charBeforeAt) && lastAtIndex !== 0) {
        this.hide();
        return;
      }

      const searchText = textBeforeCursor.substring(lastAtIndex + 1);

      if (/[\r\n]/.test(searchText) || /\s$/.test(searchText)) {
        this.hide();
        return;
      }

      this.mentionStartIndex = lastAtIndex;
      this.showMentionDropdown(searchText);
    }, 200);
  }

  handleKeydown(e: KeyboardEvent): boolean {
    if (!this.dropdown.isVisible()) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.dropdown.moveSelection(1);
      this.selectedMentionIndex = this.dropdown.getSelectedIndex();
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.dropdown.moveSelection(-1);
      this.selectedMentionIndex = this.dropdown.getSelectedIndex();
      return true;
    }
    // Check !e.isComposing for IME support (Chinese, Japanese, Korean, etc.)
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.isComposing) {
      e.preventDefault();
      this.selectMentionItem();
      return true;
    }
    if (e.key === 'Escape' && !e.isComposing) {
      e.preventDefault();
      // If in secondary menu, return to first level instead of closing
      if (this.activeContextFilter || this.activeAgentFilter) {
        this.returnToFirstLevel();
        return true;
      }
      this.hide();
      return true;
    }

    return false;
  }

  private showMentionDropdown(searchText: string): void {
    const searchLower = searchText.toLowerCase();
    this.filteredMentionItems = [];
    this.filteredContextFiles = [];

    const externalContexts = this.callbacks.getExternalContexts() || [];
    const contextEntries = buildExternalContextDisplayEntries(externalContexts);

    const isFilterSearch = searchText.includes('/');
    let fileSearchText = searchLower;

    if (isFilterSearch && searchLower.startsWith('agents/')) {
      this.activeAgentFilter = true;
      this.activeContextFilter = null;
      const agentSearchText = searchText.substring('agents/'.length).toLowerCase();

      if (this.agentService) {
        const matchingAgents = this.agentService.searchAgents(agentSearchText);
        for (const agent of matchingAgents) {
          this.filteredMentionItems.push({
            type: 'agent',
            id: agent.id,
            name: agent.name,
            description: agent.description,
            source: agent.source,
          });
        }
      }

      this.selectedMentionIndex = 0;
      this.renderMentionDropdown();
      return;
    }

    if (isFilterSearch) {
      const matchingContext = contextEntries
        .filter(entry => searchLower.startsWith(`${entry.displayNameLower}/`))
        .sort((a, b) => b.displayNameLower.length - a.displayNameLower.length)[0];

      if (matchingContext) {
        const prefixLength = matchingContext.displayName.length + 1;
        fileSearchText = searchText.substring(prefixLength).toLowerCase();
        this.activeContextFilter = {
          folderName: matchingContext.displayName,
          contextRoot: matchingContext.contextRoot,
        };
      } else {
        this.activeContextFilter = null;
      }
    }

    if (this.activeContextFilter && isFilterSearch) {
      const contextFiles = externalContextScanner.scanPaths([this.activeContextFilter.contextRoot]);
      this.filteredContextFiles = contextFiles
        .filter(file => {
          const relativePath = file.relativePath.replace(/\\/g, '/');
          const pathLower = relativePath.toLowerCase();
          const nameLower = file.name.toLowerCase();
          return pathLower.includes(fileSearchText) || nameLower.includes(fileSearchText);
        })
        .sort((a, b) => {
          const aNameMatch = a.name.toLowerCase().startsWith(fileSearchText);
          const bNameMatch = b.name.toLowerCase().startsWith(fileSearchText);
          if (aNameMatch && !bNameMatch) return -1;
          if (!aNameMatch && bNameMatch) return 1;
          return b.mtime - a.mtime;
        });

      for (const file of this.filteredContextFiles) {
        const relativePath = file.relativePath.replace(/\\/g, '/');
        this.filteredMentionItems.push({
          type: 'context-file',
          name: relativePath,
          absolutePath: file.path,
          contextRoot: file.contextRoot,
          folderName: this.activeContextFilter.folderName,
        });
      }

      const firstVaultItemIndex = this.filteredMentionItems.length;
      const vaultItemCount = this.appendVaultItems(searchLower);

      if (this.filteredContextFiles.length === 0 && vaultItemCount > 0) {
        this.selectedMentionIndex = firstVaultItemIndex;
      } else {
        this.selectedMentionIndex = 0;
      }

      this.renderMentionDropdown();
      return;
    }

    this.activeContextFilter = null;
    this.activeAgentFilter = false;

    if (this.mcpManager) {
      const mcpServers = this.mcpManager.getContextSavingServers();

      for (const server of mcpServers) {
        if (server.name.toLowerCase().includes(searchLower)) {
          this.filteredMentionItems.push({
            type: 'mcp-server',
            name: server.name,
          });
        }
      }
    }

    if (this.agentService) {
      const hasAgents = this.agentService.searchAgents('').length > 0;
      if (hasAgents && 'agents'.includes(searchLower)) {
        this.filteredMentionItems.push({
          type: 'agent-folder',
          name: 'Agents',
        });
      }
    }

    if (contextEntries.length > 0) {
      const matchingFolders = new Set<string>();
      for (const entry of contextEntries) {
        if (entry.displayNameLower.includes(searchLower) && !matchingFolders.has(entry.displayName)) {
          matchingFolders.add(entry.displayName);
          this.filteredMentionItems.push({
            type: 'context-folder',
            name: entry.displayName,
            contextRoot: entry.contextRoot,
            folderName: entry.displayName,
          });
        }
      }
    }

    const firstVaultItemIndex = this.filteredMentionItems.length;
    const vaultItemCount = this.appendVaultItems(searchLower);

    this.selectedMentionIndex = vaultItemCount > 0 ? firstVaultItemIndex : 0;

    this.renderMentionDropdown();
  }

  private appendVaultItems(searchLower: string): number {
    type ScoredItem =
      | { type: 'folder'; name: string; path: string; score: number; structureKey: string; depth: number; mtime: number }
      | {
        type: 'file';
        name: string;
        path: string;
        file: TFile;
        title: string;
        matchDetail?: string;
        searchable: string;
        score: number;
        structureKey: string;
        depth: number;
        mtime: number;
      };

    const compare = (a: ScoredItem, b: ScoredItem): number => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.structureKey !== b.structureKey) {
        return a.structureKey.localeCompare(b.structureKey, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      }
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      if (a.depth !== b.depth) return a.depth - b.depth;
      if (a.mtime !== b.mtime) return b.mtime - a.mtime;
      return a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' });
    };

    const search = normalizeVaultSearch(searchLower);
    const terms = splitSearchTerms(search);
    const allFiles = this.callbacks.getCachedVaultFiles()
      .filter(f => !isHiddenVaultPath(f.path));

    // Derive folder mtime from the most recently modified file within each folder
    const folderMtimeMap = new Map<string, number>();
    for (const f of allFiles) {
      const parts = f.path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const folderPath = parts.slice(0, i).join('/');
        const existing = folderMtimeMap.get(folderPath) ?? 0;
        if (f.stat.mtime > existing) {
          folderMtimeMap.set(folderPath, f.stat.mtime);
        }
      }
    }

    const scoredFolders: ScoredItem[] = this.callbacks.getCachedVaultFolders()
      .map(f => ({
        name: f.name,
        path: f.path.replace(/\\/g, '/').replace(/\/+$/, ''),
      }))
      .filter(f =>
        f.path.length > 0 &&
        !isHiddenVaultPath(f.path) &&
        matchesVaultSearch(terms, [f.name, f.path])
      )
      .map(f => ({
        type: 'folder' as const,
        name: f.name,
        path: f.path,
        score: scoreVaultMatch(search, f.name, f.path, []),
        structureKey: folderStructureKey(f.path),
        depth: getVaultPathDepth(f.path),
        mtime: folderMtimeMap.get(f.path) ?? 0,
      }))
      .sort(compare);

    const scoredFiles: ScoredItem[] = allFiles
      .map(f => {
        const title = getFileTitle(f);
        const extraTokens = this.callbacks.getVaultFileSearchTokens?.(f) ?? [];
        const searchable = [
          title,
          f.name,
          f.path,
          ...extraTokens,
        ].join('\n').toLowerCase();
        const score = scoreVaultMatch(search, title, f.path, extraTokens);
        const matchDetail = resolveFileMatchDetail(search, title, f.path, extraTokens);
        return {
          type: 'file' as const,
          name: f.name,
          path: f.path,
          file: f,
          title,
          matchDetail,
          searchable,
          score,
          structureKey: fileStructureKey(f.path),
          depth: getVaultPathDepth(f.path),
          mtime: f.stat.mtime,
        };
      })
      .filter(f => matchesVaultSearch(terms, [f.searchable]))
      .sort(compare);

    const merged = [...scoredFolders.slice(0, 80), ...scoredFiles.slice(0, 160)]
      .sort(compare)
      .slice(0, 160);

    for (const item of merged) {
      if (item.type === 'folder') {
        this.filteredMentionItems.push({ type: 'folder', name: item.name, path: item.path });
      } else {
        this.filteredMentionItems.push({
          type: 'file',
          name: item.name,
          path: item.path,
          file: item.file,
          title: item.title,
          matchDetail: item.matchDetail,
        });
      }
    }

    return merged.length;
  }

  private renderMentionDropdown(): void {
    this.dropdown.render({
      items: this.filteredMentionItems,
      selectedIndex: this.selectedMentionIndex,
      emptyText: 'No matches',
      getItemClass: (item) => {
        switch (item.type) {
          case 'mcp-server': return 'mcp-server';
          case 'folder': return 'vault-folder';
          case 'agent': return 'agent';
          case 'agent-folder': return 'agent-folder';
          case 'context-file': return 'context-file';
          case 'context-folder': return 'context-folder';
          default: return undefined;
        }
      },
      renderItem: (item, itemEl) => {
        const iconEl = itemEl.createSpan({ cls: 'claudian-mention-icon' });
        switch (item.type) {
          case 'mcp-server':
            appendMcpIcon(iconEl);
            break;
          case 'agent':
          case 'agent-folder':
            setIcon(iconEl, 'bot');
            break;
          case 'context-file':
            setIcon(iconEl, 'folder-open');
            break;
          case 'folder':
          case 'context-folder':
            setIcon(iconEl, 'folder');
            break;
          default:
            setIcon(iconEl, 'file-text');
        }

        const textEl = itemEl.createSpan({ cls: 'claudian-mention-text' });

        switch (item.type) {
          case 'mcp-server':
            textEl.createSpan({ cls: 'claudian-mention-name' }).setText(`@${item.name}`);
            break;
          case 'agent-folder':
            textEl.createSpan({
              cls: 'claudian-mention-name claudian-mention-name-agent-folder',
            }).setText(`@${item.name}/`);
            break;
          case 'agent': {
            // Show ID (which is namespaced for plugin agents) for consistency with inserted text
            textEl.createSpan({
              cls: 'claudian-mention-name claudian-mention-name-agent',
            }).setText(`@${item.id}`);
            if (item.description) {
              textEl.createSpan({ cls: 'claudian-mention-agent-desc' }).setText(item.description);
            }
            break;
          }
          case 'context-folder':
            textEl.createSpan({
              cls: 'claudian-mention-name claudian-mention-name-folder',
            }).setText(`@${item.name}/`);
            break;
          case 'context-file':
            textEl.createSpan({
              cls: 'claudian-mention-name claudian-mention-name-context',
            }).setText(item.name);
            break;
          case 'folder':
            textEl.createSpan({
              cls: 'claudian-mention-name claudian-mention-name-folder',
            }).setText(`@${item.path}/`);
            break;
          case 'file':
            textEl.createSpan({ cls: 'claudian-mention-title' }).setText(item.title ?? item.name);
            textEl.createSpan({ cls: 'claudian-mention-path' }).setText(item.path || item.name);
            if (item.matchDetail) {
              textEl.createSpan({ cls: 'claudian-mention-desc' }).setText(item.matchDetail);
            }
            break;
        }
      },
      onItemClick: (item, index, e) => {
        // Stop propagation for folder items to prevent document click handler
        // from hiding dropdown (since dropdown is re-rendered with new DOM)
        if (item.type === 'context-folder' || item.type === 'agent-folder') {
          e.stopPropagation();
        }
        this.selectedMentionIndex = index;
        this.selectMentionItem();
      },
      onItemHover: (_item, index) => {
        this.selectedMentionIndex = index;
      },
    });

    if (this.fixed) {
      this.positionFixed();
    }
  }

  private positionFixed(): void {
    const dropdownEl = this.dropdown.getElement();
    if (!dropdownEl) return;

    const inputRect = this.inputEl.getBoundingClientRect();
    dropdownEl.setCssProps({
      '--claudian-fixed-dropdown-bottom': `${window.innerHeight - inputRect.top + 4}px`,
      '--claudian-fixed-dropdown-left': `${inputRect.left}px`,
      '--claudian-fixed-dropdown-width': `${Math.max(inputRect.width, 280)}px`,
    });
  }

  private insertReplacement(beforeAt: string, replacement: string, afterCursor: string): void {
    this.inputEl.value = beforeAt + replacement + afterCursor;
    this.inputEl.selectionStart = this.inputEl.selectionEnd = beforeAt.length + replacement.length;
  }

  private returnToFirstLevel(): void {
    const text = this.inputEl.value;
    const beforeAt = text.substring(0, this.mentionStartIndex);
    const cursorPos = this.inputEl.selectionStart || 0;
    const afterCursor = text.substring(cursorPos);

    this.inputEl.value = beforeAt + '@' + afterCursor;
    this.inputEl.selectionStart = this.inputEl.selectionEnd = beforeAt.length + 1;

    this.activeContextFilter = null;
    this.activeAgentFilter = false;

    this.showMentionDropdown('');
  }

  private selectMentionItem(): void {
    if (this.filteredMentionItems.length === 0) return;

    const selectedIndex = this.dropdown.getSelectedIndex();
    this.selectedMentionIndex = selectedIndex;
    const selectedItem = this.filteredMentionItems[selectedIndex];
    if (!selectedItem) return;

    const text = this.inputEl.value;
    const beforeAt = text.substring(0, this.mentionStartIndex);
    const cursorPos = this.inputEl.selectionStart || 0;
    const afterCursor = text.substring(cursorPos);

    switch (selectedItem.type) {
      case 'mcp-server': {
        const replacement = `@${selectedItem.name} `;
        this.insertReplacement(beforeAt, replacement, afterCursor);
        this.callbacks.addMentionedMcpServer(selectedItem.name);
        this.callbacks.onMcpMentionChange?.(this.callbacks.getMentionedMcpServers());
        break;
      }
      case 'agent-folder':
        // Don't modify input text - just show agents submenu
        this.activeAgentFilter = true;
        this.inputEl.focus();
        this.showMentionDropdown('Agents/');
        return;
      case 'agent': {
        const replacement = `@${selectedItem.id} (agent) `;
        this.insertReplacement(beforeAt, replacement, afterCursor);
        this.callbacks.onAgentMentionSelect?.(selectedItem.id);
        break;
      }
      case 'context-folder': {
        const replacement = `@${selectedItem.name}/`;
        this.insertReplacement(beforeAt, replacement, afterCursor);
        this.inputEl.focus();
        this.handleInputChange();
        return;
      }
      case 'context-file': {
        // Display friendly name in input; absolute path resolution happens at send time.
        const displayName = selectedItem.folderName
          ? `@${selectedItem.folderName}/${selectedItem.name}`
          : `@${selectedItem.name}`;
        if (selectedItem.absolutePath) {
          this.callbacks.onAttachFile(selectedItem.absolutePath);
        }
        this.insertReplacement(beforeAt, `${displayName} `, afterCursor);
        break;
      }
      case 'folder': {
        const normalizedPath = this.callbacks.normalizePathForVault(selectedItem.path);
        this.insertReplacement(beforeAt, `@${normalizedPath ?? selectedItem.path}/ `, afterCursor);
        break;
      }
      default: {
        const rawPath = selectedItem.file?.path ?? selectedItem.path;
        const normalizedPath = this.callbacks.normalizePathForVault(rawPath);
        if (normalizedPath) {
          this.callbacks.onAttachFile(normalizedPath);
        }
        this.insertReplacement(beforeAt, `@${normalizedPath ?? selectedItem.name} `, afterCursor);
        break;
      }
    }

    this.hide();
    this.inputEl.focus();
  }
}

function getFileTitle(file: TFile): string {
  const maybeBasename = (file as TFile & { basename?: string }).basename;
  if (maybeBasename) {
    return maybeBasename;
  }
  return file.name.replace(/\.[^/.]+$/, '');
}

function normalizeVaultSearch(searchText: string): string {
  return searchText.replace(/\\/g, '/').trim().toLowerCase();
}

function splitSearchTerms(searchText: string): string[] {
  return searchText.split(/\s+/).map(term => term.trim()).filter(Boolean);
}

function matchesVaultSearch(terms: string[], values: string[]): boolean {
  if (terms.length === 0) {
    return true;
  }
  const searchable = values.join('\n').replace(/\\/g, '/').toLowerCase();
  return terms.every(term => searchable.includes(term));
}

function isHiddenVaultPath(path: string): boolean {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .some(segment => segment.startsWith('.'));
}

function getVaultPathDepth(path: string): number {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).length;
}

function folderStructureKey(path: string): string {
  return `${path.replace(/\\/g, '/').replace(/\/+$/, '')}/`;
}

function fileStructureKey(path: string): string {
  return path.replace(/\\/g, '/');
}

function pathSegmentStartsWith(path: string, searchText: string): boolean {
  if (!searchText) {
    return false;
  }
  return path
    .replace(/\\/g, '/')
    .toLowerCase()
    .split('/')
    .some(segment => segment.startsWith(searchText));
}

function scoreVaultMatch(
  searchText: string,
  title: string,
  path: string,
  extraTokens: string[],
): number {
  if (!searchText) {
    return 0;
  }

  const titleLower = title.toLowerCase();
  const pathLower = path.replace(/\\/g, '/').toLowerCase();
  const fileNameLower = pathLower.split('/').pop() ?? pathLower;
  const extraLower = extraTokens.join('\n').toLowerCase();
  let score = 1;

  if (titleLower === searchText || fileNameLower === searchText) score += 120;
  if (pathLower === searchText) score += 115;
  if (titleLower.startsWith(searchText)) score += 90;
  if (fileNameLower.startsWith(searchText)) score += 85;
  if (pathLower.startsWith(searchText)) score += 80;
  if (pathSegmentStartsWith(pathLower, searchText)) score += 65;
  if (searchText.includes('/') && pathLower.includes(searchText)) score += 55;
  if (titleLower.includes(searchText)) score += 35;
  if (pathLower.includes(searchText)) score += 30;
  if (extraLower.includes(searchText)) score += 20;

  return score;
}

function resolveFileMatchDetail(
  searchLower: string,
  title: string,
  path: string,
  extraTokens: string[],
): string | undefined {
  if (!searchLower) {
    return path;
  }
  if (title.toLowerCase().includes(searchLower) || path.toLowerCase().includes(searchLower)) {
    return path;
  }
  const hit = extraTokens.find(value => value.toLowerCase().includes(searchLower));
  return hit ? `Matched: ${hit}` : path;
}
