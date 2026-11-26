export function parse(input: string): unknown {
  const data: unknown = JSON.parse(input);
  return data;
}
// We never write as any here, nor `: any`.
/* Record<string, any> is banned. */
export const label = 'as any';
export const hint = `use unknown, not <any>`;
export const anything = 1;
export const company = { name: 'Any Corp', many: true };
export type Many = Array<string>;
export const matcher = /: any|as any/;
