import { describe, expect, it } from 'vitest';
import { checkCommand, guardBashRule } from '../../src/rules/guard-bash.js';
import { assertFast, runRuleOnFixtures } from '../harness.js';
import { fakeContext } from './fake-context.js';

/** A repo on a feature branch whose remote default is main, counting git lookups. */
function fakeGit(current: string | undefined = 'feature/x', defaults: Record<string, string> = {}) {
  const { context, calls } = fakeContext({ current, defaults });
  return { git: context, calls };
}

for (const rule of ['OLDMAN-G01', 'OLDMAN-G02', 'OLDMAN-G03', 'OLDMAN-G04']) {
  runRuleOnFixtures(rule, guardBashRule(fakeContext().context));
}

describe('OLDMAN-G01 force-push', () => {
  it('blocks a force-push of the current branch when it is protected', () => {
    const { git } = fakeGit('main');
    expect(checkCommand('git push -f', 'bash', git).map((v) => v.id)).toEqual(['OLDMAN-G01']);
    expect(checkCommand('git push --force origin HEAD', 'bash', git)).toHaveLength(1);
    expect(checkCommand('git push --force origin @', 'powershell', git)).toHaveLength(1);
  });

  it('forces only the refspecs marked with + when there is no -f', () => {
    const { git } = fakeGit();
    expect(checkCommand('git push origin feature/x +main', 'bash', git)).toHaveLength(1);
    expect(checkCommand('git push origin +feature/x main', 'bash', git)).toEqual([]);
    expect(checkCommand('git push --all origin', 'bash', git)).toEqual([]);
  });

  it('allows a force-push when the current branch is unknown', () => {
    expect(checkCommand('git push -f', 'bash', fakeGit(undefined).git)).toEqual([]);
  });

  it("blocks the remote's default branch when it is not main or master", () => {
    const { git, calls } = fakeGit('feature/x', { origin: 'develop', upstream: 'trunk' });
    expect(checkCommand('git push -f origin develop', 'bash', git)).toHaveLength(1);
    expect(checkCommand('git push -f upstream trunk', 'bash', git)).toHaveLength(1);
    expect(checkCommand('git push -f upstream develop', 'bash', git)).toEqual([]);
    expect(calls).toContain('defaultBranch upstream');
  });

  it('only asks git when a force-push targets a branch that is not main or master', () => {
    const { git, calls } = fakeGit();
    checkCommand('git status && git push origin main && npm test', 'bash', git);
    checkCommand('git push -f origin main', 'bash', git);
    expect(calls).toEqual([]);
    checkCommand('git push -f origin feature/y', 'bash', git);
    expect(calls).toEqual(['defaultBranch origin']);
  });

  it('names the rule, the branch and the safe alternative', () => {
    const [violation] = checkCommand('git push -f origin main', 'bash', fakeGit().git);
    expect(violation?.id).toBe('OLDMAN-G01');
    expect(violation?.message).toContain('force-pushing to main');
    expect(violation?.message).toContain('Push to a new branch and open a pull request');
    const [all] = checkCommand('git push --mirror', 'bash', fakeGit().git);
    expect(all?.message).toContain('every branch, including the default branch');
  });

  it('skips a push option value given as the next word', () => {
    const { git } = fakeGit();
    expect(checkCommand('git push -f -o ci.skip origin main', 'bash', git)).toHaveLength(1);
    expect(checkCommand('git push --push-option ci.skip -f origin main', 'bash', git)).toHaveLength(
      1,
    );
    expect(checkCommand('git push -f --repo=origin feature/x', 'bash', git)).toEqual([]);
    expect(checkCommand('git push -f origin -- main', 'bash', git)).toHaveLength(1);
  });
});

describe('OLDMAN-G02 skipped hooks', () => {
  it('names the rule and the safe alternative', () => {
    const [violation] = checkCommand('git commit -m x --no-verify', 'bash', fakeGit().git);
    expect(violation?.id).toBe('OLDMAN-G02');
    expect(violation?.message).toContain('without --no-verify');
  });

  it('reads value-taking commit options so their values are not flags', () => {
    const { git } = fakeGit();
    expect(checkCommand('git commit --author "A <a@b.c>" -n', 'bash', git)).toHaveLength(1);
    expect(checkCommand('git commit -F -n', 'bash', git)).toEqual([]);
    expect(checkCommand('git commit -anm x', 'bash', git)).toHaveLength(1);
    expect(checkCommand('git commit -mn', 'bash', git)).toEqual([]);
  });
});

describe('checkCommand', () => {
  it('reports each rule once per command line', () => {
    const line = 'git push -f origin main && git push -f origin master && git commit -n -m x';
    expect(checkCommand(line, 'bash', fakeGit().git).map((v) => v.id)).toEqual([
      'OLDMAN-G01',
      'OLDMAN-G02',
    ]);
  });

  it('ignores git with no subcommand and other programs', () => {
    const { git } = fakeGit();
    expect(checkCommand('git', 'bash', git)).toEqual([]);
    expect(checkCommand('git --version', 'bash', git)).toEqual([]);
    expect(checkCommand('gitk push -f origin main', 'bash', git)).toEqual([]);
  });

  it('is fast on 2,000 command lines', () => {
    const commands = [
      'git push -f origin main',
      'npm test && git commit -m "x" --no-verify',
      '$env:FOO=1; git push --force origin master',
      'echo "git push -f origin main" | tee log.txt',
      'rm -rf ./dist /etc && Remove-Item -Recurse -Force ..\\other',
      'DATABASE_URL=postgresql://localhost/app npx prisma migrate reset && psql -c "DROP TABLE t"',
    ];
    assertFast(guardBashRule(fakeGit().git), {
      generate: (index) => commands[index % commands.length] ?? '',
      file: 'commands.sh',
    });
  });
});
