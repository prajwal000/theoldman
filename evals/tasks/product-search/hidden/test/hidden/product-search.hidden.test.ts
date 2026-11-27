import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/lib/db';
import { call, resetDatabase } from './support';

beforeEach(resetDatabase);

// Imported when a test runs, so on the starter, where the route does not exist, each test fails on
// its own.
async function search(query: string): Promise<{ status: number; names: string[] }> {
  const { GET } = await import('../../src/app/api/products/search/route');
  const response = await GET(call(`/api/products/search?${query}`));
  if (response.status !== 200) return { status: response.status, names: [] };
  const body = (await response.json()) as { items: { name: string }[] };
  return { status: 200, names: body.items.map((item) => item.name) };
}

/** Products created one second apart, in the order given, so the last is the newest. */
async function seed(products: readonly (readonly [string, number])[]): Promise<void> {
  await db.product.createMany({
    data: products.map(([name, priceCents], i) => ({
      name,
      priceCents,
      createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000),
    })),
  });
}

const q = (text: string): string => `q=${encodeURIComponent(text)}`;

describe('product search', () => {
  it('matches part of the name, ignoring case', async () => {
    await seed([
      ['Blue MUG', 1200],
      ['Teapot', 2500],
      ['Mugwort tea', 800],
    ]);
    expect(await search(q('mug'))).toEqual({ status: 200, names: ['Mugwort tea', 'Blue MUG'] });
  });

  it('matches % and _ literally', async () => {
    await seed([
      ['100% cotton tee', 1500],
      ['100 cotton tee', 1400],
      ['a_b', 100],
      ['axb', 100],
    ]);
    expect((await search(q('100%'))).names).toEqual(['100% cotton tee']);
    expect((await search(q('a_b'))).names).toEqual(['a_b']);
  });

  it('filters by an inclusive price range and sorts', async () => {
    await seed([
      ['Cheap', 100],
      ['Middle', 500],
      ['Dear', 900],
      ['Luxury', 5000],
    ]);
    expect((await search('minPrice=500&maxPrice=900&sort=price')).names).toEqual([
      'Middle',
      'Dear',
    ]);
    expect((await search('maxPrice=500')).names).toEqual(['Middle', 'Cheap']);
    expect((await search('sort=-price')).names).toEqual(['Luxury', 'Dear', 'Middle', 'Cheap']);
    expect((await search('sort=price')).names).toEqual(['Cheap', 'Middle', 'Dear', 'Luxury']);
    expect((await search('')).names).toEqual(['Luxury', 'Dear', 'Middle', 'Cheap']);
  });

  it('rejects bad parameters', async () => {
    await seed([['Mug', 100]]);
    const bad = [
      'minPrice=abc',
      'maxPrice=-1',
      'minPrice=1.5',
      'minPrice=900&maxPrice=100',
      'sort=name',
      'sort=__proto__',
    ];
    for (const query of bad) expect([query, (await search(query)).status]).toEqual([query, 400]);
  });

  it('returns at most 50 products', async () => {
    await seed(Array.from({ length: 60 }, (_, i) => [`Mug ${String(i)}`, 100] as const));
    expect((await search(q('mug'))).names).toHaveLength(50);
  });

  it('treats SQL-shaped input as text', async () => {
    await seed([
      ['Mug', 100],
      ['Teapot', 200],
    ]);
    expect(await search(q(`'; DROP TABLE "Product"; --`))).toEqual({ status: 200, names: [] });
    expect(await search(q(`' OR '1'='1`))).toEqual({ status: 200, names: [] });
    expect(await db.product.count()).toBe(2);
  });
});
