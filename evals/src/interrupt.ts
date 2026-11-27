// Ctrl+C would otherwise end the process at once and leave its containers behind. The first one
// aborts the returned signal, so the current step stops and its containers are removed; a second
// one quits at once.

/** The usual exit code after Ctrl+C (128 + SIGINT). */
export const INTERRUPTED_EXIT = 130;

export function abortOnInterrupt(): AbortController {
  const controller = new AbortController();
  const interrupt = (): void => {
    if (controller.signal.aborted) process.exit(INTERRUPTED_EXIT);
    process.stderr.write(
      '\nInterrupted: stopping and removing the containers. Press Ctrl+C again to quit at once.\n',
    );
    controller.abort();
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  return controller;
}
