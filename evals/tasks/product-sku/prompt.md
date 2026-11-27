Products need a stock-keeping unit. Add a required, unique `sku` to products:

- A SKU is 3 to 40 characters: uppercase letters, digits and dashes.
- `POST /api/products` takes `sku`. A missing or badly formed SKU gets a 400, and one that is already in use gets a 409.
- Products are returned with their SKU.

Production already has products and orders. The migration must keep all of them and give each existing product the SKU `LEGACY-` followed by its id in upper case.
