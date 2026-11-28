import { describe, expect, it } from 'vitest';
import type { DockerExec } from '../src/docker.ts';
import { ConfigError } from '../src/errors.ts';
import { NPM_CACHE_VOLUME, warmNpmCache } from '../src/score/npm-cache.ts';

function fakeDocker(failWarm = false) {
  const calls: string[][] = [];
  const docker: DockerExec = (args) => {
    calls.push([...args]);
    const warming = args.includes('sh');
    return Promise.resolve({
      code: warming && failWarm ? 1 : 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    });
  };
  return { docker, calls };
}

describe('warmNpmCache', () => {
  it('hands the volume to the node user, then fills it once per distinct starter', async () => {
    const { docker, calls } = fakeDocker();
    const shop = ['C:\\evals\\starters\\shop'];
    const withOverlay = ['C:\\evals\\starters\\shop', 'C:\\evals\\tasks\\bug\\starter'];
    expect(await warmNpmCache(docker, [shop, withOverlay, shop], {})).toEqual([]);

    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain('--user');
    expect(calls[0]).toContain(`type=volume,source=${NPM_CACHE_VOLUME},target=/cache`);
    expect(calls[0]?.slice(-2)).toEqual(['node:node', '/cache']);
    // Filling the cache mounts it writable, but only the starters, never a run's files.
    expect(calls[2]).toContain(
      'type=bind,source=C:\\evals\\tasks\\bug\\starter,target=/starters/1,readonly',
    );
    expect(calls[2]?.join(' ')).not.toContain('/run');
    for (const call of calls)
      expect(call.join(' ')).toContain(`theoldman.owner=${String(process.pid)}`);
  });

  it('reports a failure instead of stopping the scoring', async () => {
    const { docker } = fakeDocker(true);
    const problems = await warmNpmCache(docker, [['C:\\evals\\starters\\shop']], {});
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/scoring will download dependencies/);
  });

  it('refuses a starter path --mount would misread', async () => {
    const { docker } = fakeDocker();
    await expect(warmNpmCache(docker, [['C:\\odd,path']], {})).rejects.toThrow(ConfigError);
  });
});
