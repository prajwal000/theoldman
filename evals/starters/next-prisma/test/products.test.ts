import { beforeEach, describe, expect, it } from 'vitest';
import { DELETE, GET as getOne } from '../src/app/api/products/[id]/route';
import { GET, POST } from '../src/app/api/products/route';
import { db } from '../src/lib/db';
import { createUser, jsonRequest, params, resetDatabase } from './helpers';

beforeEach(resetDatabase);

describe('products', () => {
  it('lets an admin add a product', async () => {
    const { token } = await createUser('ADMIN');
    const response = await POST(
      jsonRequest('/api/products', { body: { name: 'Mug', priceCents: 1200 }, token }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ name: 'Mug', priceCents: 1200 });
  });

  it('refuses customers', async () => {
    const { token } = await createUser();
    const response = await POST(
      jsonRequest('/api/products', { body: { name: 'Mug', priceCents: 1200 }, token }),
    );
    expect(response.status).toBe(403);
  });

  it('lists products newest first', async () => {
    await db.product.create({ data: { name: 'Old', priceCents: 1, createdAt: new Date(1000) } });
    await db.product.create({ data: { name: 'New', priceCents: 1, createdAt: new Date(2000) } });
    const products = (await (await GET()).json()) as { name: string }[];
    expect(products.map((product) => product.name)).toEqual(['New', 'Old']);
  });

  it('deletes a product', async () => {
    const { token } = await createUser('ADMIN');
    const product = await db.product.create({ data: { name: 'Mug', priceCents: 1 } });
    const response = await DELETE(
      jsonRequest(`/api/products/${product.id}`, { method: 'DELETE', token }),
      params({ id: product.id }),
    );
    expect(response.status).toBe(204);
    const after = await getOne(
      jsonRequest(`/api/products/${product.id}`),
      params({ id: product.id }),
    );
    expect(after.status).toBe(404);
  });
});
