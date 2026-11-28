import { beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '../../src/app/api/auth/login/route';
import { ageDatabase, call, createUser, resetDatabase } from './support';

beforeEach(resetDatabase);

const attempt = (email: string, password: string) =>
  login(call('/api/auth/login', { body: { email, password } }));

async function fail(email: string, times: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++)
    statuses.push((await attempt(email, `wrong-${String(i)}`)).status);
  return statuses;
}

describe('login rate limit', () => {
  it('locks the email after five failures, even for the right password', async () => {
    const { user, password } = await createUser();
    expect(await fail(user.email, 5)).toEqual([401, 401, 401, 401, 401]);
    const wrong = await attempt(user.email, 'still wrong');
    expect(wrong.status).toBe(429);
    const right = await attempt(user.email, password);
    expect(right.status).toBe(429);
    const wait = Number(right.headers.get('retry-after'));
    expect(Number.isInteger(wait)).toBe(true);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(15 * 60);
  });

  it('lets the right password in again once 15 minutes have passed', async () => {
    const { user, password } = await createUser();
    await fail(user.email, 5);
    expect((await attempt(user.email, password)).status).toBe(429);
    await ageDatabase(16 * 60 * 1000);
    expect((await attempt(user.email, password)).status).toBe(200);
  });

  it('clears the failures after a successful sign-in', async () => {
    const { user, password } = await createUser();
    await fail(user.email, 4);
    expect((await attempt(user.email, password)).status).toBe(200);
    expect(await fail(user.email, 4)).toEqual([401, 401, 401, 401]);
    expect((await attempt(user.email, password)).status).toBe(200);
    // The count starts again from zero, so five fresh failures lock the email.
    await fail(user.email, 5);
    expect((await attempt(user.email, password)).status).toBe(429);
  });

  it('ignores case and limits unknown emails too', async () => {
    const { user, password } = await createUser();
    await fail(user.email.toUpperCase(), 5);
    expect((await attempt(user.email, password)).status).toBe(429);

    await fail('nobody-at-all@example.com', 5);
    expect((await attempt('Nobody-At-All@example.com', 'guess')).status).toBe(429);
  });

  it('locks only the email that failed', async () => {
    const locked = await createUser();
    const other = await createUser();
    await fail(locked.user.email, 5);
    expect((await attempt(locked.user.email, locked.password)).status).toBe(429);
    expect((await attempt(other.user.email, other.password)).status).toBe(200);
  });
});
