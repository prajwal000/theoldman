// Shared by the hidden tests. Kept apart from the project's own test helpers, which a run may
// change.
import { createSession, hashPassword } from '../../src/lib/auth';
import { db } from '../../src/lib/db';

export async function resetDatabase(): Promise<void> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const names = tables.map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
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
