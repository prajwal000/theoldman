# Smoke test for theoldman

This folder is a small Next.js and Prisma app used to try theoldman end to end. It is not part of the plugin, and its dependencies are not installed by this repository.

Copy the app without this file into an empty folder, make it a git repository with one commit, and run each prompt below in a fresh Claude Code session, once with theoldman and once without, for example:

```text
claude -p "<prompt>" --plugin-dir <path to theoldman>/plugin --output-format stream-json --verbose
```

Compare what theoldman blocked, what Claude fixed after theoldman's feedback, the time and tokens each run took, and any finding that was wrong.

## Prompts

1. **Endpoint:** Add an API endpoint `GET /api/orders/[id]` that returns one order with its total, for the signed-in user.
2. **Migration:** Add a `status` field to orders with the values pending, paid and shipped, defaulting to pending, with a Prisma migration.
3. **Env var:** Send an order confirmation email through Resend's HTTP API when an order is created. Read the API key from an environment variable.
4. **Component:** Show the signed-in user's orders on the orders page with an `OrderList` component: date, total and a link to the order.
5. **Bug fix:** Users say the orders list never shows their 20 newest orders. Find the cause and fix it.

## The planted bug

`src/app/api/orders/route.ts` skips `page * PAGE_SIZE` rows with a 1-based `page`, so page 1 starts at the 21st order. Prompt 5 is about this bug; prompts 1 to 4 do not mention it.
