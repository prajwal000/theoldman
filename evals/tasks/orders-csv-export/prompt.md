Customers want to download their order history. Add `GET /api/orders/export`:

- Answer CSV (`text/csv`) as a download named `orders.csv` (`Content-Disposition: attachment; filename="orders.csv"`). Signed-out requests get a 401.
- A header row, then one row per order of the signed-in customer, newest first, with these columns in this order: `order_id,date,product,quantity,total,status`. `date` is ISO 8601 in UTC, and `total` is in currency units with two decimals (`12.05`).
- Quote fields as RFC 4180 says, so commas, quotes and line breaks in product names survive.
- Customers open the file in Excel, so make sure a product name can never run as a formula there.
