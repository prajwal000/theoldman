import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repoRoot = new URL('../../../', import.meta.url);
const nonEmpty = /\S/;

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(new URL(relativePath, repoRoot), 'utf8'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    current = isRecord(current) ? current[key] : undefined;
  }
  return current;
}

describe('plugin manifests', () => {
  it('plugin.json is named theoldman and has the metadata the strict validator wants', () => {
    const manifest = readJson('plugin/.claude-plugin/plugin.json');
    expect(field(manifest, 'name')).toBe('theoldman');
    expect(field(manifest, 'version')).toMatch(nonEmpty);
    expect(field(manifest, 'description')).toMatch(nonEmpty);
    expect(field(manifest, 'author', 'name')).toMatch(nonEmpty);
  });

  it('marketplace.json lists theoldman from ./plugin', () => {
    const marketplace = readJson('.claude-plugin/marketplace.json');
    expect(field(marketplace, 'name')).toBe('theoldman');
    expect(field(marketplace, 'owner', 'name')).toMatch(nonEmpty);
    expect(field(marketplace, 'plugins')).toMatchObject([
      { name: 'theoldman', source: './plugin' },
    ]);
  });

  // Claude Code refuses a hooks.json without the top-level "hooks" wrapper.
  it('hooks.json wraps the event map in a hooks key', () => {
    expect(isRecord(field(readJson('plugin/hooks/hooks.json'), 'hooks'))).toBe(true);
  });
});
