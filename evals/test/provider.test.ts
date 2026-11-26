import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/errors.ts';
import { detectProvider, type Env } from '../src/provider.ts';

const KEYS = { AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE', AWS_SECRET_ACCESS_KEY: 'secret' };
const BEDROCK = { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'us-east-1' };

function failure(env: Env): string {
  try {
    detectProvider(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.message;
    throw error;
  }
  throw new Error('expected a ConfigError');
}

describe('detectProvider', () => {
  it('picks the Anthropic API from ANTHROPIC_API_KEY', () => {
    expect(detectProvider({ ANTHROPIC_API_KEY: 'sk-ant-x' })).toEqual({
      name: 'anthropic',
      envNames: ['ANTHROPIC_API_KEY'],
    });
  });

  it('picks Bedrock with access keys', () => {
    expect(detectProvider({ ...BEDROCK, ...KEYS })).toEqual({
      name: 'bedrock',
      envNames: [
        'CLAUDE_CODE_USE_BEDROCK',
        'AWS_REGION',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
      ],
    });
  });

  it('passes the session token of temporary credentials', () => {
    expect(detectProvider({ ...BEDROCK, ...KEYS, AWS_SESSION_TOKEN: 't' }).envNames).toContain(
      'AWS_SESSION_TOKEN',
    );
  });

  it('picks Bedrock with a Bedrock API key', () => {
    expect(detectProvider({ ...BEDROCK, AWS_BEARER_TOKEN_BEDROCK: 'b' }).envNames).toEqual([
      'CLAUDE_CODE_USE_BEDROCK',
      'AWS_REGION',
      'AWS_BEARER_TOKEN_BEDROCK',
    ]);
  });

  it('reads the Bedrock flag the way Claude Code does', () => {
    expect(
      detectProvider({ ...KEYS, AWS_REGION: 'us-east-1', CLAUDE_CODE_USE_BEDROCK: 'true' }).name,
    ).toBe('bedrock');
    expect(
      detectProvider({ ANTHROPIC_API_KEY: 'sk-ant-x', CLAUDE_CODE_USE_BEDROCK: '0', ...KEYS }).name,
    ).toBe('anthropic');
  });

  it('ignores AWS variables when Bedrock is not switched on', () => {
    expect(
      detectProvider({ ANTHROPIC_API_KEY: 'sk-ant-x', ...KEYS, AWS_REGION: 'eu-west-1' }),
    ).toEqual({ name: 'anthropic', envNames: ['ANTHROPIC_API_KEY'] });
  });

  it('fails clearly when no provider is set', () => {
    expect(failure({})).toMatch(/No model provider is configured\. Set ANTHROPIC_API_KEY/);
    expect(failure({ ANTHROPIC_API_KEY: '   ' })).toMatch(/No model provider/);
  });

  it('fails on a mixed provider environment', () => {
    expect(failure({ ANTHROPIC_API_KEY: 'sk-ant-x', ...BEDROCK, ...KEYS })).toMatch(
      /Mixed provider environment: both ANTHROPIC_API_KEY and CLAUDE_CODE_USE_BEDROCK/,
    );
  });

  it.each(['CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'])('rejects %s', (flag) => {
    expect(failure({ ANTHROPIC_API_KEY: 'sk-ant-x', [flag]: '1' })).toMatch(
      new RegExp(`${flag} is set, but evals run only on the Anthropic API or Amazon Bedrock`),
    );
  });

  it('fails when Bedrock has no region', () => {
    expect(failure({ CLAUDE_CODE_USE_BEDROCK: '1', ...KEYS })).toMatch(/AWS_REGION is not/);
  });

  it('names the missing half of an access key pair', () => {
    expect(failure({ ...BEDROCK, AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE' })).toMatch(
      /AWS_SECRET_ACCESS_KEY is not set/,
    );
    expect(failure({ ...BEDROCK, AWS_SECRET_ACCESS_KEY: 'secret' })).toMatch(
      /AWS_ACCESS_KEY_ID is not set/,
    );
  });

  it('fails on two kinds of Bedrock credentials', () => {
    expect(failure({ ...BEDROCK, ...KEYS, AWS_BEARER_TOKEN_BEDROCK: 'b' })).toMatch(
      /Mixed Bedrock credentials/,
    );
  });

  it('explains that a profile cannot reach the container', () => {
    expect(failure({ ...BEDROCK, AWS_PROFILE: 'dev' })).toMatch(
      /no AWS credentials.*AWS_PROFILE is not enough/,
    );
  });

  it('never puts a credential value in its messages', () => {
    const secret = 'sk-ant-api03-DO-NOT-PRINT';
    const messages = [
      failure({ ANTHROPIC_API_KEY: secret, ...BEDROCK }),
      failure({ ...BEDROCK, AWS_ACCESS_KEY_ID: secret }),
      failure({ ...BEDROCK, AWS_SECRET_ACCESS_KEY: secret, AWS_BEARER_TOKEN_BEDROCK: secret }),
    ];
    for (const message of messages) expect(message).not.toContain(secret);
  });
});
