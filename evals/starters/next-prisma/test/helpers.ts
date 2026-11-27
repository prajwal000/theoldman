import { createSession, hashPassword } from '../src/lib/auth';
import { db } from '../src/lib/db';
import type { Role } from '../src/generated/prisma/client';

/** Empties every table except Prisma's migration history. */
export async function resetDatabase(): Promise<void> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const names = tables.map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}

export async function createUser(role: Role = 'CUSTOMER', password = 'correct horse battery') {
  const user = await db.user.create({
    data: {
      email: `${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
      name: 'Test User',
      passwordHash: await hashPassword(password),
      role,
    },
  });
  return { user, token: await createSession(user.id) };
}

export function jsonRequest(
  url: string,
  init: { method?: string; body?: unknown; token?: string } = {},
): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (init.token !== undefined) headers.set('authorization', `Bearer ${init.token}`);
  return new Request(`http://localhost${url}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export const params = <T extends Record<string, string>>(value: T) => ({
  params: Promise.resolve(value),
});
