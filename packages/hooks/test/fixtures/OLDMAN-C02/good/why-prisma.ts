// Prisma returns null for soft-deleted rows; treat them as missing.
export const user = getUser(id);
