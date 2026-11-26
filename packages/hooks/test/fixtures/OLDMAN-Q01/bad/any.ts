// expect: OLDMAN-Q01@2, OLDMAN-Q01@3, OLDMAN-Q01@4, OLDMAN-Q01@5, OLDMAN-Q01@6, OLDMAN-Q01@7, OLDMAN-Q01@10
export function parse(input: any): unknown {
  const data = JSON.parse(input) as any;
  const list = <any>data.items;
  const map: Record<string, any> = {};
  const items: any[] = [];
  const pending: Promise<any> = Promise.resolve();
  return { data, list, map, items, pending };
}
export type Handler = (event?: any) => void;
