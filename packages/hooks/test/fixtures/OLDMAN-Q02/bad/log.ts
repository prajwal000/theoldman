// expect: OLDMAN-Q02@3, OLDMAN-Q02@4, OLDMAN-Q02@6
export function run(user: User): void {
  console.log(user);
  console.debug('state', user.state);
  const message = `user ${user.id}`;
  window.console.log(message);
  console.error(message);
}
