// expect: OLDMAN-Q01@2, OLDMAN-Q01@3
export function Row({ value }: { value: any }) {
  const cell = (value as any).label ?? `${value as any}`;
  return <td>{cell}</td>;
}
