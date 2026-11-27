import { beforeEach, describe, expect, it } from 'vitest';
import { DELETE } from '../../src/app/api/products/[id]/route';
import { POST } from '../../src/app/api/products/route';
import { call, createUser, params, resetDatabase } from './support';

beforeEach(resetDatabase);

interface Entry {
  actorId: string;
  action: string;
  targetId: string;
  createdAt: string;
}

// Imported when a test runs, so on the starter, where the route does not exist, each test fails on
// its own.
async function readLog(token?: string): Promise<Response> {
  const { GET } = await import('../../src/app/api/admin/audit-log/route');
  return GET(call('/api/admin/audit-log', token === undefined ? {} : { token }));
}

async function entries(token: string): Promise<Entry[]> {
  const response = await readLog(token);
  expect(response.status).toBe(200);
  return ((await response.json()) as { entries: Entry[] }).entries;
}

async function create(token: string, body: unknown = { name: 'Teapot', priceCents: 2500 }) {
  return POST(call('/api/products', { body, token }));
}

const remove = (id: string, token: string) =>
  DELETE(call(`/api/products/${id}`, { method: 'DELETE', token }), params(id));

describe('admin audit log', () => {
  it('records a product being created', async () => {
    const { user, token } = await createUser('ADMIN');
    const { id } = (await (await create(token)).json()) as { id: string };
    const log = await entries(token);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: user.id, action: 'product.create', targetId: id });
    expect(Number.isNaN(Date.parse(log[0]?.createdAt ?? ''))).toBe(false);
  });

  it('records a deletion once and keeps entries after the product is gone', async () => {
    const { user, token } = await createUser('ADMIN');
    const { id } = (await (await create(token)).json()) as { id: string };
    expect((await remove(id, token)).status).toBeLessThan(300);
    expect((await remove(id, token)).status).toBe(404);
    expect(
      (await entries(token)).map((entry) => [entry.action, entry.targetId, entry.actorId]),
    ).toEqual([
      ['product.delete', id, user.id],
      ['product.create', id, user.id],
    ]);
  });

  it('records nothing for refused or invalid actions', async () => {
    const admin = await createUser('ADMIN');
    const customer = await createUser();
    expect((await create(customer.token)).status).toBe(403);
    expect((await create(admin.token, { name: '', priceCents: -1 })).status).toBe(400);
    expect(await entries(admin.token)).toEqual([]);
  });

  it('returns at most 100 entries, newest first', async () => {
    const { token } = await createUser('ADMIN');
    let last = '';
    for (let i = 0; i < 102; i++) {
      last = (
        (await (await create(token, { name: `P${String(i)}`, priceCents: 1 })).json()) as {
          id: string;
        }
      ).id;
    }
    const log = await entries(token);
    expect(log).toHaveLength(100);
    expect(log[0]?.targetId).toBe(last);
  });

  it('is for admins only', async () => {
    const customer = await createUser();
    expect((await readLog()).status).toBe(401);
    expect((await readLog(customer.token)).status).toBe(403);
  });
});
