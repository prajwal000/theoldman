// Published results must name the exact models that ran. Aliases such as `sonnet` resolve to
// different models per provider and over time (on Bedrock `sonnet` is an older model than on the
// Anthropic API), so a run marked for publication accepts exact model IDs only.

import { ConfigError } from './errors.ts';
import type { Env, ProviderName } from './provider.ts';

/** The model variables the runner passes into the container, by name. */
export const MODEL_VARS = ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL'] as const;
export type ModelVar = (typeof MODEL_VARS)[number];
export type Models = Readonly<Record<ModelVar, string | null>>;

// Anthropic API: `claude-sonnet-5-5`, `claude-sonnet-4-5-20250929`.
const ANTHROPIC_ID = /^claude-[a-z0-9-]*\d[a-z0-9-]*$/;
// Bedrock: a model or inference profile ID such as `us.anthropic.claude-sonnet-4-6`, or its ARN.
const BEDROCK_ID = /^(?:[a-z-]+\.)?anthropic\.claude-[a-z0-9.:-]*\d[a-z0-9.:-]*$/;
const BEDROCK_ARN =
  /^arn:aws(?:-[a-z]+)*:bedrock:[a-z0-9-]+:\d{0,12}:(?:foundation-model|inference-profile|application-inference-profile)\/[A-Za-z0-9.:-]+$/;

export function isExactModelId(provider: ProviderName, id: string): boolean {
  if (/(?:^|-)latest$/.test(id)) return false;
  if (provider === 'anthropic') return ANTHROPIC_ID.test(id);
  return BEDROCK_ID.test(id) || BEDROCK_ARN.test(id);
}

export function readModels(env: Env): Models {
  const read = (name: ModelVar): string | null => {
    const value = (env[name] ?? '').trim();
    return value === '' ? null : value;
  };
  return {
    ANTHROPIC_MODEL: read('ANTHROPIC_MODEL'),
    ANTHROPIC_DEFAULT_SONNET_MODEL: read('ANTHROPIC_DEFAULT_SONNET_MODEL'),
  };
}

/** Throws unless every model variable holds an exact model ID for the provider. */
export function requireExactModels(provider: ProviderName, models: Models): void {
  const problems = MODEL_VARS.flatMap((name) => {
    const value = models[name];
    if (value === null) return [`${name} is not set`];
    return isExactModelId(provider, value) ? [] : [`${name} is "${value}", not an exact model ID`];
  });
  if (problems.length === 0) return;
  const example = provider === 'anthropic' ? 'claude-sonnet-5-5' : 'us.anthropic.claude-sonnet-4-6';
  throw new ConfigError(
    `A run marked for publication needs exact model IDs, not aliases: ${problems.join('; ')}. Set them to IDs such as ${example}.`,
  );
}
