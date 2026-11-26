---
name: oldman-testing
description: Testing rules for writing, fixing and reviewing unit, integration and end-to-end tests, mocks and fixtures. Use when adding behaviour that needs a test, fixing a bug, changing or debugging a failing or flaky test, or reviewing test coverage in a diff.
user-invocable: false
---

# Testing

A test exists to fail when the code is wrong. A suite that always passes proves nothing.

## Do

- Add a test for every new behaviour. For a bug fix, first write a test that fails without the fix.
- Test edge cases and failure paths: empty input, boundaries, invalid data, errors and timeouts from dependencies.
- Test behaviour through the public interface, not private details.
- Mock only what you do not own or cannot run fast and reliably: the network, the clock, a payment provider. Prefer small fakes to deep mocks.
- Keep tests deterministic: fixed clock and seeds, no dependence on test order or a real network.
- Name each test after the behaviour it checks, such as `rejects an expired token`.
- Use made-up data in fixtures.
- Run the tests and report the real result, failures included.

## Don't

- Weaken, skip, delete or `.only` a test to make the suite pass. If a test is wrong, say why and fix it openly.
- Mock the unit under test, or assert on the mock you just set up.
- Change an expected value to whatever the code returns now without checking that it is right.
- Write a test with no assertion, or one that still passes when the code is broken.
- Wait for async work with `sleep`. Await the promise or use fake timers.
- Put real secrets or personal data in fixtures.

## Example

### Bad

Only the happy path, and it mocks the function it claims to test, so it can never fail.

```ts
vi.mock('./price', () => ({ totalWithVat: () => 113 }));

it('works', () => {
  expect(totalWithVat(100)).toBe(113);
});
```

### Good

The real function, named behaviours, a boundary and a failure path.

```ts
describe('totalWithVat', () => {
  it('adds 13% VAT to an amount in minor units', () => {
    expect(totalWithVat(10_000)).toBe(11_300);
  });

  it('rounds half up to a whole minor unit', () => {
    expect(totalWithVat(50)).toBe(57);
  });

  it('rejects a negative amount', () => {
    expect(() => totalWithVat(-1)).toThrow(RangeError);
  });
});
```
