import { beforeEach, describe, expect, it } from 'vitest';
import { POST as cancel } from '../src/app/api/orders/[id]/cancel/route';
import { GET as getOrder } from '../src/app/api/orders/[id]/route';
import { db } from '../src/lib/db';
import { createUser, jsonRequest, params, resetDatabase } from './helpers';

beforeEach(resetDatabase);

async function orderFor(userId: string) {
  const product = await db.product.create({ data: { name: 'Mug', priceCents: 1200 } });
  return db.order.create({
    data: { userId, productId: product.id, quantity: 1, totalCents: 1200 },
  });
}

describe('orders', () => {
  it('shows a customer their own order', async () => {
    const { user, token } = await createUser();
    const order = await orderFor(user.id);
    const response = await getOrder(
      jsonRequest(`/api/orders/${order.id}`, { token }),
      params({ id: order.id }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: order.id, product: { name: 'Mug' } });
  });

  it("does not show a customer someone else's order", async () => {
    const owner = await createUser();
    const other = await createUser();
    const order = await orderFor(owner.user.id);
    const response = await getOrder(
      jsonRequest(`/api/orders/${order.id}`, { token: other.token }),
      params({ id: order.id }),
    );
    expect(response.status).toBe(404);
  });

  it('lets a customer cancel their pending order', async () => {
    const { user, token } = await createUser();
    const order = await orderFor(user.id);
    const response = await cancel(
      jsonRequest(`/api/orders/${order.id}/cancel`, { method: 'POST', token }),
      params({ id: order.id }),
    );
    expect(response.status).toBe(200);
    expect((await db.order.findUnique({ where: { id: order.id } }))?.status).toBe('CANCELLED');
  });
});
