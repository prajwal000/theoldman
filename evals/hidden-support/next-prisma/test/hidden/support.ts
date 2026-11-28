// Shared by the hidden tests of every task on the next-prisma starter, and copied in with them.
// Kept apart from the project's own test helpers, which a run may change.
import { createSession, hashPassword } from '../../src/lib/auth';
import { db } from '../../src/lib/db';

const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`;

export async function resetDatabase(): Promise<void> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const names = tables.map(({ tablename }) => quoted(tablename)).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}

/**
 * Moves every stored timestamp back by `ms`, as if that much time had passed since the rows were
 * written. Unlike a fake Date, this ages rows whichever clock the code compares them with: the
 * app's or the database's own `now()`.
 */
export async function ageDatabase(ms: number): Promise<void> {
  const columns = await db.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
      AND data_type IN ('timestamp without time zone', 'timestamp with time zone')`;
  for (const { table_name: table, column_name: column } of columns) {
    await db.$executeRawUnsafe(
      `UPDATE ${quoted(table)} SET ${quoted(column)} = ${quoted(column)} - make_interval(secs => $1::double precision)`,
      ms / 1000,
    );
  }
}

export async function createUser(role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER') {
  const password = 'original password';
  const user = await db.user.create({
    data: {
      email: `hidden-${crypto.randomUUID()}@example.com`,
      name: 'Hidden Test',
      passwordHash: await hashPassword(password),
      role,
    },
  });
  return { user, password, token: await createSession(user.id) };
}

export function call(
  path: string,
  init: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers(init.headers);
  if (init.token !== undefined) headers.set('authorization', `Bearer ${init.token}`);
  let body: BodyInit | undefined;
  if (typeof init.body === 'string' || init.body instanceof FormData) body = init.body;
  else if (init.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.body);
  }
  return new Request(`http://localhost${path}`, {
    method: init.method ?? (body === undefined ? 'GET' : 'POST'),
    headers,
    body,
  });
}

export const params = (id: string) => ({ params: Promise.resolve({ id }) });
