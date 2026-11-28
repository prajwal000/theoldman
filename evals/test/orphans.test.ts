import { describe, expect, it } from 'vitest';
import type { DockerExec } from '../src/docker.ts';
import { removeOrphans } from '../src/orphans.ts';

function fakeDocker(listing: string, code = 0) {
  const calls: string[][] = [];
  const docker: DockerExec = (args) => {
    calls.push([...args]);
    const stdout = args[0] === 'ps' ? listing : '';
    return Promise.resolve({
      code: args[0] === 'ps' ? code : 0,
      stdout,
      stderr: '',
      timedOut: false,
    });
  };
  return { docker, calls };
}

const row = (id: string, name: string, owner: string, project = '') =>
  [id, name, owner, project].join('\t');

describe('removeOrphans', () => {
  it('removes containers and Compose projects whose owner process is gone', async () => {
    const listing = [
      row('a1', 'theoldman-score-x-with-1', '111'),
      row('b2', 'theoldman-score-x-with-1-postgres-1', '111', 'theoldman-score-x-with-1'),
      row('c3', 'theoldman-eval-y-agent-1', '222', 'theoldman-eval-y'),
      row('d4', 'theoldman-eval-y-postgres-1', '222', 'theoldman-eval-y'),
    ].join('\n');
    const { docker, calls } = fakeDocker(listing);
    const removed = await removeOrphans(docker, {}, () => false);

    expect(removed).toEqual([
      'theoldman-score-x-with-1',
      'theoldman-eval-y',
      'theoldman-score-x-with-1',
    ]);
    expect(calls.slice(1)).toEqual([
      ['compose', '-p', 'theoldman-score-x-with-1', 'down', '-v', '--remove-orphans', '-t', '0'],
      ['compose', '-p', 'theoldman-eval-y', 'down', '-v', '--remove-orphans', '-t', '0'],
      ['rm', '-f', 'a1'],
    ]);
  });

  it('leaves containers of live processes, this process and unknown owners alone', async () => {
    const listing = [
      row('a1', 'live', '111'),
      row('b2', 'mine', String(process.pid)),
      row('c3', 'unknown', '0'),
      row('d4', 'garbage', 'abc'),
    ].join('\n');
    const { docker, calls } = fakeDocker(listing);
    expect(await removeOrphans(docker, {}, (pid) => pid === 111)).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('does nothing when Docker cannot list containers', async () => {
    const { docker, calls } = fakeDocker('', 1);
    expect(await removeOrphans(docker, {}, () => false)).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});
