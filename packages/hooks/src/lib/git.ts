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
