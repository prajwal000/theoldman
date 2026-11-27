import { describe, expect, it } from 'vitest';
import { detectProvider } from '../src/provider.ts';
import { dockerEnv, REDACTED, scrub, secretValues } from '../src/secrets.ts';

describe('secretValues and scrub', () => {
  it('collects set credential values, longest first, and ignores short ones', () => {
    expect(
      secretValues({
        ANTHROPIC_API_KEY: 'sk-ant-api03-short',
        AWS_SECRET_ACCESS_KEY: 'a-much-longer-aws-secret-value',
        AWS_SESSION_TOKEN: 'x',
        AWS_REGION: 'us-east-1-is-not-a-secret',
      }),
    ).toEqual(['a-much-longer-aws-secret-value', 'sk-ant-api03-short']);
  });

  it('replaces every occurrence', () => {
    const secrets = ['sk-ant-api03-SECRET'];
    expect(scrub('key=sk-ant-api03-SECRET and again sk-ant-api03-SECRET', secrets)).toBe(
      `key=${REDACTED} and again ${REDACTED}`,
    );
  });
});

describe('dockerEnv', () => {
  const host = {
    PATH: '/usr/bin',
    HOME: '/home/me',
    ANTHROPIC_API_KEY: 'sk-ant-x',
    ANTHROPIC_MODEL: 'claude-sonnet-5-5',
    ANTHROPIC_BASE_URL: 'https://proxy.invalid',
    AWS_ACCESS_KEY_ID: 'AKIA',
    AWS_SECRET_ACCESS_KEY: 'secret',
    AWS_PROFILE: 'dev',
    CLAUDE_CODE_USE_VERTEX: '0',
    UNSET: undefined,
  };

  it('keeps the chosen provider, the model variables and everything else Docker needs', () => {
    expect(dockerEnv(host, detectProvider(host))).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/me',
      ANTHROPIC_API_KEY: 'sk-ant-x',
      ANTHROPIC_MODEL: 'claude-sonnet-5-5',
    });
  });

  it('passes only the subscription token when that is the chosen credential', () => {
    const subscription = {
      ...host,
      ANTHROPIC_API_KEY: '',
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-x',
    };
    const env = dockerEnv(subscription, detectProvider(subscription));
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-x');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it('drops a subscription token the run does not use', () => {
    const env = dockerEnv(
      { ...host, CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-x' },
      detectProvider(host),
    );
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it('scrubs a subscription token', () => {
    const token = 'sk-ant-oat01-SUBSCRIPTION-TOKEN';
    expect(scrub(`token ${token}`, secretValues({ CLAUDE_CODE_OAUTH_TOKEN: token }))).toBe(
      `token ${REDACTED}`,
    );
  });

  it('drops the Anthropic key on Bedrock', () => {
    const bedrock = {
      ...host,
      ANTHROPIC_API_KEY: '',
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_REGION: 'us-east-1',
    };
    const env = dockerEnv(bedrock, detectProvider(bedrock));
    expect(Object.keys(env).sort()).toEqual([
      'ANTHROPIC_MODEL',
      'AWS_ACCESS_KEY_ID',
      'AWS_REGION',
      'AWS_SECRET_ACCESS_KEY',
      'CLAUDE_CODE_USE_BEDROCK',
      'HOME',
      'PATH',
    ]);
  });
});
