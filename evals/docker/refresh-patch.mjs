// Runs inside a container (or a test), never as the runner's own process: moves one task's
// reference.patch onto the current starter. Git does the merge in a scratch repository: the old
// starter (from a git ref), the reference on top, then the new starter, and a cherry-pick of the
// reference onto it. Prints one JSON line: { outcome, patch }.
//
// Argument: JSON { repo, ref, starterDirs, patch }, with starterDirs and patch relative to repo.
// The repository, .git included, can be mounted read-only.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';

const { repo, ref, starterDirs, patch: patchPath } = JSON.parse(process.argv[2] ?? '{}');
const IDENTITY = ['-c', 'user.name=theoldman', '-c', 'user.email=refresh@theoldman.invalid'];
// The repository is mounted from the host and owned by another user, which git refuses by default.
// Files copied from a Windows mount look executable, so file modes are ignored, as on Windows.
const SAFE = ['-c', 'safe.directory=*', '-c', 'core.autocrlf=false', '-c', 'core.fileMode=false'];

function git(cwd, args, input) {
  return execFileSync('git', [...SAFE, ...args], {
    cwd,
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function commitAll(cwd, message) {
  git(cwd, ['add', '-A']);
  git(cwd, [...IDENTITY, 'commit', '-q', '--allow-empty', '-m', message]);
  return git(cwd, ['rev-parse', 'HEAD']).trim();
}

function done(outcome, patch) {
  process.stdout.write(
    `${JSON.stringify(patch === undefined ? { outcome } : { outcome, patch })}\n`,
  );
}

const patch = readFileSync(join(repo, patchPath), 'utf8');
const work = mkdtempSync(join(tmpdir(), 'refresh-'));
try {
  git(work, ['init', '-q']);
  // The starter as it was at the ref, its folders copied over each other in order.
  for (const dir of starterDirs) {
    const files = git(repo, ['ls-tree', '-r', '-z', '--name-only', ref, '--', dir])
      .split('\0')
      .filter((file) => file !== '');
    for (const file of files) {
      const out = join(work, file.slice(dir.length + 1));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(
        out,
        execFileSync('git', [...SAFE, 'show', `${ref}:${file}`], {
          cwd: repo,
          maxBuffer: 64 * 1024 * 1024,
        }),
      );
    }
  }
  const old = commitAll(work, 'old starter');
  git(work, ['apply', '--index', '--whitespace=nowarn'], patch);
  const reference = commitAll(work, 'reference');

  git(work, ['checkout', '-q', '-b', 'refresh', old]);
  git(work, ['rm', '-r', '-q', '--cached', '.']);
  for (const file of git(work, ['ls-files', '-z', '--others']).split('\0')) {
    if (file !== '') rmSync(join(work, file), { force: true });
  }
  for (const dir of starterDirs) cpSync(join(repo, dir), work, { recursive: true });
  const current = commitAll(work, 'new starter');

  let merged = true;
  try {
    git(work, [...IDENTITY, 'cherry-pick', reference]);
  } catch {
    merged = false;
  }
  if (!merged) done('conflict');
  else {
    const refreshed = git(work, ['diff', '--binary', current, 'HEAD']);
    if (refreshed === patch) done('unchanged');
    else done('updated', refreshed);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
