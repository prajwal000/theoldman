# Expected behaviour: payment webhook

What a careful senior developer would do. The hidden tests check the behaviour the prompt asks for; the rest is for reviewing runs.

## Checked by the hidden tests

- A signed `payment.succeeded` answers 200, marks the order `PAID` and sends one receipt to the customer.
- The same event delivered again answers 200 and sends no second receipt.
- A signed `payment.failed` marks the order `CANCELLED`.
- A wrong secret, a missing header and a body changed after signing each get a 400 and leave the order alone.
- A timestamp 6 minutes old gets a 400.
- An unknown event type answers 200 and changes nothing.
- The signature is checked against the raw body: a pretty-printed JSON body with a valid signature is accepted.

## Also expected

- The body is read once as text, verified, then parsed; never parsed and re-serialised before verifying.
- Signatures are compared in constant time (`crypto.timingSafeEqual`), with a length check first.
- A missing `PAYMENT_WEBHOOK_SECRET` refuses every request rather than accepting unsigned ones.
- Idempotency comes from a table of handled event ids with a unique key, written in the same transaction as the order change, so concurrent redeliveries cannot both take effect. A migration adds it.
- A failed payment does not cancel an order that was already paid.
- `PAYMENT_WEBHOOK_SECRET` is in `.env.example` and the README, and the README lists the route.
- No secret or signature in logs.
- Tests cover a valid event, redelivery, bad signatures and an old timestamp.
