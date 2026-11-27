import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/lib/db';
import { call, createUser, resetDatabase } from './support';

const DAY_MS = 24 * 60 * 60 * 1000;
let previous: string | undefined;

beforeEach(async () => {
  await resetDatabase();
  previous = process.env.SESSION_TTL_DAYS;
  delete process.env.SESSION_TTL_DAYS;
  // Fresh app modules for each test, so a lifetime read when a module loads is read again.
  vi.resetModules();
});
afterEach(() => {
  vi.useRealTimers();
  if (previous === undefined) delete process.env.SESSION_TTL_DAYS;
  else process.env.SESSION_TTL_DAYS = previous;
});

async function signIn(email: string, password: string): Promise<Response> {
  const { POST } = await import('../../src/app/api/auth/login/route');
  return POST(call('/api/auth/login', { body: { email, password } }));
}

async function signUp(email: string): Promise<Response> {
  const { POST } = await import('../../src/app/api/auth/signup/route');
  return POST(
    call('/api/auth/signup', { body: { email, name: 'New', password: 'long password' } }),
  );
}

/** Days until the user's newest session expires. */
async function newestSessionDays(userId: string): Promise<number> {
  const session = await db.session.findFirstOrThrow({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  return (session.expiresAt.getTime() - Date.now()) / DAY_MS;
}

describe('session lifetime', () => {
  it('uses SESSION_TTL_DAYS for new sessions, and 30 days without it', async () => {
    const { user, password } = await createUser();
    expect((await signIn(user.email, password)).status).toBe(200);
    expect(await newestSessionDays(user.id)).toBeCloseTo(30, 2);

    process.env.SESSION_TTL_DAYS = '7';
    vi.resetModules();
    expect((await signIn(user.email, password)).status).toBe(200);
    expect(await newestSessionDays(user.id)).toBeCloseTo(7, 2);

    expect((await signUp('seven-days@example.com')).status).toBe(201);
    const created = await db.user.findUniqueOrThrow({ where: { email: 'seven-days@example.com' } });
    expect(await newestSessionDays(created.id)).toBeCloseTo(7, 2);
  });

  it('ends a session once the configured lifetime is over', async () => {
    const { user, password } = await createUser();
    process.env.SESSION_TTL_DAYS = '1';
    const response = await signIn(user.email, password);
    expect(response.status).toBe(200);
    const { token } = (await response.json()) as { token: string };

    const { GET: me } = await import('../../src/app/api/users/me/route');
    expect((await me(call('/api/users/me', { token }))).status).toBe(200);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 2 * DAY_MS);
    expect((await me(call('/api/users/me', { token }))).status).toBe(401);
  });

  it.each(['0', '-5', 'abc', '1.5', '10days'])(
    'refuses to sign in when SESSION_TTL_DAYS is %s',
    async (value) => {
      const { user, password } = await createUser();
      const before = await db.session.count({ where: { userId: user.id } });
      process.env.SESSION_TTL_DAYS = value;
      let failed: boolean;
      try {
        failed = (await signIn(user.email, password)).status >= 500;
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
      expect(await db.session.count({ where: { userId: user.id } })).toBe(before);
    },
  );
});
