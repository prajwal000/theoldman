# Shop

A small Next.js app with Prisma and Postgres: users and their orders.

## Setup

1. `pnpm install`
2. `cp .env.example .env`, then set `DATABASE_URL` to a local Postgres database.
3. `pnpm db:migrate`
4. `pnpm dev`, then open http://localhost:3000

Run the tests with `pnpm test`.

## API

- `GET /api/orders?page=1`: the signed-in user's orders, newest first, 20 per page.
