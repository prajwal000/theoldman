import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';
import { GET as getProduct } from '../../src/app/api/products/[id]/route';
import { POST as addProduct } from '../../src/app/api/products/route';
import { call, createUser, params, resetDatabase } from './support';

// The starter's own migrations; everything after them is the run's.
const STARTER_MIGRATIONS = new Set(['20261127084839_init']);
const MIGRATIONS = join(process.cwd(), 'prisma', 'migrations');

beforeEach(resetDatabase);

const databaseUrl = (name: string): string => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.pathname = `/${name}`;
  return url.href;
};

async function withScratchDatabase(use: (client: pg.Client) => Promise<void>): Promise<void> {
  const name = `hidden_sku_${String(process.pid)}_${String(Date.now())}`;
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  const client = new pg.Client({ connectionString: databaseUrl(name) });
  try {
    await client.connect();
    await use(client);
  } finally {
    await client.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
}

async function applyMigrations(client: pg.Client, which: (name: string) => boolean) {
  const names = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && which(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    await client.query(readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8'));
  }
  return names;
}

describe('product SKU', () => {
  it('migrates a database that already has products and orders', async () => {
    await withScratchDatabase(async (client) => {
      const starter = await applyMigrations(client, (name) => STARTER_MIGRATIONS.has(name));
      expect(starter).toEqual([...STARTER_MIGRATIONS]);
      await client.query(`
        INSERT INTO "User" (id, email, name, "passwordHash") VALUES ('user_a', 'a@example.com', 'A', 'x');
        INSERT INTO "Product" (id, name, "priceCents") VALUES ('prod_a', 'Mug', 1200), ('prod_b', 'Teapot', 2500);
        INSERT INTO "Order" (id, "userId", "productId", quantity, "totalCents")
          VALUES ('order_a', 'user_a', 'prod_a', 1, 1200);`);

      const added = await applyMigrations(client, (name) => !STARTER_MIGRATIONS.has(name));
      expect(added.length).toBeGreaterThan(0);

      const products = await client.query('SELECT id, sku FROM "Product" ORDER BY id');
      expect(products.rows).toEqual([
        { id: 'prod_a', sku: 'LEGACY-PROD_A' },
        { id: 'prod_b', sku: 'LEGACY-PROD_B' },
      ]);
      const column = await client.query(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_name = 'Product' AND column_name = 'sku'`,
      );
      expect(column.rows).toEqual([{ is_nullable: 'NO' }]);
      await expect(
        client.query(
          `INSERT INTO "Product" (id, sku, name, "priceCents") VALUES ('prod_c', 'LEGACY-PROD_A', 'Copy', 1)`,
        ),
      ).rejects.toMatchObject({ code: '23505' });
      expect((await client.query('SELECT id FROM "Order"')).rows).toEqual([{ id: 'order_a' }]);
    });
  });

  it('requires a well-formed SKU on new products and returns it', async () => {
    const { token } = await createUser('ADMIN');
    const post = (body: Record<string, unknown>) =>
      addProduct(
        call('/api/products', { body: { name: 'Mug', priceCents: 1200, ...body }, token }),
      );

    for (const body of [{}, { sku: 'mug-001' }, { sku: 'AB' }, { sku: 'MUG 001' }, { sku: 7 }]) {
      expect((await post(body)).status).toBe(400);
    }
    const created = await post({ sku: 'MUG-001' });
    expect(created.status).toBe(201);
    const product = (await created.json()) as { id: string; sku: string };
    expect(product.sku).toBe('MUG-001');
    const fetched = await getProduct(call(`/api/products/${product.id}`), params(product.id));
    expect(await fetched.json()).toMatchObject({ id: product.id, sku: 'MUG-001' });
  });

  it('rejects a SKU that is already in use', async () => {
    const { token } = await createUser('ADMIN');
    const post = (name: string) =>
      addProduct(call('/api/products', { body: { name, priceCents: 900, sku: 'TEA-42' }, token }));
    expect((await post('Green tea')).status).toBe(201);
    expect((await post('Black tea')).status).toBe(409);
  });
});
