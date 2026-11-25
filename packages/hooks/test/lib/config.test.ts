import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG_FILE, DEFAULT_CONFIG, loadConfig, parseConfig } from '../../src/lib/config.js';

describe('loadConfig', () => {
  let project: string;
  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'theoldman-config-'));
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  function writeConfig(text: string): void {
    writeFileSync(join(project, CONFIG_FILE), text);
  }

  it('gives the defaults without a warning when the file is missing', () => {
    expect(loadConfig(project)).toEqual({ config: DEFAULT_CONFIG });
  });

  it('merges a partial file over the defaults', () => {
    writeConfig(JSON.stringify({ level: 'strict', review: { maxNits: 3 } }));
    expect(loadConfig(project)).toEqual({
      config: {
        ...DEFAULT_CONFIG,
        level: 'strict',
        review: { maxNits: 3, onStop: true, docsWriterModel: 'sonnet' },
      },
    });
  });

  it('loads a complete file as written', () => {
    const full = {
      level: 'quick',
      stack: ['typescript', 'nextjs', 'prisma'],
      disable: ['OLDMAN-C02'],
      ignorePaths: ['dist/**'],
      review: { maxNits: 0, onStop: false, docsWriterModel: 'opus' },
      maxFeedbackRounds: 0,
    };
    writeConfig(JSON.stringify(full));
    expect(loadConfig(project)).toEqual({ config: full });
  });

  it('warns and gives the defaults for malformed JSON', () => {
    writeConfig('{ "level": "strict", }');
    expect(loadConfig(project)).toEqual({
      config: DEFAULT_CONFIG,
      warning: '.theoldman.json is not valid JSON; using defaults.',
    });
  });

  it('warns and gives the defaults for a valid JSON file with a bad value', () => {
    writeConfig(JSON.stringify({ level: 'max' }));
    expect(loadConfig(project)).toEqual({
      config: DEFAULT_CONFIG,
      warning: '.theoldman.json "level" must be "quick", "standard" or "strict"; using defaults.',
    });
  });

  it('warns and gives the defaults when the file cannot be read', () => {
    mkdirSync(join(project, CONFIG_FILE));
    expect(loadConfig(project)).toEqual({
      config: DEFAULT_CONFIG,
      warning: '.theoldman.json cannot be read; using defaults.',
    });
  });
});

describe('parseConfig', () => {
  it('returns the defaults for an empty object', () => {
    expect(parseConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it.each([
    [[], 'must be a JSON object'],
    [null, 'must be a JSON object'],
    [{ ignorPaths: [] }, 'has unknown key "ignorPaths"'],
    [{ level: null }, '"level" must be "quick", "standard" or "strict"'],
    [{ stack: 'typescript' }, '"stack" must be an array of strings'],
    [{ disable: [1] }, '"disable" must be an array of strings'],
    [{ ignorePaths: null }, '"ignorePaths" must be an array of strings'],
    [{ maxFeedbackRounds: -1 }, '"maxFeedbackRounds" must be a whole number of 0 or more'],
    [{ maxFeedbackRounds: 1.5 }, '"maxFeedbackRounds" must be a whole number of 0 or more'],
    [{ review: 'on' }, '"review" must be an object'],
    [{ review: { max: 1 } }, 'has unknown key "review.max"'],
    [{ review: { maxNits: '5' } }, '"review.maxNits" must be a whole number of 0 or more'],
    [{ review: { onStop: 'yes' } }, '"review.onStop" must be true or false'],
    [{ review: { docsWriterModel: '' } }, '"review.docsWriterModel" must be a non-empty string'],
    [{ review: { docsWriterModel: 5 } }, '"review.docsWriterModel" must be a non-empty string'],
  ])('rejects %j', (value, problem) => {
    expect(parseConfig(value)).toBe(problem);
  });
});
