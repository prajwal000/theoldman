import { beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '../../src/app/api/auth/login/route';
import * as me from '../../src/app/api/users/me/route';
import { db } from '../../src/lib/db';
import { call, createUser, resetDatabase } from './support';

beforeEach(resetDatabase);

type Handler = (request: Request) => Promise<Response>;

// Looked up when a test runs: on the starter the route has no PATCH, and each test fails on its own.
function update(token: string | undefined, body: unknown): Promise<Response> {
  const patch = (me as Record<string, unknown>).PATCH as Handler | undefined;
  if (patch === undefined) throw new Error('PATCH /api/users/me does not exist');
  return patch(
    call('/api/users/me', { method: 'PATCH', body, ...(token === undefined ? {} : { token }) }),
  );
}

const signIn = async (email: string, password: string) =>
  (await login(call('/api/auth/login', { body: { email, password } }))).status;

describe('profile update', () => {
  it('changes the name', async () => {
    const { token } = await createUser();
    const response = await update(token, { name: '  Ada Lovelace ' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { name: 'Ada Lovelace' } });
    const current = await me.GET(call('/api/users/me', { token }));
    expect(await current.json()).toMatchObject({ user: { name: 'Ada Lovelace' } });
  });

  it('ignores fields users may not set', async () => {
    const { user, token, password } = await createUser();
    const response = await update(token, {
      name: 'Mallory',
      role: 'ADMIN',
      passwordHash: 'not-a-hash',
      id: 'hijacked-id',
    });
    expect([200, 400]).toContain(response.status);
    const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.role).toBe('CUSTOMER');
    expect(await db.user.count({ where: { id: 'hijacked-id' } })).toBe(0);
    expect(await signIn(user.email, password)).toBe(200);
  });

  it('needs the current password to change the email', async () => {
    const { user, token, password } = await createUser();
    expect((await update(token, { email: 'changed@example.com' })).status).toBe(403);
    expect(
      (await update(token, { email: 'changed@example.com', currentPassword: 'wrong guess' }))
        .status,
    ).toBe(403);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(user.email);

    const changed = await update(token, {
      email: 'Changed@Example.com',
      currentPassword: password,
    });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({ user: { email: 'changed@example.com' } });
    expect(await signIn('changed@example.com', password)).toBe(200);
    expect(await signIn(user.email, password)).toBe(401);
  });

  it('refuses an email that another account uses', async () => {
    const other = await createUser();
    const { user, token, password } = await createUser();
    const response = await update(token, { email: other.user.email, currentPassword: password });
    expect(response.status).toBe(409);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(user.email);
  });

  it('validates input and needs a session', async () => {
    const { token, password } = await createUser();
    expect((await update(token, { name: '   ' })).status).toBe(400);
    expect((await update(token, { email: 'not-an-email', currentPassword: password })).status).toBe(
      400,
    );
    expect((await update(undefined, { name: 'Nobody' })).status).toBe(401);
  });
});
