import { beforeEach, describe, expect, it } from 'vitest';
import * as productRoute from '../../src/app/api/products/[id]/route';
import { db } from '../../src/lib/db';
import { call, createUser, params, resetDatabase } from './support';

beforeEach(resetDatabase);

type Handler = (request: Request, context: ReturnType<typeof params>) => Promise<Response>;

const read = (id: string, ifNoneMatch?: string) =>
  productRoute.GET(
    call(`/api/products/${id}`, {
      headers: ifNoneMatch === undefined ? {} : { 'if-none-match': ifNoneMatch },
    }),
    params(id),
  );

// Looked up when a test runs: on the starter the route has no PATCH, and each test fails on its own.
function edit(id: string, token: string, body: unknown, ifMatch?: string): Promise<Response> {
  const patch = (productRoute as Record<string, unknown>).PATCH as Handler | undefined;
  if (patch === undefined) throw new Error('PATCH /api/products/:id does not exist');
  return patch(
    call(`/api/products/${id}`, {
      method: 'PATCH',
      body,
      token,
      headers: ifMatch === undefined ? {} : { 'if-match': ifMatch },
    }),
    params(id),
  );
}

async function etagOf(id: string): Promise<string> {
  const etag = (await read(id)).headers.get('etag');
  if (etag === null) throw new Error('GET /api/products/:id sent no ETag');
  return etag;
}

const product = () => db.product.create({ data: { name: 'Teapot', priceCents: 2500 } });

describe('product ETags', () => {
  it('gives a stable ETag and answers 304 for it', async () => {
    const { id } = await product();
    const etag = await etagOf(id);
    expect(etag).toMatch(/^(W\/)?".+"$/);
    expect(await etagOf(id)).toBe(etag);
    const cached = await read(id, etag);
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe('');
  });

  it('edits with If-Match and issues a new ETag', async () => {
    const { token } = await createUser('ADMIN');
    const { id } = await product();
    const before = await etagOf(id);
    const response = await edit(id, token, { name: 'Big teapot', priceCents: 3000 }, before);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id, name: 'Big teapot', priceCents: 3000 });
    const after = response.headers.get('etag');
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(await etagOf(id)).toBe(after);
    expect((await read(id, before)).status).toBe(200);
  });

  it('needs a current If-Match', async () => {
    const { token } = await createUser('ADMIN');
    const { id } = await product();
    expect((await edit(id, token, { name: 'No header' })).status).toBe(428);
    const stale = await etagOf(id);
    expect((await edit(id, token, { priceCents: 2600 }, stale)).status).toBe(200);
    expect((await edit(id, token, { name: 'Overwrite' }, stale)).status).toBe(412);
    expect(await db.product.findUniqueOrThrow({ where: { id } })).toMatchObject({
      name: 'Teapot',
      priceCents: 2600,
    });
  });

  it('lets only one of two edits from the same version through', async () => {
    const { token } = await createUser('ADMIN');
    const { id } = await product();
    const etag = await etagOf(id);
    const statuses = await Promise.all([
      edit(id, token, { name: 'First tab' }, etag).then((response) => response.status),
      edit(id, token, { name: 'Second tab' }, etag).then((response) => response.status),
    ]);
    expect(statuses.sort()).toEqual([200, 412]);
  });

  it('checks the user, the body and the product', async () => {
    const admin = await createUser('ADMIN');
    const customer = await createUser();
    const { id } = await product();
    const etag = await etagOf(id);
    expect((await edit(id, customer.token, { name: 'Mine' }, etag)).status).toBe(403);
    expect((await edit(id, admin.token, { priceCents: -5 }, etag)).status).toBe(400);
    expect((await edit('no-such-product', admin.token, { name: 'Ghost' }, etag)).status).toBe(404);
    expect((await db.product.findUniqueOrThrow({ where: { id } })).name).toBe('Teapot');
  });
});
