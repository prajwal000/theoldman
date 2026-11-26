// Sets a project up for /theoldman:init, which runs it as a pre-executed command
// (`oldman-init.mjs <project dir>`): writes .theoldman.json with the stack detected from
// package.json unless one exists, and adds a short theoldman section to CLAUDE.md once. It never
// overwrites a file, and never writes through a symbolic link, which a cloned repo could point
// anywhere. It does not touch .gitignore: .theoldman/ ignores itself.

import { appendFileSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILE } from '../lib/config.js';
import { runHook, say } from '../lib/output.js';
import { detectStack } from '../lib/stack.js';

const HEADING = '## theoldman';
const SECTION = [
  HEADING,
  '',
  'This project uses the theoldman plugin. Its rules are in the plugin skills, and `.theoldman.json` holds the settings.',
  '',
  '- Guards block force-pushes to main, `--no-verify`, deletes outside the project, destructive commands on non-local databases, writes to `.env` and key files, and secrets.',
  '- Edits are checked for comment and code-quality problems, and changed code is reviewed by the reviewer and verifier subagents before Claude finishes.',
  '- `/theoldman:off` pauses the checks and the review (the guards stay on); `/theoldman:on` turns them back on.',
  '',
].join('\n');

function kind(path: string): 'missing' | 'file' | 'link' | 'other' {
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) return 'link';
    return stats.isFile() ? 'file' : 'other';
  } catch {
    // lstat fails only when nothing is there.
    return 'missing';
  }
}

function writeConfig(projectDir: string): string {
  const path = join(projectDir, CONFIG_FILE);
  if (kind(path) !== 'missing') return `Kept the existing ${CONFIG_FILE}.`;
  const stack = detectStack(projectDir);
  writeFileSync(path, `${JSON.stringify({ level: 'standard', stack }, null, 2)}\n`, { flag: 'wx' });
  return stack.length > 0
    ? `Wrote ${CONFIG_FILE} with the stack detected from package.json: ${stack.join(', ')}.`
    : `Wrote ${CONFIG_FILE}; no stack was detected from package.json, so "stack" is empty.`;
}

function addSection(projectDir: string): string {
  const path = join(projectDir, 'CLAUDE.md');
  const found = kind(path);
  if (found === 'link' || found === 'other')
    return 'Left CLAUDE.md alone: it is not a regular file.';
  const text = found === 'file' ? readFileSync(path, 'utf8') : '';
  if (text.split(/\r?\n/).includes(HEADING)) return 'CLAUDE.md already has a theoldman section.';
  const gap = text === '' ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  appendFileSync(path, gap + SECTION);
  return found === 'file'
    ? 'Added a theoldman section to CLAUDE.md.'
    : 'Created CLAUDE.md with a theoldman section.';
}

runHook(() => {
  const [projectDir = process.cwd()] = process.argv.slice(2);
  return say([writeConfig(projectDir), addSection(projectDir)].join('\n'));
});
