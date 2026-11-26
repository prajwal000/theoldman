// expect: OLDMAN-Q04@3, OLDMAN-Q04@5, OLDMAN-Q04@6
export function f(x: number): void {
  debugger;
  const y = x + 1;
  if (y) debugger
  debugger // remove before release
}
