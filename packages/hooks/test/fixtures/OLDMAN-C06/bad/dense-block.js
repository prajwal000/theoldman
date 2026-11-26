// expect: OLDMAN-C06@4
const limit = 10;
/*
 * The limit is ten because the upstream API pages at ten.
 * Raising it means more requests per page.
 * Lowering it wastes quota.
 */
export const pages = Math.ceil(total / limit);
