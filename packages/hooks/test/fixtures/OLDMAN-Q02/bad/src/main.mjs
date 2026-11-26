// expect: OLDMAN-Q02@2, OLDMAN-Q02@3
console.log('started');
export const label = `state: ${console.log('inside a template expression') ?? 'x'}`;
