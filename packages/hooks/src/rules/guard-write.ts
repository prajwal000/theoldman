// Guard rules for the Write and Edit tools, decided by the file path alone.
//
// OLDMAN-G05 blocks writing an env file: `.env` or `.env.<anything>`, except `.env.example`.
// OLDMAN-G06 blocks writing a private key file: `*.pem`, `*.key`, and SSH keys named
// `id_rsa*`, `id_dsa*`, `id_ecdsa*` or `id_ed25519*`. Names compare case-insensitively, since
// Windows and macOS file systems usually do, and paths can come in any of the forms
// lib/paths.ts normalizes.
// OLDMAN-G07 limits theoldman's docs-writer subagent to documentation files. Claude Code names
// the subagent in `agent_type`, which the model cannot set, so this does not rely on the agent
// following its prompt. Other agents and the main agent are not affected. Agent instruction and
// config files are blocked even when they are Markdown: the docs writer reads untrusted repository
// text, and an edit there could persist a prompt injection into later sessions.

import { isStrictlyInside, normalizePath, resolvePath, toProjectRelative } from '../lib/paths.js';
import type { Finding, Rule } from '../lib/rules.js';
import type { Violation } from './guard-context.js';

const SSH_KEY = /^id_(?:rsa|dsa|ecdsa|ed25519)/;
const KEY_EXTENSION = /\.(?:pem|key)$/;

export const DOCS_WRITER = 'theoldman:oldman-docs-writer';
// README and CHANGELOG with a doc extension or none, so `readme.test.ts` does not count.
const DOC_NAME =
  /^(?:(?:readme|changelog)(?:[.-][\w-]+)*\.(?:md|mdx|markdown|txt|rst|adoc)|readme|changelog|\.env\.example|(?:openapi|swagger)(?:\.[\w-]+)*\.(?:json|ya?ml))$/;
const ROOT_DOC_NAME = /^(?:contributing|security|code_of_conduct|support)\.md$/;
const INSTRUCTION_NAME =
  /^(?:claude(?:\.local)?\.md|agents\.md|review\.md|\.theoldman\.json|licen[cs]e(?:\.[\w-]+)?)$/;
const INSTRUCTION_DIRS: readonly string[] = ['.claude', '.github'];

function fileName(path: string): string {
  return (normalizePath(path).split('/').pop() ?? '').toLowerCase();
}

/** The G05 or G06 violation for writing `path`, if it is an env or private key file. */
export function checkPath(path: string): Violation | undefined {
  const name = fileName(path);
  if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) {
    return {
      id: 'OLDMAN-G05',
      message: `${path} is an env file and can hold real secrets. Add the variable name to .env.example instead, and ask the user to put the value in their own env file.`,
    };
  }
  if (SSH_KEY.test(name) || KEY_EXTENSION.test(name)) {
    return {
      id: 'OLDMAN-G06',
      message: `${path} looks like a private key or certificate file. Do not create or change key files; ask the user to manage them.`,
    };
  }
  return undefined;
}

/** `path` relative to the project and lower-cased, with `..` resolved; undefined if outside. */
function projectRelative(path: string, projectDir: string): string | undefined {
  const root = resolvePath(projectDir, '/');
  if (!isStrictlyInside(path, root)) return undefined;
  return toProjectRelative(resolvePath(path, root), root).toLowerCase();
}

/** Agent instructions and config: CLAUDE.md, AGENTS.md, `.claude/`, `.github/` and the like. */
function isInstruction(relative: string): boolean {
  const parts = relative.split('/');
  return (
    INSTRUCTION_NAME.test(parts.at(-1) ?? '') ||
    parts.slice(0, -1).some((part) => INSTRUCTION_DIRS.includes(part))
  );
}

function isDoc(relative: string): boolean {
  const name = relative.split('/').pop() ?? '';
  return (
    DOC_NAME.test(name) ||
    (relative === name && ROOT_DOC_NAME.test(name)) ||
    (relative.startsWith('docs/') && name.endsWith('.md'))
  );
}

/**
 * True for a documentation file inside the project that is not an agent instruction or config
 * file: README and CHANGELOG files, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT and SUPPORT at the
 * root, Markdown under `docs/`, `.env.example`, and OpenAPI or Swagger files. `..` is resolved
 * first, so `docs/../src/a.md` is `src/a.md`.
 */
export function isDocPath(path: string, projectDir: string): boolean {
  const relative = projectRelative(path, projectDir);
  return relative !== undefined && !isInstruction(relative) && isDoc(relative);
}

/**
 * The G07 violation when the docs writer writes `path` and it is not a documentation file. A
 * relative `path` is taken from `cwd`, which can be a subdirectory of the project.
 */
export function checkAgentPath(
  path: string,
  projectDir: string,
  agentType: string | undefined,
  cwd = projectDir,
): Violation | undefined {
  if (agentType !== DOCS_WRITER) return undefined;
  const relative = projectRelative(resolvePath(path, cwd), projectDir);
  if (relative !== undefined && isInstruction(relative)) {
    return {
      id: 'OLDMAN-G07',
      message: `${path} holds agent instructions or config. The docs writer may not change it, because an edit there could persist a prompt injection. Describe the change in your reply instead.`,
    };
  }
  if (relative !== undefined && isDoc(relative)) return undefined;
  return {
    id: 'OLDMAN-G07',
    message: `${path} is not a documentation file. The docs writer may only change README and CHANGELOG files, root CONTRIBUTING, SECURITY, CODE_OF_CONDUCT and SUPPORT files, Markdown under docs/, .env.example and OpenAPI files. Describe the code change in your reply instead of making it.`,
  };
}

/** G07 as a Rule for fixtures: each added line is a path the docs writer would write. */
export function docsWriterRule(projectDir: string): Rule {
  return ({ file, addedLines }) =>
    addedLines.flatMap(({ line, text }) => {
      const violation =
        text.trim() === '' ? undefined : checkAgentPath(text.trim(), projectDir, DOCS_WRITER);
      return violation === undefined
        ? []
        : [{ ...violation, action: 'block', file, line } satisfies Finding];
    });
}

/** The guard as a Rule for fixtures: each added line is a path that would be written. */
export function guardWriteRule(): Rule {
  return ({ file, addedLines }) =>
    addedLines.flatMap(({ line, text }) => {
      const violation = text.trim() === '' ? undefined : checkPath(text.trim());
      return violation === undefined
        ? []
        : [{ ...violation, action: 'block', file, line } satisfies Finding];
    });
}
