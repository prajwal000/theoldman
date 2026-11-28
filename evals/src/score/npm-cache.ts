// A shared npm cache for scoring, so each scoring container does not download every dependency
// again. A trusted container fills it from the starters alone (no run's code) before scoring;
// scoring containers get it read-only and copy it in, so code a run left behind can never write to
// the cache another run will install from.

import { type DockerExec } from '../docker.ts';
import { ConfigError } from '../errors.ts';
import { SCORE_IMAGE } from '../images.ts';
import { OWNER_LABEL } from '../orphans.ts';

export const NPM_CACHE_VOLUME = 'theoldman-evals-npm-cache';

const volume = (target: string, readonly = false): string[] => [
  '--mount',
  `type=volume,source=${NPM_CACHE_VOLUME},target=${target}${readonly ? ',readonly' : ''}`,
];

/** The read-only mount scoring containers get, at /npm-cache. */
export const npmCacheMount = (): string[] => volume('/npm-cache', true);

const WARM = [
  'set -e',
  'mkdir /tmp/w',
  'for d in $(ls /starters | sort -n); do cp -r "/starters/$d/." /tmp/w; done',
  'cd /tmp/w',
  'npm install --ignore-scripts --no-audit --no-fund --loglevel=error --prefer-offline --cache /cache',
].join('\n');

/**
 * Fills the cache with the dependencies of each starter (a list of starter folder lists, as tasks
 * have them). A failure only leaves the cache cold, so it is reported, not thrown.
 */
export async function warmNpmCache(
  docker: DockerExec,
  starters: readonly (readonly string[])[],
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<string[]> {
  const options = (timeoutMs: number) =>
    signal === undefined ? { env, timeoutMs } : { env, timeoutMs, signal };
  const problems: string[] = [];
  const label = ['--label', `${OWNER_LABEL}=${String(process.pid)}`];
  // A new volume belongs to root; the scoring image runs as node.
  const chown = await docker(
    [
      'run',
      '--rm',
      ...label,
      '--user',
      'root',
      ...volume('/cache'),
      '--entrypoint',
      'chown',
      SCORE_IMAGE,
      'node:node',
      '/cache',
    ],
    options(5 * 60_000),
  );
  if (chown.code !== 0)
    return [`the npm cache volume could not be prepared: ${chown.stderr.trim()}`];

  const seen = new Set<string>();
  for (const dirs of starters) {
    const key = JSON.stringify(dirs);
    if (seen.has(key)) continue;
    seen.add(key);
    const mounts = dirs.flatMap((dir, index) => {
      // --mount separates its fields with commas, so a path with one would be misread.
      if (dir.includes(',')) throw new ConfigError(`Cannot mount a path with a comma: ${dir}`);
      return ['--mount', `type=bind,source=${dir},target=/starters/${String(index)},readonly`];
    });
    const warm = await docker(
      [
        'run',
        '--rm',
        ...label,
        ...volume('/cache'),
        ...mounts,
        '--entrypoint',
        'sh',
        SCORE_IMAGE,
        '-c',
        WARM,
      ],
      options(20 * 60_000),
    );
    if (warm.code !== 0) {
      problems.push(
        `the npm cache could not be filled for ${dirs.join(' + ')}; scoring will download dependencies`,
      );
    }
  }
  return problems;
}
