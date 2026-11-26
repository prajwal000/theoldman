import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const skillsDir = new URL('../../../plugin/skills/', import.meta.url);
const TOPIC_SKILLS = [
  'oldman-database',
  'oldman-docs',
  'oldman-git',
  'oldman-security',
  'oldman-testing',
];
// Claude Code ignores unknown frontmatter fields silently, so a typo such as `user-invokable`
// would go unnoticed. Only these names are allowed.
const FIELDS = ['name', 'description', 'user-invocable', 'disable-model-invocation'];

const read = (skill: string): string =>
  readFileSync(new URL(`${skill}/SKILL.md`, skillsDir), 'utf8').replace(/\r\n/g, '\n');

function frontmatter(text: string): Record<string, string> {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '';
  return Object.fromEntries(
    block.split('\n').map((line) => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
    }),
  );
}

const ruleSkills = readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('oldman-'))
  .map((entry) => entry.name)
  .sort();

describe('rule skills', () => {
  it('are the core rules and the five topic skills', () => {
    expect(ruleSkills).toEqual(['oldman-rules', ...TOPIC_SKILLS].sort());
  });

  it.each(ruleSkills)(
    '%s has only known frontmatter fields, its folder name and a description',
    (skill) => {
      const fields = frontmatter(read(skill));
      expect(Object.keys(fields).filter((key) => !FIELDS.includes(key))).toEqual([]);
      expect(fields.name).toBe(skill);
      // The listing truncates description and when_to_use together at 1,536 characters.
      expect(fields.description?.length).toBeGreaterThan(60);
      expect(fields.description?.length).toBeLessThanOrEqual(1536);
      expect(fields.description).toMatch(/\bUse (when|whenever)\b/);
      // Rule skills are for Claude to load; they are hidden from the / menu.
      expect(fields['user-invocable']).toBe('false');
    },
  );
});

describe.each(TOPIC_SKILLS)('%s', (skill) => {
  const text = read(skill);

  it('stays under 120 lines', () => {
    expect(text.trimEnd().split('\n').length).toBeLessThan(120);
  });

  it("has do and don't rules", () => {
    for (const heading of ['## Do', "## Don't"]) {
      const section = text.split(`\n${heading}\n`)[1]?.split('\n## ')[0] ?? '';
      expect(section.match(/^- /gm)?.length ?? 0).toBeGreaterThanOrEqual(3);
    }
  });

  it('has one bad and one good example, each with code', () => {
    const example = text.split('\n## Example\n')[1] ?? '';
    expect(example.match(/^### (Bad|Good)$/gm)).toEqual(['### Bad', '### Good']);
    expect(example.match(/^```\w+$/gm)).toHaveLength(2);
  });
});
