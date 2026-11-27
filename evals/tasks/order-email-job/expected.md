# Expected behaviour: order confirmation job

What a careful senior developer would do. The hidden tests check the behaviour the prompt asks for; the rest is for reviewing runs.

## Checked by the hidden tests

- Placing an order sends no email during the request; `runDueJobs()` then sends one confirmation to the customer, and running it again sends nothing more.
- Three overlapping `runDueJobs()` calls over five orders send exactly five emails, one per customer.
- With `JOB_RETRY_DELAY_MS=0`, a job whose first send fails is retried and delivers exactly one email.
- A job that keeps failing is attempted exactly 3 times, and is not run again once sending works.

## Also expected

- The job is created in the same transaction as the order, so an order never lacks its job and a rolled-back order never gets an email.
- Jobs are claimed with `SELECT ... FOR UPDATE SKIP LOCKED` (or an equivalent atomic claim, such as a conditional update of a status or lock column), not read and then updated in separate steps.
- A job row records its status, attempts, next run time and last error; a migration adds the table, with an index for the due-job query.
- `JOB_RETRY_DELAY_MS` is validated, listed in `.env.example` and the README, and the README says how to run the worker.
- The worker stops cleanly on SIGINT and SIGTERM and logs failures without crashing.
- Tests cover the happy path, overlapping workers, retries and giving up.
