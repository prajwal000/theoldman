import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

describe('command skills', () => {
  const COMMANDS = ['docs', 'init', 'off', 'on', 'review'];
  const COMMAND_FIELDS = ['name', 'description', 'disable-model-invocation', 'allowed-tools'];
  const USER_ONLY = new Set(['init', 'off', 'on']);
  const scriptsDir = new URL('../../../plugin/scripts/', import.meta.url);

  it('are init, review, docs, off and on', () => {
    const commands = readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('oldman-'))
      .map((entry) => entry.name)
      .sort();
    expect(commands).toEqual(COMMANDS);
  });

  it.each(COMMANDS)('%s has only known fields, its folder name and a description', (skill) => {
    const fields = frontmatter(read(skill));
    expect(Object.keys(fields).filter((key) => !COMMAND_FIELDS.includes(key))).toEqual([]);
    expect(fields.name).toBe(skill);
    expect(fields.description?.length).toBeGreaterThan(40);
  });

  it.each(COMMANDS)('%s is user-only exactly when it changes theoldman itself', (skill) => {
    const fields = frontmatter(read(skill));
    expect(fields['disable-model-invocation']).toBe(USER_ONLY.has(skill) ? 'true' : undefined);
  });

  it.each(COMMANDS)(
    '%s runs only plugin scripts that exist, quoted, and pre-approves exactly those for both shells',
    (skill) => {
      const text = read(skill);
      const scripts = [
        ...text.matchAll(/!`node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/([\w-]+\.mjs)"[^`]*`/g),
      ].map((match) => match[1] ?? '');
      expect(text.match(/!`/g)?.length ?? 0).toBe(scripts.length);
      const expected = scripts
        .flatMap((script) => [
          `Bash(node "\${CLAUDE_PLUGIN_ROOT}/scripts/${script}" *)`,
          `PowerShell(node "\${CLAUDE_PLUGIN_ROOT}/scripts/${script}" *)`,
        ])
        .join(' ');
      expect(frontmatter(text)['allowed-tools'] ?? '').toBe(expected);
      for (const script of scripts) {
        expect(existsSync(new URL(script, scriptsDir)), script).toBe(true);
      }
    },
  );

  it('pause and resume pass the mode and the project directory to the pause script', () => {
    for (const mode of ['off', 'on']) {
      expect(read(mode)).toContain(
        `!\`node "\${CLAUDE_PLUGIN_ROOT}/scripts/oldman-pause.mjs" ${mode} "\${CLAUDE_PROJECT_DIR}"\``,
      );
    }
  });
});
