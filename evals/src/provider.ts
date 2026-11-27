// Picks the model provider from the environment, the way Claude Code does, and lists which
// variables to pass into the container. Only variable names leave this module: values are
// credentials and are never written to a run folder.

import { ConfigError } from './errors.ts';

export type Env = Readonly<Record<string, string | undefined>>;
export type ProviderName = 'anthropic' | 'bedrock';
/**
 * `subscription-token` is a Claude subscription's long-lived token (`claude setup-token`): usage
 * counts against the plan instead of API credits, so it is for runs that are not published.
 */
export type ProviderAuth = 'api-key' | 'subscription-token' | 'aws';

export interface Provider {
  readonly name: ProviderName;
  readonly auth: ProviderAuth;
  /** Names of the variables the container needs, in a stable order. */
  readonly envNames: readonly string[];
}

// The usual spellings of "on", so CLAUDE_CODE_USE_BEDROCK=true counts as well as =1.
const ON = new Set(['1', 'true', 'yes', 'on']);
const UNSUPPORTED = ['CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];

const isOn = (env: Env, name: string): boolean => ON.has((env[name] ?? '').trim().toLowerCase());
const isSet = (env: Env, name: string): boolean => (env[name] ?? '').trim() !== '';

const SETUP = `Set ANTHROPIC_API_KEY for the Anthropic API (or CLAUDE_CODE_OAUTH_TOKEN from \`claude setup-token\` for an unpublished run on a Claude subscription), or CLAUDE_CODE_USE_BEDROCK=1, AWS_REGION and AWS credentials (AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or AWS_BEARER_TOKEN_BEDROCK) for Amazon Bedrock.`;

export function detectProvider(env: Env): Provider {
  const unsupported = UNSUPPORTED.filter((name) => isOn(env, name));
  if (unsupported.length > 0) {
    throw new ConfigError(
      `${unsupported.join(' and ')} is set, but evals run only on the Anthropic API or Amazon Bedrock. ${SETUP}`,
    );
  }
  const anthropic = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'].filter((name) =>
    isSet(env, name),
  );
  const bedrock = isOn(env, 'CLAUDE_CODE_USE_BEDROCK');
  if (anthropic.length > 0 && bedrock) {
    throw new ConfigError(
      `Mixed provider environment: both ${anthropic.join(' and ')} and CLAUDE_CODE_USE_BEDROCK are set. Unset one of them.`,
    );
  }
  // Which of the two Claude Code would use is not documented, so the runner does not guess.
  if (anthropic.length === 2) {
    throw new ConfigError(
      'Mixed Anthropic credentials: both ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN are set. Unset one of them.',
    );
  }
  if (anthropic[0] === 'ANTHROPIC_API_KEY') {
    return { name: 'anthropic', auth: 'api-key', envNames: ['ANTHROPIC_API_KEY'] };
  }
  if (anthropic[0] === 'CLAUDE_CODE_OAUTH_TOKEN') {
    return { name: 'anthropic', auth: 'subscription-token', envNames: ['CLAUDE_CODE_OAUTH_TOKEN'] };
  }
  if (bedrock) return { name: 'bedrock', auth: 'aws', envNames: bedrockEnv(env) };
  throw new ConfigError(`No model provider is configured. ${SETUP}`);
}

function bedrockEnv(env: Env): string[] {
  if (!isSet(env, 'AWS_REGION')) {
    throw new ConfigError('CLAUDE_CODE_USE_BEDROCK is set but AWS_REGION is not.');
  }
  const keys = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'].filter((name) => isSet(env, name));
  const token = isSet(env, 'AWS_BEARER_TOKEN_BEDROCK');
  if (keys.length > 0 && token) {
    throw new ConfigError(
      'Mixed Bedrock credentials: set either AWS access keys or AWS_BEARER_TOKEN_BEDROCK, not both.',
    );
  }
  const base = ['CLAUDE_CODE_USE_BEDROCK', 'AWS_REGION'];
  if (token) return [...base, 'AWS_BEARER_TOKEN_BEDROCK'];
  if (keys.length === 2) {
    const session = isSet(env, 'AWS_SESSION_TOKEN') ? ['AWS_SESSION_TOKEN'] : [];
    return [...base, ...keys, ...session];
  }
  if (keys.length === 1) {
    const missing = keys[0] === 'AWS_ACCESS_KEY_ID' ? 'AWS_SECRET_ACCESS_KEY' : 'AWS_ACCESS_KEY_ID';
    throw new ConfigError(`Incomplete AWS access keys: ${missing} is not set.`);
  }
  // A profile points at files under ~/.aws, and credentials reach the container only as variables.
  const profile = isSet(env, 'AWS_PROFILE')
    ? ' AWS_PROFILE is not enough: profiles live in files, and only variables are passed into the container.'
    : '';
  throw new ConfigError(
    `CLAUDE_CODE_USE_BEDROCK is set but no AWS credentials are: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or AWS_BEARER_TOKEN_BEDROCK.${profile}`,
  );
}
