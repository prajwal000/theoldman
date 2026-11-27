import { beforeEach, describe, expect, it } from 'vitest';
import { POST as addProduct } from '../../src/app/api/products/route';
import { db } from '../../src/lib/db';
import { call, createUser, params, resetDatabase } from './support';

beforeEach(resetDatabase);

// Imported when a test runs, so on the starter, where the routes do not exist, each test fails on
// its own.
async function setRole(token: string | undefined, id: string, role: unknown): Promise<Response> {
  const { PATCH } = await import('../../src/app/api/admin/users/[id]/route');
  return PATCH(
    call(`/api/admin/users/${id}`, {
      method: 'PATCH',
      body: { role },
      ...(token === undefined ? {} : { token }),
    }),
    params(id),
  );
}

async function listUsers(token: string): Promise<Response> {
  const { GET } = await import('../../src/app/api/admin/users/route');
  return GET(call('/api/admin/users', { token }));
}

const roleOf = async (id: string) => (await db.user.findUniqueOrThrow({ where: { id } })).role;

describe('admin user roles', () => {
  it('promotes a customer, with effect on their existing session', async () => {
    const admin = await createUser('ADMIN');
    const customer = await createUser();
    const response = await setRole(admin.token, customer.user.id, 'ADMIN');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: customer.user.id, role: 'ADMIN' });
    expect(await roleOf(customer.user.id)).toBe('ADMIN');

    const added = await addProduct(
      call('/api/products', {
        body: { name: 'Kettle', priceCents: 3000 },
        token: customer.token,
      }),
    );
    expect(added.status).toBe(201);
  });

  it('demotes admins but never the last one', async () => {
    const first = await createUser('ADMIN');
    const second = await createUser('ADMIN');
    expect((await setRole(first.token, second.user.id, 'CUSTOMER')).status).toBe(200);
    expect(await roleOf(second.user.id)).toBe('CUSTOMER');
    expect((await setRole(first.token, first.user.id, 'CUSTOMER')).status).toBe(409);
    expect(await roleOf(first.user.id)).toBe('ADMIN');
  });

  it('keeps one admin when two admins demote each other at once', async () => {
    const a = await createUser('ADMIN');
    const b = await createUser('ADMIN');
    const statuses = await Promise.all([
      setRole(a.token, b.user.id, 'CUSTOMER').then((response) => response.status),
      setRole(b.token, a.user.id, 'CUSTOMER').then((response) => response.status),
    ]);
    expect(await db.user.count({ where: { role: 'ADMIN' } })).toBe(1);
    expect(statuses).toContain(200);
  });

  it('refuses the signed-out, customers, unknown roles and unknown users', async () => {
    const admin = await createUser('ADMIN');
    const customer = await createUser();
    expect((await setRole(undefined, customer.user.id, 'ADMIN')).status).toBe(401);
    expect((await setRole(customer.token, customer.user.id, 'ADMIN')).status).toBe(403);
    expect(await roleOf(customer.user.id)).toBe('CUSTOMER');
    expect((await setRole(admin.token, customer.user.id, 'OWNER')).status).toBe(400);
    expect((await setRole(admin.token, 'no-such-user', 'ADMIN')).status).toBe(404);
  });

  it('lists users for admins, without password hashes', async () => {
    const admin = await createUser('ADMIN');
    const customer = await createUser();
    const response = await listUsers(admin.token);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain(customer.user.email);
    expect(text).not.toContain('passwordHash');
    expect(text).not.toContain('$2');
    expect((await listUsers(customer.token)).status).toBe(403);
  });
});
