import { beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '../src/app/api/auth/login/route';
import { POST as signup } from '../src/app/api/auth/signup/route';
import { GET as me } from '../src/app/api/users/me/route';
import { jsonRequest, resetDatabase } from './helpers';

beforeEach(resetDatabase);

describe('accounts', () => {
  it('signs up, signs in and reads the current user', async () => {
    const body = { email: 'Ada@Example.com', name: 'Ada', password: 'analytical engine' };
    expect((await signup(jsonRequest('/api/auth/signup', { body }))).status).toBe(201);

    const response = await login(
      jsonRequest('/api/auth/login', {
        body: { email: 'ada@example.com', password: 'analytical engine' },
      }),
    );
    expect(response.status).toBe(200);
    const { token } = (await response.json()) as { token: string };
    const current = await me(jsonRequest('/api/users/me', { token }));
    expect(await current.json()).toMatchObject({ user: { email: 'ada@example.com' } });
  });

  it('rejects a short password and a wrong password', async () => {
    const short = { email: 'b@example.com', name: 'B', password: 'short' };
    expect((await signup(jsonRequest('/api/auth/signup', { body: short }))).status).toBe(400);

    const body = { email: 'c@example.com', name: 'C', password: 'long enough' };
    await signup(jsonRequest('/api/auth/signup', { body }));
    const wrong = { email: 'c@example.com', password: 'not the password' };
    expect((await login(jsonRequest('/api/auth/login', { body: wrong }))).status).toBe(401);
  });
});
