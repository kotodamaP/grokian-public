#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const npmExecPath = process.env.npm_execpath;

function buildNpmInvocation(args) {
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

const STEPS = [
  {
    args: ['run', 'check:sensitive:staged'],
    label: 'sensitive staged content check',
  },
  {
    args: ['run', 'lint'],
    label: 'lint',
  },
  {
    args: ['run', 'typecheck'],
    label: 'typecheck',
  },
  {
    args: ['run', 'test'],
    label: 'Grokian test suite',
  },
  {
    args: ['run', 'build'],
    label: 'production build',
  },
];

for (const step of STEPS) {
  console.log(`\n==> ${step.label}`);
  const invocation = buildNpmInvocation(step.args);
  const result = spawnSync(invocation.command, invocation.args, {
    shell: false,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('\nMVP verification completed.');
