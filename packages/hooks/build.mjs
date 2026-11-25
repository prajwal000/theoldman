// @ts-check
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const packageDir = dirname(fileURLToPath(import.meta.url));

/**
 * Bundles every `*.ts` file in `entriesDir` into `<name>.mjs` in `outDir`, replacing what was
 * there. Bundles stay unminified so users can read exactly what runs on their machine.
 *
 * @param {{ entriesDir?: string, outDir?: string }} [options]
 * @returns {Promise<string[]>} the bundle file names written
 */
export async function buildHooks({
  entriesDir = join(packageDir, 'src', 'entries'),
  outDir = join(packageDir, '..', '..', 'plugin', 'scripts'),
} = {}) {
  const entries = existsSync(entriesDir)
    ? readdirSync(entriesDir).filter((name) => name.endsWith('.ts'))
    : [];
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  if (entries.length === 0) return [];
  await build({
    entryPoints: entries.map((name) => join(entriesDir, name)),
    outdir: outDir,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    minify: false,
    legalComments: 'none',
    charset: 'utf8',
    // Fixed so the `// src/...` path comments esbuild writes are the same on every machine.
    absWorkingDir: packageDir,
    logLevel: 'warning',
  });
  return entries.map((name) => name.replace(/\.ts$/, '.mjs'));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const written = await buildHooks();
  process.stdout.write(`Built ${String(written.length)} hook bundle(s) into plugin/scripts.\n`);
}
