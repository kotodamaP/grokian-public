#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { dirname } from 'node:path';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const REQUIRED_FILES = ['manifest.json', 'main.js', 'styles.css'];

function usage() {
  return [
    'Usage:',
    '  npm run install:obsidian -- --vault <path-to-vault>',
    '  npm run install:obsidian -- --plugin-dir <path-to-vault/.obsidian/plugins/grokian>',
    '',
    'Options:',
    '  --vault <path>       Existing Obsidian vault path.',
    '  --plugin-dir <path>  Explicit target plugin directory. Must end in the manifest id.',
    '  --skip-build         Copy existing build artifacts without running npm run build.',
    '  --dry-run            Print the target and checks without copying files.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    pluginDir: '',
    skipBuild: false,
    vault: '',
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--skip-build') {
      args.skipBuild = true;
      continue;
    }
    if (arg === '--vault') {
      args.vault = argv[++index] ?? '';
      continue;
    }
    if (arg === '--plugin-dir') {
      args.pluginDir = argv[++index] ?? '';
      continue;
    }
    throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
  }

  return args;
}

function readLocalEnv() {
  const envPath = path.join(ROOT, '.env.local');
  if (!existsSync(envPath)) {
    return {};
  }

  const env = {};
  const contents = readFileSync(envPath, 'utf8');
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const match = /^([^=]+)=["']?(.+?)["']?$/.exec(line);
    if (match) {
      env[match[1].trim()] = match[2].trim();
    }
  }
  return env;
}

function resolveMaybeRelative(value) {
  if (!value) {
    return '';
  }
  if (value.startsWith('~')) {
    return path.join(process.env.HOME || process.env.USERPROFILE || '', value.slice(1));
  }
  return path.resolve(value);
}

function readManifest(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function buildNpmInvocation(args) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return {
      args: [npmExecPath, ...args],
      command: process.execPath,
    };
  }

  return {
    args,
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
  };
}

function runBuild() {
  const invocation = buildNpmInvocation(['run', 'build']);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: ROOT,
    shell: false,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Build failed with exit code ${result.status ?? 1}.`);
  }
}

function resolveTargetDir(args, pluginId) {
  if (args.pluginDir) {
    return path.resolve(args.pluginDir);
  }

  const localEnv = readLocalEnv();
  const vaultPath = args.vault || process.env.OBSIDIAN_VAULT || localEnv.OBSIDIAN_VAULT;
  if (!vaultPath) {
    throw new Error(`Missing Obsidian vault path.\n\n${usage()}`);
  }

  const vault = resolveMaybeRelative(vaultPath);
  if (!existsSync(vault) || !statSync(vault).isDirectory()) {
    throw new Error('Obsidian vault path does not exist or is not a directory.');
  }

  const obsidianDir = path.join(vault, '.obsidian');
  if (!existsSync(obsidianDir) || !statSync(obsidianDir).isDirectory()) {
    throw new Error('Target vault does not contain an .obsidian directory.');
  }

  return path.join(obsidianDir, 'plugins', pluginId);
}

function assertSafePluginTarget(targetDir, pluginId) {
  if (path.basename(targetDir) !== pluginId) {
    throw new Error(`Refusing to install ${pluginId} into a directory not named "${pluginId}".`);
  }

  const existingManifest = path.join(targetDir, 'manifest.json');
  if (!existsSync(existingManifest)) {
    return;
  }

  const existing = readManifest(existingManifest);
  if (existing.id && existing.id !== pluginId) {
    throw new Error(`Refusing to overwrite existing Obsidian plugin "${existing.id}".`);
  }
}

function assertBuildArtifacts() {
  const missing = REQUIRED_FILES.filter(file => !existsSync(path.join(ROOT, file)));
  if (missing.length > 0) {
    throw new Error(`Missing build artifact(s): ${missing.join(', ')}.`);
  }
}

function copyArtifacts(targetDir) {
  mkdirSync(targetDir, { recursive: true });
  for (const file of REQUIRED_FILES) {
    copyFileSync(path.join(ROOT, file), path.join(targetDir, file));
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = readManifest(path.join(ROOT, 'manifest.json'));
  const pluginId = manifest.id;
  if (!pluginId || pluginId === 'claudian') {
    throw new Error('Manifest id must be a non-Claudian plugin id before installation.');
  }

  const targetDir = resolveTargetDir(args, pluginId);
  assertSafePluginTarget(targetDir, pluginId);

  if (!args.skipBuild && !args.dryRun) {
    runBuild();
  }
  if (!args.dryRun) {
    assertBuildArtifacts();
    copyArtifacts(targetDir);
  }

  console.log(`${args.dryRun ? 'Would install' : 'Installed'} ${manifest.name} (${pluginId})`);
  console.log(`Target: ${targetDir}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
