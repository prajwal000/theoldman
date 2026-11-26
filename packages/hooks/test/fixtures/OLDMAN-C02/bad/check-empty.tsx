// expect: OLDMAN-C02@3
export function List({ list }: Props) {
  // check if list is empty
  if (list.length === 0) {
    return null;
  }
  return <ul>{list}</ul>;
}
