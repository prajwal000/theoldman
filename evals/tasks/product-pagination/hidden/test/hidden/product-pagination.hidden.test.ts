import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from '../../src/app/api/products/route';
import { db } from '../../src/lib/db';
import { call, resetDatabase } from './support';

interface Page {
  items: { id: string }[];
  nextCursor: string | null;
}

beforeEach(resetDatabase);

async function page(query: string): Promise<{ status: number; body: Page }> {
  const response = await GET(call(`/api/products${query}`));
  return { status: response.status, body: (await response.json()) as Page };
}

/** Products with the given creation times; returns each id's creation time. */
async function seed(times: readonly Date[]): Promise<Map<string, number>> {
  await db.product.createMany({
    data: times.map((createdAt, i) => ({
      name: `Product ${String(i)}`,
      priceCents: 100,
      createdAt,
    })),
  });
  const rows = await db.product.findMany({ select: { id: true, createdAt: true } });
  return new Map(rows.map((row) => [row.id, row.createdAt.getTime()]));
}

const distinct = (count: number): Date[] =>
  Array.from({ length: count }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 60_000));

function expectNewestFirst(ids: readonly string[], createdAt: Map<string, number>): void {
  const times = ids.map((id) => createdAt.get(id) ?? Number.NaN);
  for (let i = 1; i < times.length; i++) {
    expect(times[i]).toBeLessThanOrEqual(times[i - 1] ?? Number.NaN);
  }
}

describe('product pagination', () => {
  it('returns 20 products by default, newest first, with a cursor for the rest', async () => {
    const createdAt = await seed(distinct(25));
    const { status, body } = await page('');
    expect(status).toBe(200);
    expect(body.items).toHaveLength(20);
    expectNewestFirst(
      body.items.map((item) => item.id),
      createdAt,
    );
    expect(Math.max(...createdAt.values())).toBe(createdAt.get(body.items[0]?.id ?? ''));
    expect(typeof body.nextCursor).toBe('string');
  });

  it('returns every product exactly once across pages, even with equal timestamps', async () => {
    const sameMoment = new Date(Date.UTC(2026, 0, 1, 12));
    const times = [...distinct(30), ...Array.from({ length: 15 }, () => sameMoment)];
    const createdAt = await seed(times);

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < 20; pages++) {
      const query: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const { status, body } = await page(`?limit=7${query}`);
      expect(status).toBe(200);
      seen.push(...body.items.map((item) => item.id));
      cursor = body.nextCursor;
      if (cursor === null) break;
    }
    expect(cursor).toBeNull();
    expect(seen).toHaveLength(45);
    expect(new Set(seen)).toEqual(new Set(createdAt.keys()));
    expectNewestFirst(seen, createdAt);
  });

  it('has no cursor on the last page', async () => {
    expect((await page('')).body).toEqual({ items: [], nextCursor: null });
    await seed(distinct(5));
    const { body } = await page('?limit=5');
    expect(body.items).toHaveLength(5);
    expect(body.nextCursor).toBeNull();
  });

  it('caps the page size at 100', async () => {
    await seed(distinct(120));
    const { status, body } = await page('?limit=500');
    expect(status).toBe(200);
    expect(body.items).toHaveLength(100);
  });

  it('rejects a limit that is not a positive whole number', async () => {
    await seed(distinct(3));
    for (const limit of ['0', '-3', 'abc', '2.5']) {
      expect((await page(`?limit=${limit}`)).status).toBe(400);
    }
  });
});
