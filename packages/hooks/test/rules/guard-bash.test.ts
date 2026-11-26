import { describe, expect, it } from 'vitest';
import { checkCommand, guardBashRule } from '../../src/rules/guard-bash.js';
import { runRuleOnFixtures } from '../harness.js';
import { fakeContext } from './fake-context.js';
import { FAKE_SECRETS, fillFakes } from './fake-secrets.js';

describe('OLDMAN-S01 secrets in commands', () => {
  const check = (line: string, dialect: 'bash' | 'powershell' = 'bash') =>
    checkCommand(fillFakes(line), dialect, fakeContext().context);

  it.each([
    ['bash', 'echo "{{fake:stripe-live}}" > key.txt'],
    ['bash', 'export STRIPE_SECRET={{fake:high-entropy}}'],
    ['bash', 'printf %s "{{fake:github-classic}}" | gh auth login --with-token'],
    ['bash', `bash -c 'echo {{fake:anthropic}} >> .env.local'`],
    ['powershell', "Set-Content key.txt '{{fake:openai-project}}'"],
    ['powershell', '$env:AWS_ACCESS_KEY_ID = "{{fake:aws-key-id}}"'],
  ] as const)('blocks a secret in %s: %s', (dialect, line) => {
    expect(check(line, dialect).map((v) => v.id)).toContain('OLDMAN-S01');
  });

  it.each([
    'echo "$STRIPE_SECRET" > key.txt',
    'curl -H "Authorization: Bearer $TOKEN" https://api.example.com',
    'git checkout {{fake:hex-secret}}',
    'echo "API_KEY=your-key-here" >> .env.example',
  ])('allows %s', (line) => {
    expect(check(line).map((v) => v.id)).not.toContain('OLDMAN-S01');
  });

  it('names the line and kind but never the value', () => {
    for (const value of Object.values(FAKE_SECRETS)) {
      const violation = checkCommand(
        `true\nexport SERVICE_TOKEN='${value}'`,
        'bash',
        fakeContext().context,
      ).find((v) => v.id === 'OLDMAN-S01');
      expect(violation?.message).toMatch(/^line 2 of the command looks like /);
      expect(violation?.message).not.toContain(value);
      expect(violation?.message).not.toContain(value.slice(-8));
    }
  });
});

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
    const gitCalls = (): string[] => calls.filter((call) => /Branch/.test(call));
    checkCommand('git status && git push origin main && npm test', 'bash', git);
    checkCommand('git push -f origin main', 'bash', git);
    expect(gitCalls()).toEqual([]);
    checkCommand('git push -f origin feature/y', 'bash', git);
    expect(gitCalls()).toEqual(['defaultBranch origin']);
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
});
