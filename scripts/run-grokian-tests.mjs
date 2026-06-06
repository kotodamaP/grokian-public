#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_TESTS = [
  'tests/unit/providers/acp/AcpClientConnection.test.ts',
  'tests/unit/core/providers/modelRouting.test.ts',
  'tests/unit/core/auxiliary/QueryBackedInlineEditService.test.ts',
  'tests/unit/core/story/StorySidecarStorage.test.ts',
  'tests/unit/features/chat/ui/ExternalContextSelector.test.ts',
  'tests/unit/features/inline-edit/ui/InlineEditModal.test.ts',
  'tests/unit/shared/mention/MentionDropdownController.test.ts',
  'tests/unit/providers/grok/commands/GrokStoryCommandCatalog.test.ts',
  'tests/unit/providers/grok/runtime/GrokChatRuntime.test.ts',
  'tests/unit/providers/grok/runtime/GrokCliResolver.test.ts',
  'tests/unit/providers/grok/runtime/GrokHeadlessQueryRunner.test.ts',
  'tests/unit/providers/grok/settings.test.ts',
  'tests/unit/providers/grok/ui/GrokChatUIConfig.test.ts',
];

const requestedArgs = process.argv.slice(2);
const hasExplicitTestPath = requestedArgs.some(arg => !arg.startsWith('-'));
const jestArgs = hasExplicitTestPath
  ? requestedArgs
  : [...requestedArgs, ...DEFAULT_TESTS];

const result = spawnSync(
  process.execPath,
  [path.join(__dirname, 'run-jest.js'), ...jestArgs],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
