import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cappedFindings,
  recordCappedFindings,
  recordTouchedFile,
  stateDir,
  touchedFiles,
} from '../../src/lib/state.js';

let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'theoldman-session-'));
});
afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe('touched files', () => {
  it('are empty before anything is recorded', () => {
    expect(touchedFiles(project, 's1')).toEqual([]);
  });

  it('record each file once, in order, per session', () => {
    recordTouchedFile(project, 's1', 'src/a.ts');
    recordTouchedFile(project, 's1', 'src/b.ts');
    recordTouchedFile(project, 's1', 'src/a.ts');
    recordTouchedFile(project, 's2', 'README.md');
    expect(touchedFiles(project, 's1')).toEqual(['src/a.ts', 'src/b.ts']);
    expect(touchedFiles(project, 's2')).toEqual(['README.md']);
    expect(JSON.parse(readFileSync(join(stateDir(project), 's1', 'touched.json'), 'utf8'))).toEqual(
      ['src/a.ts', 'src/b.ts'],
    );
  });

  it('read a corrupt file as empty', () => {
    mkdirSync(join(stateDir(project), 's1'), { recursive: true });
    writeFileSync(join(stateDir(project), 's1', 'touched.json'), '{"not": "a list"}');
    expect(touchedFiles(project, 's1')).toEqual([]);
  });

  it('refuse a session id that could form a path', () => {
    expect(() => {
      recordTouchedFile(project, '../x', 'a.ts');
    }).toThrow('invalid session id');
  });
});

describe('capped findings', () => {
  it('are empty before anything is recorded, and clearing nothing writes nothing', () => {
    expect(cappedFindings(project, 's1')).toEqual({});
    recordCappedFindings(project, 's1', 'src/a.ts', []);
    expect(touchedFiles(project, 's1')).toEqual([]);
    expect(cappedFindings(project, 's1')).toEqual({});
  });

  it('replace the findings for a file and clear them when the file is fixed', () => {
    recordCappedFindings(project, 's1', 'src/a.ts', ['OLDMAN-C01 src/a.ts:1 x']);
    recordCappedFindings(project, 's1', 'src/b.ts', ['OLDMAN-Q04 src/b.ts:2 y']);
    recordCappedFindings(project, 's1', 'src/a.ts', ['OLDMAN-C04 src/a.ts:3 z']);
    expect(cappedFindings(project, 's1')).toEqual({
      'src/a.ts': ['OLDMAN-C04 src/a.ts:3 z'],
      'src/b.ts': ['OLDMAN-Q04 src/b.ts:2 y'],
    });
    recordCappedFindings(project, 's1', 'src/a.ts', []);
    expect(cappedFindings(project, 's1')).toEqual({ 'src/b.ts': ['OLDMAN-Q04 src/b.ts:2 y'] });
  });

  it('drop entries that are not lists of strings', () => {
    mkdirSync(join(stateDir(project), 's1'), { recursive: true });
    writeFileSync(
      join(stateDir(project), 's1', 'capped.json'),
      JSON.stringify({ 'a.ts': ['ok'], 'b.ts': 'no', 'c.ts': [1] }),
    );
    expect(cappedFindings(project, 's1')).toEqual({ 'a.ts': ['ok'] });
    writeFileSync(join(stateDir(project), 's1', 'capped.json'), '[]');
    expect(cappedFindings(project, 's1')).toEqual({});
  });
});
