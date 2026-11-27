// Runs inside a scoring container, never on the host: rebuilds the project a run ended with
// (the task's starter plus the run's diff), installs its dependencies with install scripts off,
// runs tsc and ESLint, and prints one JSON object: the final text of every changed file and the
// error counts. The container gets no credentials. Mounted read-only: /starter, /run (the run
// folder with diff.patch) and this script.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const WORK = '/tmp/work';
const MAX_FILE_BYTES = 1024 * 1024;
const notes = [];

function run(command, args, timeoutMinutes = 10) {
  return spawnSync(command, args, {
    cwd: WORK,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMinutes * 60_000,
  });
}

function git(...args) {
  return run('git', ['-c', 'core.quotepath=false', ...args]);
}

function report(result) {
  process.stdout.write(`${JSON.stringify({ notes, ...result })}\n`);
}

cpSync('/starter', WORK, { recursive: true });
git('init', '-q');
git('add', '-A');
git(
  '-c',
  'user.name=eval',
  '-c',
  'user.email=eval@theoldman.invalid',
  'commit',
  '-q',
  '--allow-empty',
  '-m',
  'starter',
);

const patch = '/run/diff.patch';
if (existsSync(patch) && statSync(patch).size > 0) {
  const applied = git('apply', '--binary', '--whitespace=nowarn', patch);
  if (applied.status !== 0) {
    report({ error: `the run's diff does not apply to the starter: ${applied.stderr.trim()}` });
    process.exit(0);
  }
}

git('add', '-A');
const changed = git('diff', '--cached', '--name-only', '--no-renames', '-z').stdout.split('\0');
const files = {};
for (const path of changed.filter((name) => name !== '')) {
  const full = join(WORK, path);
  // Deleted, linked, binary or very large files have no text for the comment rules.
  if (!existsSync(full) || !lstatSync(full).isFile() || lstatSync(full).size > MAX_FILE_BYTES) {
    continue;
  }
  const text = readFileSync(full, 'utf8');
  if (!text.includes('\0')) files[path] = text;
}

const bin = (name) => join(WORK, 'node_modules', '.bin', name);
let installed = false;
if (existsSync(join(WORK, 'package.json'))) {
  const install = run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--loglevel=error',
  ]);
  installed = install.status === 0;
  if (!installed) {
    const errors = install.stderr
      .split('\n')
      .filter((line) => line.startsWith('npm error') && !line.includes('A complete log'))
      .slice(0, 3);
    notes.push(`npm install failed: ${errors.join(' ') || 'no error message'}`);
  }
}

// Prisma's client types exist only after `prisma generate`, so tsc needs it first.
if (installed && existsSync(join(WORK, 'prisma', 'schema.prisma')) && existsSync(bin('prisma'))) {
  const generate = run(bin('prisma'), ['generate']);
  if (generate.status !== 0) notes.push('prisma generate failed');
}

let tsc = null;
if (!existsSync(join(WORK, 'tsconfig.json'))) notes.push('no tsconfig.json: tsc not run');
else if (!existsSync(bin('tsc'))) notes.push('typescript is not installed: tsc not run');
else {
  const result = run(bin('tsc'), ['--noEmit', '-p', '.', '--pretty', 'false']);
  tsc = { errors: (result.stdout.match(/error TS\d+:/g) ?? []).length };
}

const ESLINT_CONFIGS = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
];
let eslint = null;
if (!ESLINT_CONFIGS.some((name) => existsSync(join(WORK, name)))) {
  notes.push('no eslint.config file: ESLint not run');
} else if (!existsSync(bin('eslint'))) notes.push('eslint is not installed: ESLint not run');
else {
  const result = run(bin('eslint'), ['.', '--format', 'json']);
  try {
    const counts = JSON.parse(result.stdout).reduce(
      (sum, file) => ({
        errors: sum.errors + file.errorCount,
        warnings: sum.warnings + file.warningCount,
      }),
      { errors: 0, warnings: 0 },
    );
    eslint = counts;
  } catch {
    notes.push(
      `ESLint did not report JSON: ${result.stderr.trim().split('\n').slice(-2).join(' ')}`,
    );
  }
}

report({ files, tsc, eslint });
