import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/errors.ts';
import { isExactModelId, readModels, requireExactModels } from '../src/models.ts';

describe('isExactModelId', () => {
  it.each([
    'claude-sonnet-5-5',
    'claude-opus-5-5',
    'claude-sonnet-4-5-20250929',
    'claude-3-5-haiku-20241022',
  ])('accepts the Anthropic API ID %s', (id) => {
    expect(isExactModelId('anthropic', id)).toBe(true);
  });

  it.each([
    'us.anthropic.claude-sonnet-4-6',
    'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
    'anthropic.claude-3-5-haiku-20241022-v1:0',
    'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123',
  ])('accepts the Bedrock ID %s', (id) => {
    expect(isExactModelId('bedrock', id)).toBe(true);
  });

  it.each([
    'sonnet',
    'opus',
    'haiku',
    'default',
    'best',
    'opusplan',
    'sonnet[1m]',
    'claude-sonnet',
    'claude-sonnet-latest',
    'claude-sonnet-5-5[1m]',
    'us.anthropic.claude-sonnet-4-6',
  ])('rejects %s on the Anthropic API', (id) => {
    expect(isExactModelId('anthropic', id)).toBe(false);
  });

  it.each(['sonnet', 'claude-sonnet-5-5', 'us.anthropic.claude-sonnet', 'haiku'])(
    'rejects %s on Bedrock',
    (id) => {
      expect(isExactModelId('bedrock', id)).toBe(false);
    },
  );
});

describe('readModels', () => {
  it('reads the model variables and treats blank as unset', () => {
    expect(
      readModels({ ANTHROPIC_MODEL: ' claude-sonnet-5-5 ', ANTHROPIC_DEFAULT_SONNET_MODEL: '' }),
    ).toEqual({
      ANTHROPIC_MODEL: 'claude-sonnet-5-5',
      ANTHROPIC_DEFAULT_SONNET_MODEL: null,
    });
  });
});

describe('requireExactModels', () => {
  it('passes exact IDs', () => {
    expect(() => {
      requireExactModels('anthropic', {
        ANTHROPIC_MODEL: 'claude-sonnet-5-5',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5-5',
      });
    }).not.toThrow();
  });

  it('names each alias and each unset variable', () => {
    const check = (): void => {
      requireExactModels('anthropic', {
        ANTHROPIC_MODEL: 'sonnet',
        ANTHROPIC_DEFAULT_SONNET_MODEL: null,
      });
    };
    expect(check).toThrow(ConfigError);
    expect(check).toThrow(
      'ANTHROPIC_MODEL is "sonnet", not an exact model ID; ANTHROPIC_DEFAULT_SONNET_MODEL is not set',
    );
  });

  it('suggests an ID in the form the provider uses', () => {
    const models = { ANTHROPIC_MODEL: 'sonnet', ANTHROPIC_DEFAULT_SONNET_MODEL: 'sonnet' };
    expect(() => {
      requireExactModels('bedrock', models);
    }).toThrow('us.anthropic.claude-sonnet-4-6');
  });
});
