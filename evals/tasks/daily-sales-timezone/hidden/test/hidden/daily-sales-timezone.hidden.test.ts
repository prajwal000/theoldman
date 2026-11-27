import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/lib/db';
import { call, createUser, resetDatabase } from './support';

beforeEach(resetDatabase);

// Imported when a test runs, so on the starter, where the route does not exist, each test fails on
// its own.
async function report(query: string, token?: string): Promise<Response> {
  const { GET } = await import('../../src/app/api/admin/sales/daily/route');
  return GET(call(`/api/admin/sales/daily?${query}`, token === undefined ? {} : { token }));
}

async function totals(query: string, token: string): Promise<unknown> {
  const response = await report(query, token);
  expect(response.status).toBe(200);
  return response.json();
}

/** Orders at the given instants, with distinct totals so the sum shows which ones counted. */
async function ordersAt(
  instants: readonly (readonly [string, number])[],
  status: 'PAID' | 'PENDING' | 'CANCELLED' = 'PAID',
): Promise<void> {
  const { user } = await createUser();
  const product = await db.product.create({ data: { name: 'Teapot', priceCents: 1 } });
  await db.order.createMany({
    data: instants.map(([createdAt, totalCents]) => ({
      userId: user.id,
      productId: product.id,
      quantity: 1,
      totalCents,
      status,
      createdAt: new Date(createdAt),
    })),
  });
}

describe('daily sales by time zone', () => {
  it('counts the 23-hour day when Berlin moves its clocks forward', async () => {
    const { token } = await createUser('ADMIN');
    await ordersAt([
      ['2026-03-28T22:59:59.000Z', 1],
      ['2026-03-28T23:00:00.000Z', 10],
      ['2026-03-29T21:59:59.000Z', 100],
      ['2026-03-29T22:00:00.000Z', 1000],
    ]);
    expect(await totals('date=2026-03-29&tz=Europe/Berlin', token)).toEqual({
      date: '2026-03-29',
      tz: 'Europe/Berlin',
      orders: 2,
      revenueCents: 110,
    });
  });

  it('counts the 25-hour day when New York moves its clocks back', async () => {
    const { token } = await createUser('ADMIN');
    await ordersAt([
      ['2026-11-01T03:59:59.000Z', 1],
      ['2026-11-01T04:00:00.000Z', 10],
      ['2026-11-02T04:59:59.000Z', 100],
      ['2026-11-02T05:00:00.000Z', 1000],
    ]);
    expect(
      await totals(`date=2026-11-01&tz=${encodeURIComponent('America/New_York')}`, token),
    ).toMatchObject({ orders: 2, revenueCents: 110 });
  });

  it('uses the UTC day by default', async () => {
    const { token } = await createUser('ADMIN');
    await ordersAt([
      ['2026-03-28T23:59:59.000Z', 1],
      ['2026-03-29T00:00:00.000Z', 10],
      ['2026-03-29T23:59:59.000Z', 100],
      ['2026-03-30T00:00:00.000Z', 1000],
    ]);
    expect(await totals('date=2026-03-29', token)).toEqual({
      date: '2026-03-29',
      tz: 'UTC',
      orders: 2,
      revenueCents: 110,
    });
  });

  it('counts only paid orders', async () => {
    const { token } = await createUser('ADMIN');
    await ordersAt([['2026-05-10T12:00:00.000Z', 10]]);
    await ordersAt([['2026-05-10T12:00:00.000Z', 100]], 'PENDING');
    await ordersAt([['2026-05-10T12:00:00.000Z', 1000]], 'CANCELLED');
    expect(await totals('date=2026-05-10', token)).toMatchObject({ orders: 1, revenueCents: 10 });
    expect(await totals('date=2026-05-11', token)).toMatchObject({ orders: 0, revenueCents: 0 });
  });

  it('rejects dates and zones that do not exist', async () => {
    const { token } = await createUser('ADMIN');
    for (const query of [
      'date=2026-02-30',
      'date=2026-3-1',
      'date=yesterday',
      'tz=UTC',
      'date=2026-03-29&tz=Mars/Olympus_Mons',
    ]) {
      expect([query, (await report(query, token)).status]).toEqual([query, 400]);
    }
  });

  it('is for admins only', async () => {
    const customer = await createUser();
    expect((await report('date=2026-03-29')).status).toBe(401);
    expect((await report('date=2026-03-29', customer.token)).status).toBe(403);
  });
});
