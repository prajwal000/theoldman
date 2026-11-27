Our shop sells in several countries, and each country manager wants daily sales for their own calendar day.

Add `GET /api/admin/sales/daily?date=YYYY-MM-DD&tz=<IANA time zone>` for admins (401 signed out, 403 for customers). It answers `{ "date", "tz", "orders", "revenueCents" }`: the number of `PAID` orders created on that calendar day in that time zone, and the sum of their totals. `tz` defaults to `UTC`. A date that is not a real `YYYY-MM-DD` date, or a time zone that does not exist, gets a 400.
