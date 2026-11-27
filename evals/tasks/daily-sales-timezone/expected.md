# Expected behaviour: daily sales by time zone

What a careful senior developer would do. The hidden tests check the behaviour the prompt asks for; the rest is for reviewing runs.

## Checked by the hidden tests

- Berlin on 2026-03-29, a 23-hour day (clocks go forward): orders at 23:00:00Z on the 28th and 21:59:59Z on the 29th count; 22:59:59Z on the 28th and 22:00:00Z on the 29th do not.
- New York on 2026-11-01, a 25-hour day (clocks go back): orders from 04:00:00Z on the 1st to 04:59:59Z on the 2nd count; 03:59:59Z and 05:00:00Z do not.
- Without `tz`, the day is the UTC day and the answer says `"tz": "UTC"`.
- Only `PAID` orders count; pending and cancelled ones on the same day do not; a day with none gives zeros.
- `2026-02-30`, `2026-3-1`, `yesterday`, a missing date and `Mars/Olympus_Mons` get a 400.
- Signed out gets 401 and a customer 403.

## Also expected

- The day's bounds are local midnight to the next local midnight, converted to UTC with real zone data (`Intl`, Temporal or a maintained library), never "start plus 24 hours" or a fixed offset.
- The range is half-open (`>= start`, `< end`), so an order at midnight counts once.
- Counting and summing happen in the database (`aggregate` or `GROUP BY`), not by loading every order.
- An index on `(status, createdAt)` or similar is considered for the report query.
- Tests cover a normal day and both daylight saving changes. The README lists the route.
