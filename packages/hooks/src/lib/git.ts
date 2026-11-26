import { execFileSync } from 'node:child_process';
import { basename, dirname } from 'node:path';

const NETWORK_SUBCOMMANDS = new Set(['fetch', 'pull', 'push', 'clone', 'ls-remote', 'remote']);

// Repository config is untrusted: a cloned repo can set it. These override the settings that
// let read-only commands start programs (core.fsmonitor) or reach the network (lazy fetches
// in a partial clone, which protocol.allow=never blocks on every git version).
const SAFE_OPTIONS = ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never'];
const SAFE_ENV = { GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };

/**
 * Runs local git with hostile repo config neutralised and returns stdout. Throws if git fails.
 * Values from hook input must go after `--` or inside `<rev>:<path>`, never as an option.
 */
export function runGit(cwd: string, args: readonly string[]): string {
  const [subcommand = ''] = args;
  if (NETWORK_SUBCOMMANDS.has(subcommand)) {
    throw new Error(`git ${subcommand} reaches the network and is not allowed`);
  }
  return execFileSync('git', [...SAFE_OPTIONS, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...SAFE_ENV },
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 2000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
}

const REMOTE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

function symbolicRef(cwd: string, ref: string): string | undefined {
  try {
    return runGit(cwd, ['symbolic-ref', '--quiet', '--short', ref]).trim() || undefined;
  } catch {
    // Not a repo, detached HEAD, or no such ref: there is no branch name to report.
    return undefined;
  }
}

/** The checked-out branch, or undefined outside a repo or with a detached HEAD. */
export function currentBranch(cwd: string): string | undefined {
  return symbolicRef(cwd, 'HEAD');
}

/** The remote's default branch as last recorded locally (`refs/remotes/<remote>/HEAD`). */
export function defaultBranch(cwd: string, remote: string): string | undefined {
  if (!REMOTE_NAME.test(remote) || remote.includes('..')) return undefined;
  return symbolicRef(cwd, `refs/remotes/${remote}/HEAD`)?.replace(`${remote}/`, '');
}

const COMMIT_HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

function commitOf(cwd: string, rev: string): string | undefined {
  try {
    const hash = runGit(cwd, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]).trim();
    return COMMIT_HASH.test(hash) ? hash : undefined;
  } catch {
    // No such branch or no commits yet.
    return undefined;
  }
}

/**
 * Where the current branch left the default branch: the merge base of HEAD with the remote's
 * default branch, else with origin/main, origin/master, main or master. Undefined when there
 * are no commits or none of those branches exist.
 */
export function branchBase(
  cwd: string,
): { readonly commit: string; readonly branch: string } | undefined {
  const head = commitOf(cwd, 'HEAD');
  if (head === undefined) return undefined;
  const remoteDefault = defaultBranch(cwd, 'origin');
  const candidates = [
    remoteDefault === undefined ? [] : [`origin/${remoteDefault}`],
    ['origin/main', 'origin/master', 'main', 'master'],
  ].flat();
  for (const branch of candidates) {
    const tip = commitOf(cwd, branch);
    if (tip === undefined) continue;
    let commit: string;
    try {
      commit = runGit(cwd, ['merge-base', head, tip]).trim();
    } catch {
      // Unrelated histories have no merge base; try the next candidate.
      continue;
    }
    if (COMMIT_HASH.test(commit)) return { commit, branch };
  }
  return undefined;
}

/**
 * The file's committed content at HEAD, or undefined when it has none: outside a repo, no
 * commits yet, untracked or only staged, or git is unavailable.
 */
export function readHeadVersion(filePath: string): string | undefined {
  try {
    // `./` makes the path relative to cwd, so no repo-root lookup or path-case matching is needed.
    // cat-file is plumbing: it applies no textconv or filter drivers from repo config.
    return runGit(dirname(filePath), ['cat-file', 'blob', `HEAD:./${basename(filePath)}`]);
  } catch {
    // Every failure means "no committed version"; the caller then treats all lines as added.
    return undefined;
  }
}
