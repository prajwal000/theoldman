import { describe, expect, it } from 'vitest';
import type { Rule } from '../../src/lib/rules.js';
import { scanSecrets, secretMessage, secretsRule } from '../../src/rules/secrets.js';
import { runRuleOnFixtures } from '../harness.js';
import { FAKE_PLACEHOLDERS, FAKE_SECRETS, fillFakes, fillFakesInInput } from './fake-secrets.js';

const rule: Rule = (input) => secretsRule()(fillFakesInInput(input));

runRuleOnFixtures('OLDMAN-S01', rule);

describe('scanSecrets', () => {
  it.each(Object.entries(FAKE_SECRETS))('detects %s in code', (_name, value) => {
    expect(scanSecrets(`first line\nconst serviceToken = '${value}';\n`)).toEqual([
      { line: 2, kind: expect.any(String) as string },
    ]);
  });

  it.each(Object.entries(FAKE_SECRETS).filter(([name]) => !name.startsWith('pem')))(
    'detects %s in an env file assignment',
    (_name, value) => {
      expect(scanSecrets(`SERVICE_TOKEN=${value}`).map((f) => f.line)).toEqual([1]);
    },
  );

  it('does not flag a random value assigned to a name that is not secret', () => {
    expect(scanSecrets(fillFakes("const commitSha = '{{fake:hex-secret}}';"))).toEqual([]);
  });

  it.each(Object.entries(FAKE_PLACEHOLDERS))('ignores the placeholder %s', (_name, value) => {
    expect(scanSecrets(`API_KEY=${value}`)).toEqual([]);
  });

  it.each([
    'API_KEY=your-key-here',
    'STRIPE_SECRET=changeme',
    'TOKEN_KEY=xxx',
    'DB_PASSWORD=<password>',
    'const apiKey = process.env.API_KEY;',
    'apiKey: import.meta.env.VITE_KEY,',
    'SECRET_KEY=${SECRET_KEY}',
    'AUTH_TOKEN=aaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'SIGNING_KEY=abcdefghijklmnopqrstuvwxyz',
    'apiKey: getKey(name),',
  ])('ignores %s', (line) => {
    expect(scanSecrets(line)).toEqual([]);
  });

  it('reports one finding per line and counts lines with CRLF too', () => {
    const text = fillFakes(
      'a\r\n{{fake:aws-key-id}} {{fake:github-classic}}\r\nb\r\nX_TOKEN={{fake:high-entropy}}',
    );
    expect(scanSecrets(text)).toEqual([
      { line: 2, kind: 'an AWS access key ID' },
      { line: 4, kind: 'a secret value assigned to X_TOKEN' },
    ]);
  });
});

describe('secretMessage', () => {
  it('names the file, line and kind but never the value', () => {
    for (const value of Object.values(FAKE_SECRETS)) {
      const text = `const k = '${value}';\nSERVICE_SECRET=${value}`;
      for (const finding of scanSecrets(text)) {
        const message = secretMessage('src/config.ts', finding);
        expect(message).toMatch(/^src\/config\.ts:\d+ looks like /);
        expect(message).not.toContain(value);
        expect(message).not.toContain(value.slice(-8));
      }
    }
  });
});
