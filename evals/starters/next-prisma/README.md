# Shop

A small shop API: accounts, products and orders. Next.js route handlers on Postgres through Prisma.

## Setup

Needs Node 22 and a Postgres database.

```sh
npm install
export DATABASE_URL=postgresql://shop:shop@localhost:5432/shop
npx prisma migrate deploy
npx prisma generate
npm run dev
```

The schema is in `prisma/schema.prisma`. Change it with Prisma Migrate (`npm run db:migrate -- --name <change>`), which writes a migration to `prisma/migrations/`; deploys run `npm run db:deploy`.

## Environment

| Variable       | What                       |
| -------------- | -------------------------- |
| `DATABASE_URL` | Postgres connection string |

## Tests

`npm test` runs the Vitest suite in `test/` against `DATABASE_URL`. It empties the tables between tests, so point it at a database you can throw away. `npm run lint` and `npm run typecheck` check the code.

## API

Requests are JSON. Signed-in routes take `Authorization: Bearer <token>`, with the token from signup or login.

| Route                      | What                                            |
| -------------------------- | ----------------------------------------------- |
| `POST /api/auth/signup`    | Create an account: `email`, `name`, `password`. |
| `POST /api/auth/login`     | Sign in: `email`, `password`.                   |
| `GET /api/users/me`        | The signed-in user.                             |
| `GET /api/products`        | All products, newest first.                     |
| `POST /api/products`       | Add a product (admin): `name`, `priceCents`.    |
| `GET /api/products/:id`    | One product.                                    |
| `DELETE /api/products/:id` | Delete a product (admin).                       |
| `GET /api/orders`          | The signed-in user's orders.                    |
| `POST /api/orders`         | Order a product: `productId`, `quantity`.       |

Emails are not delivered yet: `sendEmail` in `src/lib/email.ts` keeps them in `outbox`.
