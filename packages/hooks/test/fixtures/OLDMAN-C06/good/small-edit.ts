// Prices are in cents to avoid floating point errors.
// Convert at the edge, never in between.
export const priceCents = Math.round(price * 100);
