export interface Stats {
  readonly n: number;
  readonly mean: number;
  /** Sample standard deviation; null for a single run, which has no spread. */
  readonly sd: number | null;
  readonly min: number;
  readonly max: number;
}

const round = (value: number): number => Math.round(value * 10_000) / 10_000;

/** Mean and spread of one metric over the runs of a task and condition; null for no runs. */
export function summarize(values: readonly number[]): Stats | null {
  const n = values.length;
  if (n === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const variance =
    n < 2 ? null : values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  return {
    n,
    mean: round(mean),
    sd: variance === null ? null : round(Math.sqrt(variance)),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
  };
}
