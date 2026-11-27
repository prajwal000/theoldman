import { beforeEach, describe, expect, it } from 'vitest';
import { GET as listOrders, POST as placeOrder } from '../../src/app/api/orders/route';
import { DELETE, GET as getProduct } from '../../src/app/api/products/[id]/route';
import { GET as listProducts } from '../../src/app/api/products/route';
import { db } from '../../src/lib/db';
import { call, createUser, params, resetDatabase } from './support';

beforeEach(resetDatabase);

const remove = (id: string, token: string) =>
  DELETE(call(`/api/products/${id}`, { method: 'DELETE', token }), params(id));

const order = (productId: string, token: string) =>
  placeOrder(call('/api/orders', { body: { productId, quantity: 1 }, token }));

async function rowExists(id: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM "Product" WHERE id = ${id}`;
  return rows[0]?.n === 1;
}

describe('soft-deleting a product', () => {
  it('keeps the product in the database but out of the catalogue', async () => {
    const admin = await createUser('ADMIN');
    const kept = await db.product.create({ data: { name: 'Kettle', priceCents: 3000 } });
    const gone = await db.product.create({ data: { name: 'Mug', priceCents: 1200 } });

    expect((await remove(gone.id, admin.token)).status).toBeLessThan(300);
    expect(await rowExists(gone.id)).toBe(true);
    const listed = (await (await listProducts(call('/api/products'))).json()) as { id: string }[];
    expect(listed.map((product) => product.id)).toEqual([kept.id]);
    expect((await getProduct(call(`/api/products/${gone.id}`), params(gone.id))).status).toBe(404);
    expect((await remove(gone.id, admin.token)).status).toBe(404);
  });

  it('keeps existing orders for the product and refuses new ones', async () => {
    const admin = await createUser('ADMIN');
    const customer = await createUser();
    const product = await db.product.create({ data: { name: 'Mug', priceCents: 1200 } });
    expect((await order(product.id, customer.token)).status).toBe(201);

    expect((await remove(product.id, admin.token)).status).toBeLessThan(300);
    const orders = (await (
      await listOrders(call('/api/orders', { token: customer.token }))
    ).json()) as {
      product: { name: string };
    }[];
    expect(orders.map((entry) => entry.product.name)).toEqual(['Mug']);
    expect((await order(product.id, customer.token)).status).toBe(404);
  });
});
