/** A problem with the command line, the environment or a task, reported to the user as is. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}
