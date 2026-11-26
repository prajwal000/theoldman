export function report(error: Error, logger: Logger): void {
  console.error(error);
  console.warn('retrying');
  logger.log('done');
  // console.log(error) was useful while debugging
  const sample = 'console.log(x)';
  const hint = `call console.debug() in a script, not here`;
  logger.info(sample, hint);
}
