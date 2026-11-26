// expect: OLDMAN-C03@4
export function Badge({ on }: Props) {
  if (on) return <b>on</b>;
  // } else {
  return <i>off</i>;
}
