When a customer places an order (`POST /api/orders`), email them an order confirmation with `sendEmail` from `src/lib/email.ts`. Don't send it inside the request: queue a background job, stored in Postgres, and send it from there.

- Add `runDueJobs()`, exported from `src/lib/jobs.ts`. It runs every job that is due and resolves when they are done. Add an `npm run worker` script that keeps calling it every few seconds.
- Several workers will run at the same time, so each job must run exactly once, even when two `runDueJobs()` calls overlap.
- If a job fails, retry it after `JOB_RETRY_DELAY_MS` milliseconds (an environment variable, default 60000), at most 3 attempts in total. After the last failed attempt, keep the job with its error and stop retrying.
