import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/lib/db';
import { call, createUser, resetDatabase } from './support';

beforeEach(resetDatabase);

/** RFC 4180 parsing, lenient about LF or CRLF line ends. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (!(c === '\r' && text[i + 1] === '\n')) field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Imported when a test runs, so on the starter, where the route does not exist, each test fails on
// its own.
async function exportCsv(token?: string): Promise<Response> {
  const { GET } = await import('../../src/app/api/orders/export/route');
  return GET(call('/api/orders/export', token === undefined ? {} : { token }));
}

async function orderOf(
  userId: string,
  name: string,
  totalCents: number,
  createdAt: string,
  quantity = 1,
) {
  const product = await db.product.create({ data: { name, priceCents: totalCents } });
  return db.order.create({
    data: { userId, productId: product.id, quantity, totalCents, createdAt: new Date(createdAt) },
  });
}

describe('order CSV export', () => {
  it('answers a CSV download and needs a session', async () => {
    const { token } = await createUser();
    expect((await exportCsv()).status).toBe(401);
    const response = await exportCsv(token);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/csv\b/);
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment;\s*filename="?orders\.csv"?$/,
    );
  });

  it("lists only the customer's orders, newest first, with exact values", async () => {
    const { user, token } = await createUser();
    const other = await createUser();
    const older = await orderOf(user.id, 'Mug', 2410, '2026-01-02T03:04:05.000Z', 2);
    const newer = await orderOf(user.id, 'Spoon', 5, '2026-02-03T04:05:06.000Z');
    await orderOf(other.user.id, 'Not yours', 999, '2026-03-01T00:00:00.000Z');
    await db.order.update({ where: { id: newer.id }, data: { status: 'PAID' } });

    const rows = parseCsv(await (await exportCsv(token)).text());
    expect(rows).toEqual([
      ['order_id', 'date', 'product', 'quantity', 'total', 'status'],
      [newer.id, '2026-02-03T04:05:06.000Z', 'Spoon', '1', '0.05', 'PAID'],
      [older.id, '2026-01-02T03:04:05.000Z', 'Mug', '2', '24.10', 'PENDING'],
    ]);
  });

  it('formats large totals with two decimals', async () => {
    const { user, token } = await createUser();
    await orderOf(user.id, 'Piano', 100000, '2026-01-01T00:00:00.000Z');
    const rows = parseCsv(await (await exportCsv(token)).text());
    expect(rows[1]?.[4]).toBe('1000.00');
  });

  it('quotes commas, quotes and line breaks', async () => {
    const { user, token } = await createUser();
    const name = 'Mug, "large"\nblue';
    await orderOf(user.id, name, 1200, '2026-01-01T00:00:00.000Z');
    const rows = parseCsv(await (await exportCsv(token)).text());
    expect(rows).toHaveLength(2);
    expect(rows[1]?.[2]).toBe(name);
  });

  it('keeps product names from running as formulas', async () => {
    const { user, token } = await createUser();
    const names = ['=HYPERLINK("http://evil.example","prize")', '+1+1', '-2+3', '@SUM(A1:A9)'];
    for (const [i, name] of names.entries()) {
      await orderOf(user.id, name, 100, `2026-01-0${String(i + 1)}T00:00:00.000Z`);
    }
    const cells = parseCsv(await (await exportCsv(token)).text())
      .slice(1)
      .map((row) => row[2] ?? '');
    expect(cells).toHaveLength(4);
    for (const cell of cells) {
      expect(cell).not.toMatch(/^[=+\-@]/);
      expect(names.some((name) => cell.endsWith(name))).toBe(true);
    }
  });
});
