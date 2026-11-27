// Docs in sync: theoldman's own docs rules (OLDMAN-D01 to D04), the same code its Stop hook runs,
// on the run's diff. The plugin reads the project directly; here the project lives in the
// scoring container, so the rules get the final texts it reported and the starter's package.json
// files from the task folder instead.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, relative } from 'node:path';
import { parseDiff } from '../../../packages/hooks/src/lib/diff.js';
import { dotenvNames } from '../../../packages/hooks/src/lib/dotenv.js';
import {
  type DocsContext,
  packageChanges,
} from '../../../packages/hooks/src/rules/docs-context.js';
import { checkDocs } from '../../../packages/hooks/src/rules/docs.js';

export interface DocsInput {
  readonly diff: string;
  /** Final text of each changed file, from the scoring container. */
  readonly files: Readonly<Record<string, string>>;
  /** Final text of every .env.example in the project. */
  readonly envExamples: Readonly<Record<string, string>>;
  readonly starterDir: string;
  /** Claude's final message, where OLDMAN-D03 looks for the reason for a new dependency. */
  readonly summary: string;
}

export interface DocsScore {
  readonly findings: number;
  readonly byRule: Readonly<Record<string, number>>;
}

/** The starter's version of a file, or undefined if it has none or the path leaves the starter. */
function starterText(starterDir: string, path: string): string | undefined {
  const rel = normalize(path);
  if (isAbsolute(rel) || relative(starterDir, join(starterDir, rel)).startsWith('..')) {
    return undefined;
  }
  const full = join(starterDir, rel);
  return existsSync(full) && statSync(full).isFile() ? readFileSync(full, 'utf8') : undefined;
}

export function scoreDocs(input: DocsInput): DocsScore {
  const files = parseDiff(input.diff);
  const exampleVars = new Set(
    Object.values(input.envExamples).flatMap((text) => [...dotenvNames(text)]),
  );
  const packages = files
    .filter((file) => file.status !== 'deleted' && /(^|\/)package\.json$/.test(file.path))
    .map((file) =>
      packageChanges(
        file,
        input.files[file.path],
        file.status === 'added' ? undefined : starterText(input.starterDir, file.path),
      ),
    );
  const context: DocsContext = {
    files,
    exampleVars,
    newDependencies: packages.flatMap((changes) => changes.dependencies),
    scriptChanges: packages.flatMap((changes) => changes.scripts),
    summary: input.summary,
  };
  const byRule: Record<string, number> = {};
  const findings = checkDocs(context);
  for (const { id } of findings) byRule[id] = (byRule[id] ?? 0) + 1;
  return { findings: findings.length, byRule };
}
