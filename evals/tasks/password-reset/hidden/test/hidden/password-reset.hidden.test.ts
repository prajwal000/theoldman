import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as login } from '../../src/app/api/auth/login/route';
import { GET as me } from '../../src/app/api/users/me/route';
import { outbox } from '../../src/lib/email';
import { call, createUser, resetDatabase } from './support';

beforeEach(async () => {
  await resetDatabase();
  outbox.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

// Imported when a test runs, so on the starter, where they do not exist, each test fails on its
// own instead of the whole file failing to load.
const ask = async (email: string) => {
  const { POST } = await import('../../src/app/api/auth/password-reset/request/route');
  return POST(call('/api/auth/password-reset/request', { body: { email } }));
};

const setPassword = async (token: string, password: string) => {
  const { POST } = await import('../../src/app/api/auth/password-reset/confirm/route');
  return POST(call('/api/auth/password-reset/confirm', { body: { token, password } }));
};

const signIn = (email: string, password: string) =>
  login(call('/api/auth/login', { body: { email, password } }));

async function resetToken(email: string): Promise<string> {
  const response = await ask(email);
  expect(response.status).toBe(200);
  const mail = outbox.filter((sent) => sent.to === email).at(-1);
  const token = /reset-password\?token=([^\s&"'<>]+)/.exec(mail?.text ?? '')?.[1];
  if (token === undefined) throw new Error('no reset link was emailed');
  return decodeURIComponent(token);
}

describe('requesting a reset', () => {
  it('emails a reset link to the account', async () => {
    const { user } = await createUser();
    await resetToken(user.email);
    expect(outbox.filter((sent) => sent.to === user.email)).toHaveLength(1);
  });

  it('answers the same for an unknown email and sends nothing', async () => {
    const { user } = await createUser();
    const known = await ask(user.email);
    const unknown = await ask('nobody-here@example.com');
    expect(unknown.status).toBe(200);
    expect(unknown.status).toBe(known.status);
    expect(await unknown.text()).toBe(await known.text());
    expect(outbox.filter((sent) => sent.to === 'nobody-here@example.com')).toHaveLength(0);
  });
});

describe('confirming a reset', () => {
  it('sets the new password', async () => {
    const { user, password } = await createUser();
    const token = await resetToken(user.email);
    expect((await setPassword(token, 'a whole new password')).status).toBe(200);
    expect((await signIn(user.email, 'a whole new password')).status).toBe(200);
    expect((await signIn(user.email, password)).status).toBe(401);
  });

  it('accepts a token only once', async () => {
    const { user } = await createUser();
    const token = await resetToken(user.email);
    expect((await setPassword(token, 'first new password')).status).toBe(200);
    expect((await setPassword(token, 'second new password')).status).toBe(400);
    expect((await signIn(user.email, 'second new password')).status).toBe(401);
  });

  it('rejects a token after an hour', async () => {
    const { user } = await createUser();
    const token = await resetToken(user.email);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 61 * 60 * 1000);
    expect((await setPassword(token, 'too late password')).status).toBe(400);
  });

  it('rejects a made-up token and a password that is too short', async () => {
    const { user } = await createUser();
    expect((await setPassword('not-a-real-token', 'long enough password')).status).toBe(400);
    const token = await resetToken(user.email);
    expect((await setPassword(token, 'short')).status).toBe(400);
  });

  it('signs out existing sessions', async () => {
    const { user, token: session } = await createUser();
    expect((await me(call('/api/users/me', { token: session }))).status).toBe(200);
    const token = await resetToken(user.email);
    expect((await setPassword(token, 'a whole new password')).status).toBe(200);
    expect((await me(call('/api/users/me', { token: session }))).status).toBe(401);
  });
});
