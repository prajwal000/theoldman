import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRecord, parseJson } from './input.js';

export const CONFIG_FILE = '.theoldman.json';

export type Level = 'quick' | 'standard' | 'strict';

export interface ReviewConfig {
  readonly maxNits: number;
  readonly onStop: boolean;
  readonly docsWriterModel: string;
  /** Code changes of at most this many added and removed lines get a light review; 0 means never. */
  readonly lightMaxLines: number;
}

export interface Config {
  readonly level: Level;
  readonly stack: readonly string[];
  readonly disable: readonly string[];
  readonly ignorePaths: readonly string[];
  readonly review: ReviewConfig;
  readonly maxFeedbackRounds: number;
}

export interface LoadedConfig {
  readonly config: Config;
  /** Set when the file exists but cannot be used; the defaults were returned instead. */
  readonly warning?: string;
}

export const DEFAULT_CONFIG: Config = {
  level: 'standard',
  stack: [],
  disable: [],
  ignorePaths: ['**/generated/**', '**/*.lock', '**/vendor/**'],
  review: { maxNits: 5, onStop: true, docsWriterModel: 'sonnet', lightMaxLines: 40 },
  maxFeedbackRounds: 2,
};

const LEVELS: readonly unknown[] = ['quick', 'standard', 'strict'];

function isLevel(value: unknown): value is Level {
  return LEVELS.includes(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function unknownKey(value: Record<string, unknown>, known: object): string | undefined {
  return Object.keys(value).find((key) => !Object.hasOwn(known, key));
}

function parseReview(value: unknown): ReviewConfig | string {
  if (!isRecord(value)) return '"review" must be an object';
  const extra = unknownKey(value, DEFAULT_CONFIG.review);
  if (extra !== undefined) return `has unknown key "review.${extra}"`;
  const {
    maxNits = DEFAULT_CONFIG.review.maxNits,
    onStop = DEFAULT_CONFIG.review.onStop,
    docsWriterModel = DEFAULT_CONFIG.review.docsWriterModel,
    lightMaxLines = DEFAULT_CONFIG.review.lightMaxLines,
  } = value;
  if (!isCount(maxNits)) return '"review.maxNits" must be a whole number of 0 or more';
  if (typeof onStop !== 'boolean') return '"review.onStop" must be true or false';
  if (typeof docsWriterModel !== 'string' || docsWriterModel === '') {
    return '"review.docsWriterModel" must be a non-empty string';
  }
  if (!isCount(lightMaxLines)) {
    return '"review.lightMaxLines" must be a whole number of 0 or more';
  }
  return { maxNits, onStop, docsWriterModel, lightMaxLines };
}

/** Returns the merged config, or a description of the first problem found. */
export function parseConfig(value: unknown): Config | string {
  if (!isRecord(value)) return 'must be a JSON object';
  // An unknown key is usually a typo, and silently ignoring it would hide a setting the user expects.
  const extra = unknownKey(value, DEFAULT_CONFIG);
  if (extra !== undefined) return `has unknown key "${extra}"`;
  const {
    level = DEFAULT_CONFIG.level,
    stack = DEFAULT_CONFIG.stack,
    disable = DEFAULT_CONFIG.disable,
    ignorePaths = DEFAULT_CONFIG.ignorePaths,
    review = DEFAULT_CONFIG.review,
    maxFeedbackRounds = DEFAULT_CONFIG.maxFeedbackRounds,
  } = value;
  if (!isLevel(level)) return '"level" must be "quick", "standard" or "strict"';
  if (!isStringArray(stack)) return '"stack" must be an array of strings';
  if (!isStringArray(disable)) return '"disable" must be an array of strings';
  if (!isStringArray(ignorePaths)) return '"ignorePaths" must be an array of strings';
  if (!isCount(maxFeedbackRounds)) return '"maxFeedbackRounds" must be a whole number of 0 or more';
  const parsedReview = parseReview(review);
  if (typeof parsedReview === 'string') return parsedReview;
  return { level, stack, disable, ignorePaths, review: parsedReview, maxFeedbackRounds };
}

/** Loads `.theoldman.json` from the project root. A missing file gives the defaults silently. */
export function loadConfig(projectDir: string): LoadedConfig {
  let raw: string;
  try {
    raw = readFileSync(join(projectDir, CONFIG_FILE), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { config: DEFAULT_CONFIG };
    }
    return invalid('cannot be read');
  }
  const value = parseJson(raw);
  if (value === undefined) return invalid('is not valid JSON');
  const config = parseConfig(value);
  return typeof config === 'string' ? invalid(config) : { config };
}

function invalid(problem: string): LoadedConfig {
  return { config: DEFAULT_CONFIG, warning: `${CONFIG_FILE} ${problem}; using defaults.` };
}
