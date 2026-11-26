// OLDMAN-S01: secrets in written content. Provider formats (AWS access key IDs, GitHub, Stripe
// live, Anthropic and OpenAI keys, PEM private key blocks) and random-looking values assigned to
// names that end in _SECRET, _KEY, _TOKEN or PASSWORD (or camelCase Secret, Key, Token).
// Obvious placeholders are ignored. A finding says which kind of secret and where, never the
// value itself: hook output is shown to Claude and can end up in logs.

import type { Finding, Rule } from '../lib/rules.js';

export interface SecretFinding {
  /** 1-based line in the scanned text. */
  readonly line: number;
  /** What it looks like, for the message: "an AWS access key ID". Never the value. */
  readonly kind: string;
}

const PROVIDER_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, 'an AWS access key ID'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, 'a GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, 'a GitHub token'],
  [/\b[rs]k_live_[A-Za-z0-9]{16,}\b/g, 'a Stripe live key'],
  [/\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{20,}/g, 'an Anthropic API key'],
  [/\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g, 'an OpenAI API key'],
  [/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g, 'a private key block'],
];

// `NAME=value`, `NAME: value`, `"name": "value"`, `const name = 'value'`.
const ASSIGNMENT = /["']?([A-Za-z_][\w.-]*)["']?\s*[:=]\s*(["'`]?)([^\s"'`,;]+)\2/g;
const SECRET_NAME = /(?:_(?:secret|key|token)|password)$/i;
const CAMEL_SECRET_NAME = /[a-z0-9](?:Secret|Key|Token)$/;
const PUBLIC_NAME = /public|publishable/i;
const PLACEHOLDER =
  /your[-_ ]?[a-z_-]*here|change[-_ ]?me|placeholder|example|dummy|sample|redacted|x{4}|\*{3}|^<.*>$|^\$\{?\w+\}?$|^\{\{.*\}\}$|^(.)\1+$/i;
const CODE_REFERENCE = /^(?:process\.env|import\.meta\.env|os\.environ|env\b)|^[$<{]|\(/;

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER.test(value);
}

/** Shannon entropy in bits per character. */
function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Long, mixed letters and digits, and varied enough not to be a word or a repeated pattern. */
function looksRandom(value: string): boolean {
  return value.length >= 16 && /\d/.test(value) && /[A-Za-z]/.test(value) && entropy(value) >= 3.2;
}

function assignedSecret(line: string): string | undefined {
  for (const match of line.matchAll(ASSIGNMENT)) {
    const [, name = '', , value = ''] = match;
    const secretName = SECRET_NAME.test(name) || CAMEL_SECRET_NAME.test(name);
    if (!secretName || PUBLIC_NAME.test(name) || isPlaceholder(value)) continue;
    if (!CODE_REFERENCE.test(value) && looksRandom(value))
      return `a secret value assigned to ${name}`;
  }
  return undefined;
}

function secretKind(line: string): string | undefined {
  for (const [pattern, kind] of PROVIDER_PATTERNS) {
    if ([...line.matchAll(pattern)].some(([token]) => !isPlaceholder(token))) return kind;
  }
  return assignedSecret(line);
}

/** Every line of `text` that holds a secret, at most one finding per line. */
export function scanSecrets(text: string): SecretFinding[] {
  return text.split(/\r?\n/).flatMap((line, index) => {
    const kind = secretKind(line);
    return kind === undefined ? [] : [{ line: index + 1, kind }];
  });
}

export function secretMessage(file: string, finding: SecretFinding): string {
  return `${file}:${String(finding.line)} looks like ${finding.kind}. Do not write secrets into files: read the value from an environment variable and keep it out of the repo.`;
}

/** For a secret in a Bash or PowerShell command, such as `echo "sk_live_..." > key.txt`. */
export function commandSecretMessage(finding: SecretFinding): string {
  return `line ${String(finding.line)} of the command looks like ${finding.kind}. Do not put secrets in commands: they end up in shell history, logs and files. Read the value from an environment variable instead.`;
}

/** The scanner as a Rule for fixtures: every line of the file counts as written. */
export function secretsRule(): Rule {
  return ({ file, content }) =>
    scanSecrets(content).map((finding): Finding => ({
      id: 'OLDMAN-S01',
      action: 'block',
      file,
      line: finding.line,
      message: secretMessage(file, finding),
    }));
}
