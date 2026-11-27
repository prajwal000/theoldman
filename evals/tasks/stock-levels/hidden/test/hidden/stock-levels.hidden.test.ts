import { beforeEach, describe, expect, it } from 'vitest';
import { POST as placeOrder } from '../../src/app/api/orders/route';
import { GET as getProduct } from '../../src/app/api/products/[id]/route';
import { POST as addProduct } from '../../src/app/api/products/route';
import { db } from '../../src/lib/db';
import { call, createUser, params, resetDatabase } from './support';

beforeEach(resetDatabase);

const order = (token: string, productId: string, quantity: number) =>
  placeOrder(call('/api/orders', { body: { productId, quantity }, token }));

/** A product with the given stock, created through the API. */
async function stocked(stock: number): Promise<string> {
  const { token } = await createUser('ADMIN');
  const response = await addProduct(
    call('/api/products', { body: { name: 'Teapot', priceCents: 2500, stock }, token }),
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

const stockOf = async (id: string): Promise<unknown> =>
  (
    (await (await getProduct(call(`/api/products/${id}`), params(id))).json()) as {
      stock?: unknown;
    }
  ).stock;

describe('stock levels', () => {
  it('stores stock on new products, defaulting to 0, and rejects bad values', async () => {
    const { token } = await createUser('ADMIN');
    const add = (extra: Record<string, unknown>) =>
      addProduct(
        call('/api/products', { body: { name: 'Mug', priceCents: 1200, ...extra }, token }),
      );
    const withStock = (await (await add({ stock: 5 })).json()) as { id: string; stock: number };
    expect(withStock.stock).toBe(5);
    expect(await stockOf(withStock.id)).toBe(5);
    expect(await (await add({})).json()).toMatchObject({ stock: 0 });
    for (const stock of [-1, 1.5, '3']) expect((await add({ stock })).status).toBe(400);
  });

  it('takes stock when ordering and refuses more than is left', async () => {
    const id = await stocked(5);
    const { token } = await createUser();
    expect((await order(token, id, 2)).status).toBe(201);
    expect(await stockOf(id)).toBe(3);
    expect((await order(token, id, 4)).status).toBe(409);
    expect(await stockOf(id)).toBe(3);
    expect(await db.order.count({ where: { productId: id } })).toBe(1);
  });

  it('never oversells under concurrent orders', async () => {
    const id = await stocked(3);
    const customers = await Promise.all(Array.from({ length: 10 }, () => createUser()));
    const statuses = await Promise.all(
      customers.map(async ({ token }) => (await order(token, id, 1)).status),
    );
    expect(statuses.filter((status) => status === 201)).toHaveLength(3);
    expect(statuses.filter((status) => status === 409)).toHaveLength(7);
    expect(await stockOf(id)).toBe(0);
    expect(await db.order.count({ where: { productId: id } })).toBe(3);
  });

  it('accepts only one of two large orders that do not both fit', async () => {
    const id = await stocked(5);
    const [first, second] = await Promise.all([createUser(), createUser()]);
    const statuses = await Promise.all([
      order(first.token, id, 3).then((response) => response.status),
      order(second.token, id, 3).then((response) => response.status),
    ]);
    expect(statuses.sort()).toEqual([201, 409]);
    expect(await stockOf(id)).toBe(2);
  });
});
