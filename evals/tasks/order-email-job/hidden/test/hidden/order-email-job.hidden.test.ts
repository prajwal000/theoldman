import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/lib/db';
import { outbox } from '../../src/lib/email';
import { call, createUser, resetDatabase } from './support';

const deliver = outbox.push.bind(outbox);
let previousDelay: string | undefined;

beforeAll(() => {
  previousDelay = process.env.JOB_RETRY_DELAY_MS;
  process.env.JOB_RETRY_DELAY_MS = '0';
});
afterAll(() => {
  if (previousDelay === undefined) delete process.env.JOB_RETRY_DELAY_MS;
  else process.env.JOB_RETRY_DELAY_MS = previousDelay;
});
beforeEach(async () => {
  await resetDatabase();
  outbox.length = 0;
});
afterEach(() => {
  outbox.push = deliver;
});

// Imported when a test runs, after JOB_RETRY_DELAY_MS is set and so that on the starter, where
// the jobs module does not exist, each test fails on its own.
async function runDueJobs(): Promise<unknown> {
  const jobs = await import('../../src/lib/jobs');
  return jobs.runDueJobs();
}

async function placeOrder(): Promise<string> {
  const { POST } = await import('../../src/app/api/orders/route');
  const { user, token } = await createUser();
  const product = await db.product.create({ data: { name: 'Teapot', priceCents: 2500 } });
  const response = await POST(
    call('/api/orders', { body: { productId: product.id, quantity: 1 }, token }),
  );
  expect(response.status).toBe(201);
  return user.email;
}

/** Makes sendEmail fail for the first `times` calls; returns a counter of all calls. */
function failSends(times: number): { calls: number } {
  const counter = { calls: 0 };
  outbox.push = (...emails) => {
    counter.calls += 1;
    if (counter.calls <= times) throw new Error('mail provider is down');
    return deliver(...emails);
  };
  return counter;
}

describe('order confirmation job', () => {
  it('sends the confirmation from a job, not from the request, once', async () => {
    const email = await placeOrder();
    expect(outbox).toHaveLength(0);
    await runDueJobs();
    expect(outbox.map((sent) => sent.to)).toEqual([email]);
    await runDueJobs();
    expect(outbox).toHaveLength(1);
  });

  it('runs each job once when workers overlap', async () => {
    const emails: string[] = [];
    for (let i = 0; i < 5; i++) emails.push(await placeOrder());
    await Promise.all([runDueJobs(), runDueJobs(), runDueJobs()]);
    expect(outbox.map((sent) => sent.to).sort()).toEqual(emails.sort());
  });

  it('retries a job whose email failed', async () => {
    const email = await placeOrder();
    failSends(1);
    await runDueJobs();
    await runDueJobs();
    expect(outbox.map((sent) => sent.to)).toEqual([email]);
  });

  it('gives up after three attempts', async () => {
    await placeOrder();
    const counter = failSends(Number.POSITIVE_INFINITY);
    for (let i = 0; i < 5; i++) await runDueJobs();
    expect(counter.calls).toBe(3);
    outbox.push = deliver;
    await runDueJobs();
    expect(outbox).toHaveLength(0);
  });
});
