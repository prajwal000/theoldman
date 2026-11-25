// @ts-check
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildHooks } from '../packages/hooks/build.mjs';

/** @param {string} dir */
function listFiles(dir) {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

/** @param {string} file */
function readNormalized(file) {
  // A Windows checkout with CRLF line endings is not a stale bundle.
  return readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
}

/**
 * Lists how `actualDir` differs from `expectedDir`: missing, extra and changed files.
 *
 * @param {string} expectedDir freshly built bundles
 * @param {string} actualDir committed bundles
 * @returns {string[]}
 */
export function diffDirs(expectedDir, actualDir) {
  const expected = listFiles(expectedDir);
  const actual = listFiles(actualDir);
  return [
    ...expected.filter((name) => !actual.includes(name)).map((name) => `missing: ${name}`),
    ...actual.filter((name) => !expected.includes(name)).map((name) => `extra: ${name}`),
    ...expected
      .filter((name) => actual.includes(name))
      .filter(
        (name) => readNormalized(join(expectedDir, name)) !== readNormalized(join(actualDir, name)),
      )
      .map((name) => `changed: ${name}`),
  ];
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const committed = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugin', 'scripts');
  const fresh = mkdtempSync(join(tmpdir(), 'theoldman-built-'));
  try {
    await buildHooks({ outDir: fresh });
    const differences = diffDirs(fresh, committed);
    if (differences.length > 0) {
      process.stderr.write(
        `plugin/scripts is stale. Run pnpm build and commit the result.\n${differences.join('\n')}\n`,
      );
      process.exitCode = 1;
    } else {
      process.stdout.write('plugin/scripts is up to date.\n');
    }
  } finally {
    rmSync(fresh, { recursive: true, force: true });
  }
}
