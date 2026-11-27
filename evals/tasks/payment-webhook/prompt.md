Our payment provider will call us when the payment for an order succeeds or fails. Add `POST /api/webhooks/payments` for it.

The provider signs each request the way Stripe does: a `Payment-Signature` header of the form `t=<unix seconds>,v1=<signature>`, where the signature is the hex HMAC-SHA256 of `<t>.<raw request body>` with a shared secret. We'll provide the secret as the `PAYMENT_WEBHOOK_SECRET` environment variable. Reject a request with a missing or wrong signature, or a timestamp more than 5 minutes old, with a 400.

The body is JSON: `{ "id": "evt_...", "type": "...", "data": { "orderId": "..." } }`.

- `payment.succeeded`: mark the order `PAID` and email the customer a receipt with `sendEmail` from `src/lib/email.ts`.
- `payment.failed`: mark the order `CANCELLED`.
- Ignore any other type, but still answer 200.

The provider retries deliveries, so the same event can arrive more than once; each event must take effect only once. Answer 200 when an event has been handled, or was handled before.
