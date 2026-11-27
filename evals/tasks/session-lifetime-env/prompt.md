Sessions last 30 days, hard-coded in `src/lib/auth.ts`. Our enterprise customers want shorter sign-ins, so make the lifetime configurable with a `SESSION_TTL_DAYS` environment variable: a whole number of days, 30 when it is not set.

If `SESSION_TTL_DAYS` is set to anything other than a positive whole number, signing in and signing up must fail with an error instead of quietly using some other lifetime.
