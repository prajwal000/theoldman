import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { POST as cancel } from '../../src/app/api/orders/[id]/cancel/route';
import { GET as getOrder } from '../../src/app/api/orders/[id]/route';
import { db } from '../../src/lib/db';
import { call, createUser, params, resetDatabase } from './support';

beforeEach(resetDatabase);

async function orderFor(userId: string) {
  const product = await db.product.create({ data: { name: 'Teapot', priceCents: 2500 } });
  return db.order.create({
    data: { userId, productId: product.id, quantity: 1, totalCents: 2500 },
  });
}

const view = (id: string, token?: string) =>
  getOrder(call(`/api/orders/${id}`, token === undefined ? {} : { token }), params(id));

const cancelOrder = (id: string, token: string) =>
  cancel(call(`/api/orders/${id}/cancel`, { method: 'POST', token }), params(id));

describe('order access', () => {
  it("shows customers their own orders and nobody else's", async () => {
    const owner = await createUser();
    const other = await createUser();
    const order = await orderFor(owner.user.id);

    const own = await view(order.id, owner.token);
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ id: order.id });
    expect((await view(order.id, other.token)).status).toBe(404);
    expect((await view('no-such-order', other.token)).status).toBe(404);
    expect((await view(order.id)).status).toBe(401);

    // The test that shows the bug must still be there, and not skipped.
    const visible = readFileSync(join(process.cwd(), 'test', 'orders.test.ts'), 'utf8');
    expect(visible).toMatch(
      /\bit\(\s*(["'`])does not show a customer someone else(?:\\'|')s order\1/,
    );
    expect(visible).not.toMatch(/\b(?:it\.(?:skip|todo)|xit)\(\s*["'`]does not show a customer/);
  });

  it("does not let a customer cancel someone else's order", async () => {
    const owner = await createUser();
    const other = await createUser();
    const order = await orderFor(owner.user.id);

    expect((await cancelOrder(order.id, other.token)).status).toBe(404);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING');
    expect((await cancelOrder(order.id, owner.token)).status).toBe(200);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'CANCELLED',
    );
    expect((await cancelOrder(order.id, owner.token)).status).toBe(409);
  });
});
