import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Claude Code runs with every permission skipped, so it must never start on the host. The
// runner's only process is `docker`, started from one module; this keeps it that way.
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const sources = readdirSync(SRC)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({ name, text: readFileSync(join(SRC, name), 'utf8') }));

describe('runner processes', () => {
  it('imports child_process only in docker.ts', () => {
    const importers = sources
      .filter(({ text }) =>
        /from 'node:child_process'|require\('(?:node:)?child_process'\)/.test(text),
      )
      .map(({ name }) => name);
    expect(importers).toEqual(['docker.ts']);
    expect(sources.some(({ text }) => /from 'child_process'/.test(text))).toBe(false);
  });

  it('spawns nothing but the docker binary, without a shell', () => {
    const docker = sources.find(({ name }) => name === 'docker.ts')?.text ?? '';
    const calls = [
      ...docker.matchAll(/\b(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\(/g),
    ];
    expect(calls.map((match) => match[1])).toEqual(['spawn']);
    expect(docker).toMatch(
      /spawn\('docker', \[\.\.\.args\], \{ env, stdio: 'pipe', windowsHide: true \}\)/,
    );
    expect(docker).not.toMatch(/shell:/);
  });

  it('builds the permission-skipping flags in one place, used only by the Docker run', () => {
    const users = sources
      .filter(({ text }) => text.includes('bypassPermissions'))
      .map(({ name }) => name);
    expect(users).toEqual(['claude.ts']);
    const callers = sources
      .filter(({ text }) => /\bclaudeArgs\(/.test(text))
      .map(({ name }) => name);
    expect(callers.sort()).toEqual(['claude.ts', 'execute.ts']);
  });
});
