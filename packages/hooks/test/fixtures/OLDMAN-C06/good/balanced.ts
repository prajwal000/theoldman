// Retries back off exponentially so a flaky API is not hammered.
export async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let delay = 100;
  for (let i = 1; i < attempts; i++) {
    try {
      return await fn();
    } catch {
      await sleep(delay);
      delay *= 2;
    }
  }
  return fn();
}
