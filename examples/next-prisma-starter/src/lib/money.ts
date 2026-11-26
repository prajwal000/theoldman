/** Formats an amount in minor units (cents) for display, such as 1999 -> "$19.99". */
export function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
