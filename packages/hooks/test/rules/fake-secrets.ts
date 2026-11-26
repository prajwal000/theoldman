import type { RuleInput } from '../../src/lib/rules.js';

// Fake secrets in real formats, built at run time from pieces so that no secret-shaped string is
// ever committed: GitHub secret scanning and push protection read the repo, and some providers
// are told about leaked tokens. Values are deterministic, so tests are repeatable.

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UPPER_DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function chars(alphabet: string, length: number, seed: number): string {
  let state = seed >>> 0;
  let out = '';
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out += alphabet.charAt(state % alphabet.length);
  }
  return out;
}

const join = (...parts: string[]): string => parts.join('');
const pem = (type: string): string => join('-----BEGIN ', type, ' KEY', '-----');

/** Values that must be detected. */
export const FAKE_SECRETS: Readonly<Record<string, string>> = {
  'aws-key-id': join('AK', 'IA', chars(UPPER_DIGITS, 16, 11)),
  'aws-session-key-id': join('AS', 'IA', chars(UPPER_DIGITS, 16, 12)),
  'github-classic': join('gh', 'p_', chars(ALNUM, 36, 13)),
  'github-oauth': join('gh', 'o_', chars(ALNUM, 36, 14)),
  'github-fine-grained': join('github', '_pat_', chars(`${ALNUM}_`, 82, 15)),
  'stripe-live': join('sk', '_live_', chars(ALNUM, 24, 16)),
  'stripe-restricted': join('rk', '_live_', chars(ALNUM, 24, 17)),
  anthropic: join('sk-', 'ant-', 'api03-', chars(`${ALNUM}-_`, 93, 18)),
  'openai-project': join('sk-', 'proj-', chars(`${ALNUM}-_`, 48, 19)),
  'openai-legacy': join('sk-', chars(ALNUM, 48, 20)),
  'pem-rsa': pem('RSA PRIVATE'),
  'pem-openssh': pem('OPENSSH PRIVATE'),
  'pem-pkcs8': pem('PRIVATE'),
  'pem-encrypted': pem('ENCRYPTED PRIVATE'),
  'high-entropy': chars(ALNUM, 32, 21),
  'hex-secret': chars('0123456789abcdef', 40, 22),
};

/** Placeholder values in real formats, which must not be detected. */
export const FAKE_PLACEHOLDERS: Readonly<Record<string, string>> = {
  'aws-docs-example': join('AKIA', 'IOSFODNN7', 'EXAMPLE'),
  'stripe-placeholder': join('sk', '_live_', 'x'.repeat(24)),
};

const FAKES: Readonly<Record<string, string>> = { ...FAKE_SECRETS, ...FAKE_PLACEHOLDERS };

/** Replaces `{{fake:name}}` with the fake value; values have no newlines, so lines stay put. */
export function fillFakes(text: string): string {
  return text.replace(/\{\{fake:([a-z0-9-]+)\}\}/g, (_match, name: string) => {
    const value = FAKES[name];
    if (value === undefined) throw new Error(`unknown fake secret: ${name}`);
    return value;
  });
}

export function fillFakesInInput(input: RuleInput): RuleInput {
  return {
    ...input,
    content: fillFakes(input.content),
    addedLines: input.addedLines.map(({ line, text }) => ({ line, text: fillFakes(text) })),
  };
}
