import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isRecord, parseJson } from './input.js';

export interface PackageScripts {
  /** Directory of the package.json; npm runs its scripts there. */
  readonly dir: string;
  readonly scripts: ReadonlyMap<string, string>;
}

function readScripts(file: string): ReadonlyMap<string, string> {
  let value: unknown;
  try {
    value = parseJson(readFileSync(file, 'utf8'));
  } catch {
    // An unreadable package.json has no scripts we can check.
    return new Map();
  }
  const scripts = isRecord(value) ? value.scripts : undefined;
  if (!isRecord(scripts)) return new Map();
  return new Map(
    Object.entries(scripts).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/**
 * Scripts of the nearest package.json at or above `startDir`, the way npm finds the package it
 * runs a script from. Only reads the file; nothing in it is executed.
 */
export function findPackageScripts(startDir: string): PackageScripts | undefined {
  let dir = resolve(startDir);
  for (;;) {
    const file = join(dir, 'package.json');
    if (existsSync(file)) return { dir, scripts: readScripts(file) };
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
