import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRecord, parseJson } from './input.js';

const MARKERS = [
  ['typescript', ['typescript']],
  ['nextjs', ['next']],
  ['react', ['react']],
  ['prisma', ['prisma', '@prisma/client']],
  ['express', ['express']],
  ['vitest', ['vitest']],
  ['jest', ['jest']],
] as const;

export type StackId = (typeof MARKERS)[number][0];

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

/** The stack named by the dependencies in the project's root `package.json`, in a fixed order. */
export function detectStack(projectDir: string): StackId[] {
  let raw: string;
  try {
    raw = readFileSync(join(projectDir, 'package.json'), 'utf8');
  } catch {
    // No readable package.json just means nothing to detect; the session still gets the rules.
    return [];
  }
  const manifest = parseJson(raw);
  if (!isRecord(manifest)) return [];
  const names = new Set(
    DEPENDENCY_FIELDS.flatMap((field) => {
      const dependencies = manifest[field];
      return isRecord(dependencies) ? Object.keys(dependencies) : [];
    }),
  );
  return MARKERS.filter(([, packages]) => packages.some((name) => names.has(name))).map(
    ([id]) => id,
  );
}
