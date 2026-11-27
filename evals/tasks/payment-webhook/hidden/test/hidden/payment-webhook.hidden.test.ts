import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/lib/db';
import { outbox } from '../../src/lib/email';
import { call, createUser, resetDatabase } from './support';

const SECRET = 'whsec_hidden_test_secret';
let previousSecret: string | undefined;

beforeAll(() => {
  previousSecret = process.env.PAYMENT_WEBHOOK_SECRET;
  process.env.PAYMENT_WEBHOOK_SECRET = SECRET;
});
afterAll(() => {
  if (previousSecret === undefined) delete process.env.PAYMENT_WEBHOOK_SECRET;
  else process.env.PAYMENT_WEBHOOK_SECRET = previousSecret;
});
beforeEach(async () => {
  await resetDatabase();
  outbox.length = 0;
});

interface Delivery {
  readonly secret?: string;
  readonly ageSeconds?: number;
  readonly header?: string | null;
  readonly sentBody?: string;
}

// Imported when a test runs, after the secret is set and so that on the starter, where the route
// does not exist, each test fails on its own.
async function deliver(body: string, delivery: Delivery = {}): Promise<Response> {
  const { POST } = await import('../../src/app/api/webhooks/payments/route');
  const t = String(Math.floor(Date.now() / 1000) - (delivery.ageSeconds ?? 0));
  const signature = createHmac('sha256', delivery.secret ?? SECRET)
    .update(`${t}.${body}`)
    .digest('hex');
  const header = delivery.header === undefined ? `t=${t},v1=${signature}` : delivery.header;
  return POST(
    call('/api/webhooks/payments', {
      body: delivery.sentBody ?? body,
      headers: {
        'content-type': 'application/json',
        ...(header === null ? {} : { 'payment-signature': header }),
      },
    }),
  );
}

const event = (id: string, type: string, orderId: string) =>
  JSON.stringify({ id, type, data: { orderId } });

async function pendingOrder() {
  const { user } = await createUser();
  const product = await db.product.create({ data: { name: 'Teapot', priceCents: 2500 } });
  const order = await db.order.create({
    data: { userId: user.id, productId: product.id, quantity: 2, totalCents: 5000 },
  });
  return { order, email: user.email };
}

const statusOf = async (orderId: string) =>
  (await db.order.findUniqueOrThrow({ where: { id: orderId } })).status;

describe('payment webhook', () => {
  it('marks the order paid and emails one receipt', async () => {
    const { order, email } = await pendingOrder();
    const response = await deliver(event('evt_paid_1', 'payment.succeeded', order.id));
    expect(response.status).toBe(200);
    expect(await statusOf(order.id)).toBe('PAID');
    expect(outbox.filter((sent) => sent.to === email)).toHaveLength(1);
  });

  it('handles a redelivered event only once', async () => {
    const { order, email } = await pendingOrder();
    const body = event('evt_paid_2', 'payment.succeeded', order.id);
    expect((await deliver(body)).status).toBe(200);
    expect((await deliver(body)).status).toBe(200);
    expect(await statusOf(order.id)).toBe('PAID');
    expect(outbox.filter((sent) => sent.to === email)).toHaveLength(1);
  });

  it('cancels the order when the payment failed', async () => {
    const { order } = await pendingOrder();
    expect((await deliver(event('evt_failed_1', 'payment.failed', order.id))).status).toBe(200);
    expect(await statusOf(order.id)).toBe('CANCELLED');
  });

  it('rejects a wrong, missing or stale signature and a changed body', async () => {
    const { order } = await pendingOrder();
    const body = event('evt_bad_1', 'payment.succeeded', order.id);
    const tampered = event('evt_bad_1', 'payment.succeeded', 'someone-elses-order');
    expect((await deliver(body, { secret: 'whsec_wrong' })).status).toBe(400);
    expect((await deliver(body, { header: null })).status).toBe(400);
    expect((await deliver(body, { header: 't=1,v1=00' })).status).toBe(400);
    expect((await deliver(body, { ageSeconds: 6 * 60 })).status).toBe(400);
    expect((await deliver(body, { sentBody: tampered })).status).toBe(400);
    expect(await statusOf(order.id)).toBe('PENDING');
    expect(outbox).toHaveLength(0);
  });

  it('answers 200 to other event types and changes nothing', async () => {
    const { order } = await pendingOrder();
    expect((await deliver(event('evt_other_1', 'payment.refunded', order.id))).status).toBe(200);
    expect(await statusOf(order.id)).toBe('PENDING');
    expect(outbox).toHaveLength(0);
  });

  it('verifies the raw body as sent', async () => {
    const { order } = await pendingOrder();
    const pretty = JSON.stringify(
      { id: 'evt_pretty_1', type: 'payment.succeeded', data: { orderId: order.id } },
      null,
      2,
    );
    expect((await deliver(pretty)).status).toBe(200);
    expect(await statusOf(order.id)).toBe('PAID');
  });
});
