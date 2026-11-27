import { beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '../../src/app/api/auth/login/route';
import { POST as signup } from '../../src/app/api/auth/signup/route';
import * as me from '../../src/app/api/users/me/route';
import { db } from '../../src/lib/db';
import { call, createUser, resetDatabase } from './support';

beforeEach(resetDatabase);

type Handler = (request: Request) => Promise<Response>;

// Looked up when a test runs: on the starter the route has no DELETE, and each test fails on its own.
function deleteAccount(token: string | undefined, body: unknown): Promise<Response> {
  const remove = (me as Record<string, unknown>).DELETE as Handler | undefined;
  if (remove === undefined) throw new Error('DELETE /api/users/me does not exist');
  return remove(
    call('/api/users/me', { method: 'DELETE', body, ...(token === undefined ? {} : { token }) }),
  );
}

const current = async (token: string) => (await me.GET(call('/api/users/me', { token }))).status;

/** A customer with a unique name and one order. */
async function customerWithOrder() {
  const created = await createUser();
  const name = `Ada Hidden ${crypto.randomUUID()}`;
  await db.user.update({ where: { id: created.user.id }, data: { name } });
  const product = await db.product.create({ data: { name: 'Teapot', priceCents: 2500 } });
  const order = await db.order.create({
    data: { userId: created.user.id, productId: product.id, quantity: 2, totalCents: 5000 },
  });
  return { ...created, name, order };
}

describe('account deletion', () => {
  it('needs the password and a session', async () => {
    const { token } = await createUser();
    expect((await deleteAccount(token, {})).status).toBe(403);
    expect((await deleteAccount(token, { password: 'not my password' })).status).toBe(403);
    expect(await current(token)).toBe(200);
    expect((await deleteAccount(undefined, { password: 'whatever' })).status).toBe(401);
  });

  it('removes personal data and every session', async () => {
    const { user, token, password, name } = await customerWithOrder();
    const second = (await (
      await login(call('/api/auth/login', { body: { email: user.email, password } }))
    ).json()) as { token: string };

    expect((await deleteAccount(token, { password })).status).toBe(204);
    expect(await current(token)).toBe(401);
    expect(await current(second.token)).toBe(401);
    const signIn = await login(call('/api/auth/login', { body: { email: user.email, password } }));
    expect(signIn.status).toBe(401);
    expect(await db.user.count({ where: { email: user.email } })).toBe(0);
    expect(await db.user.count({ where: { name } })).toBe(0);
  });

  it('keeps the orders, without anything that identifies the person', async () => {
    const { user, token, password, name, order } = await customerWithOrder();
    expect((await deleteAccount(token, { password })).status).toBe(204);

    const kept = await db.order.findUnique({ where: { id: order.id }, include: { user: true } });
    expect(kept).not.toBeNull();
    expect(kept?.totalCents).toBe(5000);
    const linked = JSON.stringify(kept?.user ?? null);
    expect(linked).not.toContain(user.email);
    expect(linked).not.toContain(name);
  });

  it('frees the email for a new account', async () => {
    const { user, token, password } = await customerWithOrder();
    expect((await deleteAccount(token, { password })).status).toBe(204);
    const again = await signup(
      call('/api/auth/signup', {
        body: { email: user.email, name: 'Back again', password: 'a fresh password' },
      }),
    );
    expect(again.status).toBe(201);
  });
});
