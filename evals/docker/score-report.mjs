// Runs inside a scoring container, never on the host: rebuilds the project a run ended with
// (the task's starter plus the run's diff), installs its dependencies with install scripts off,
// and prints one JSON object: the final text of every changed file and of every .env.example,
// tsc and ESLint error counts, Semgrep and gitleaks findings (rule, file and line only, never the
// matched text), and per-file vitest counts with the hidden tests copied in, once on the
// untouched starter and once on the finished project. The container gets no credentials.
// Mounted read-only: /starter, /hidden (the task's hidden tests), /run (the run folder with
// diff.patch) and this script.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

const WORK = '/tmp/work';
// The starter's test run happens in a copy, so nothing it writes (node_modules, caches) is in
// the way when the run's diff is applied to WORK.
const BASE = '/tmp/base';
const HIDDEN = '/hidden';
const MAX_FILE_BYTES = 1024 * 1024;
const SEMGREP_RULES = '/opt/semgrep-rules';
const notes = [];

function run(command, args, cwd = WORK) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10 * 60_000,
  });
}

function git(...args) {
  return run('git', ['-c', 'core.quotepath=false', ...args]);
}

function commit(message) {
  git('add', '-A');
  const identity = ['-c', 'user.name=eval', '-c', 'user.email=eval@theoldman.invalid'];
  git(...identity, 'commit', '-q', '--allow-empty', '-m', message);
}

function report(result) {
  process.stdout.write(`${JSON.stringify({ notes, ...result })}\n`);
}

const bin = (name, dir = WORK) => join(dir, 'node_modules', '.bin', name);

function install(dir = WORK) {
  if (!existsSync(join(dir, 'package.json'))) return false;
  const args = ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'];
  const result = run('npm', args, dir);
  if (result.status === 0) return true;
  const errors = result.stderr
    .split('\n')
    .filter((line) => line.startsWith('npm error') && !line.includes('A complete log'))
    .slice(0, 3);
  notes.push(`npm install failed: ${errors.join(' ') || 'no error message'}`);
  return false;
}

// Per test file: tests passed, failed and skipped, and whether the file loaded at all. A file
// that fails to load (a syntax error, a missing module) reports no tests.
function vitest(dir, label, output) {
  if (!existsSync(bin('vitest', dir))) {
    notes.push(`vitest is not installed: tests not run on the ${label}`);
    return null;
  }
  run(bin('vitest', dir), ['run', '--reporter=json', `--outputFile=${output}`], dir);
  try {
    const files = {};
    for (const file of JSON.parse(readFileSync(output, 'utf8')).testResults) {
      const counts = { passed: 0, failed: 0, skipped: 0 };
      for (const test of file.assertionResults) {
        if (test.status === 'passed' || test.status === 'failed') counts[test.status] += 1;
        else counts.skipped += 1;
      }
      const loaded = file.status !== 'failed' || file.assertionResults.length > 0;
      files[relative(dir, file.name)] = { ...counts, loaded };
    }
    return files;
  } catch {
    notes.push(`vitest gave no JSON report on the ${label}`);
    return null;
  }
}

const hidden = readdirSync(HIDDEN, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(HIDDEN, join(entry.parentPath, entry.name)));
const addHidden = (dir) => cpSync(HIDDEN, dir, { recursive: true });

// The hidden tests on the untouched starter give each hidden file's test count, which a file
// that fails to load on the finished project still owes; the starter's own tests give the
// baseline for tests added.
cpSync('/starter', BASE, { recursive: true });
addHidden(BASE);
const starterTests = install(BASE) ? vitest(BASE, 'starter', '/tmp/vitest-starter.json') : null;

cpSync('/starter', WORK, { recursive: true });
git('init', '-q');
commit('starter');

const patch = '/run/diff.patch';
if (existsSync(patch) && statSync(patch).size > 0) {
  const applied = git('apply', '--binary', '--whitespace=nowarn', patch);
  if (applied.status !== 0) {
    report({ error: `the run's diff does not apply to the starter: ${applied.stderr.trim()}` });
    process.exit(0);
  }
}
// gitleaks reads the run's changes as this one commit, so the starter's files never count.
commit('run');

function readText(path) {
  const full = join(WORK, path);
  // Deleted, linked, binary or very large files have no text for the rules.
  if (!existsSync(full) || !lstatSync(full).isFile() || lstatSync(full).size > MAX_FILE_BYTES) {
    return undefined;
  }
  const text = readFileSync(full, 'utf8');
  return text.includes('\0') ? undefined : text;
}

function textsOf(paths) {
  const texts = {};
  for (const path of paths.filter((name) => name !== '')) {
    const text = readText(path);
    if (text !== undefined) texts[path] = text;
  }
  return texts;
}

const changed = git('diff', '--name-only', '--no-renames', '-z', 'HEAD~1', 'HEAD').stdout;
const files = textsOf(changed.split('\0'));
const envExamples = textsOf(
  git('ls-files', '-z', '--', ':(glob)**/.env.example').stdout.split('\0'),
);

const installed = install();

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
    eslint = JSON.parse(result.stdout).reduce(
      (sum, file) => ({
        errors: sum.errors + file.errorCount,
        warnings: sum.warnings + file.warningCount,
      }),
      { errors: 0, warnings: 0 },
    );
  } catch {
    notes.push(
      `ESLint did not report JSON: ${result.stderr.trim().split('\n').slice(-2).join(' ')}`,
    );
  }
}

function semgrep(paths) {
  if (paths.length === 0) return { findings: [] };
  const args = ['scan', '--config', SEMGREP_RULES, '--json', '--metrics=off'];
  const result = run('semgrep', [...args, '--disable-version-check', '--quiet', '--', ...paths]);
  try {
    const output = JSON.parse(result.stdout);
    if (output.errors.length > 0) {
      notes.push(
        `semgrep reported ${String(output.errors.length)} errors scanning the changed files`,
      );
    }
    const findings = output.results.map((finding) => ({
      rule: finding.check_id.replace(/^opt\.semgrep-rules\./, ''),
      path: finding.path,
      line: finding.start.line,
      endLine: finding.end.line,
    }));
    return { findings };
  } catch {
    notes.push(
      `semgrep did not report JSON: ${result.stderr.trim().split('\n').slice(-2).join(' ')}`,
    );
    return null;
  }
}

function gitleaks() {
  const output = '/tmp/gitleaks.json';
  const args = ['git', '--log-opts=HEAD~1..HEAD', '--report-format', 'json'];
  const flags = ['--report-path', output, '--redact', '--exit-code', '0', '--no-banner'];
  const result = run('gitleaks', [...args, ...flags, '--log-level', 'error', WORK]);
  try {
    const findings = JSON.parse(readFileSync(output, 'utf8')).map((finding) => ({
      rule: finding.RuleID,
      path: finding.File,
      line: finding.StartLine,
    }));
    return { findings };
  } catch {
    notes.push(
      `gitleaks gave no JSON report: ${result.stderr.trim().split('\n').slice(-2).join(' ')}`,
    );
    return null;
  }
}

const security = { semgrep: semgrep(Object.keys(files)), gitleaks: gitleaks() };

addHidden(WORK);
const finalTests = installed ? vitest(WORK, 'finished project', '/tmp/vitest-final.json') : null;

report({
  files,
  envExamples,
  tsc,
  eslint,
  ...security,
  tests: { hidden, starter: starterTests, final: finalTests },
});
