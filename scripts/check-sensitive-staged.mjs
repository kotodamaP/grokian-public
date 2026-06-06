#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const PATTERNS = [
  {
    name: 'secret-assignment',
    regex: /\b(api[_-]?key|token|secret|password|credential|cookie|oauth|authorization)\s*[:=]/i,
  },
  {
    name: 'known-env-assignment',
    regex: /(^|[\s"',{])(XAI_API_KEY|GROK_CODE_XAI_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN|GH_TOKEN)\s*[:=]/i,
  },
  {
    name: 'xai-token-shape',
    regex: /xai-[A-Za-z0-9_-]{12,}/,
  },
  {
    name: 'openai-token-shape',
    regex: /sk-[A-Za-z0-9_-]{16,}/,
  },
  {
    name: 'github-token-shape',
    regex: /gh[pousr]_[A-Za-z0-9_]{20,}/,
  },
  {
    name: 'windows-user-profile-path',
    regex: /C:[\\/]+Users[\\/]+[^\\/\s"'`]+/i,
  },
  {
    name: 'windows-user-profile-env-path',
    regex: /%USERPROFILE%[\\/]+/i,
  },
  {
    name: 'home-user-profile-path',
    regex: /\/Users\/[^/\s"'`]+/,
  },
];

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function stagedFiles() {
  const output = git(['diff', '--cached', '--name-only', '--diff-filter=ACMRT']);
  return output
    .split(/\r?\n/)
    .map(file => file.trim())
    .filter(Boolean);
}

function readStagedFile(file) {
  return git(['show', `:${file}`]);
}

function scanFile(file, content) {
  const findings = [];
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const pattern of PATTERNS) {
      if (pattern.regex.test(line)) {
        findings.push({
          file,
          line: index + 1,
          pattern: pattern.name,
        });
      }
    }
  }
  return findings;
}

const findings = [];

for (const file of stagedFiles()) {
  try {
    findings.push(...scanFile(file, readStagedFile(file)));
  } catch {
    findings.push({
      file,
      line: 0,
      pattern: 'unreadable-staged-file',
    });
  }
}

if (findings.length > 0) {
  console.error('Sensitive staged content check failed. Matched lines are not printed.');
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} pattern=${finding.pattern}`);
  }
  process.exit(2);
}

console.log('Sensitive staged content check passed.');
