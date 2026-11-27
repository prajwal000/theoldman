// Credentials reach the container only as environment variables, and nothing the runner saves may
// contain one. Claude runs with every permission inside the container, so it could print its
// environment into the transcript or a file; every saved text is scrubbed before it is written.

import { MODEL_VARS } from './models.ts';
import type { Env, Provider } from './provider.ts';

export const SECRET_VARS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
] as const;

export const REDACTED = '[redacted]';

// Shorter values would match ordinary text; real credentials are far longer.
const MIN_SECRET_LENGTH = 8;

/** Values of the credential variables that are set, longest first. */
export function secretValues(env: Env): string[] {
  return SECRET_VARS.map((name) => (env[name] ?? '').trim())
    .filter((value) => value.length >= MIN_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length);
}

export function scrub(text: string, secrets: readonly string[]): string {
  let clean = text;
  for (const secret of secrets) clean = clean.replaceAll(secret, REDACTED);
  return clean;
}

// Variables that select or authenticate a model provider, in Claude Code or the AWS SDK.
const PROVIDER_VAR = /^(?:ANTHROPIC_|AWS_|CLAUDE_CODE_USE_|CLAUDE_CODE_OAUTH_)/;

/**
 * The environment for `docker`: the runner's own, minus every provider variable except the chosen
 * provider's and the model variables, so the container gets only what the plan names. Without a
 * provider, as for scoring, no provider variable is kept.
 */
export function dockerEnv(env: Env, provider?: Provider): NodeJS.ProcessEnv {
  const keep = new Set<string>(provider === undefined ? [] : [...provider.envNames, ...MODEL_VARS]);
  const result: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (PROVIDER_VAR.test(name) && !keep.has(name)) continue;
    result[name] = value;
  }
  return result;
}
