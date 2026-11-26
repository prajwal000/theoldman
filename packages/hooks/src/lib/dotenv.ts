import { readFileSync } from 'node:fs';

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;
// In an example file a commented-out `# NAME=` still documents an optional variable.
const LISTED = /^\s*(?:#\s*)?(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/** Every variable name a dotenv example file lists, including commented-out `# NAME=` lines. */
export function dotenvNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const name = LISTED.exec(line)?.[1];
    if (name !== undefined) names.add(name);
  }
  return names;
}

/**
 * The value of `name` in a dotenv file, or undefined if the file or the name is missing.
 * Handles `export`, quotes and trailing ` # comments`; it does not expand `${VAR}`.
 */
export function readDotenv(file: string, name: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    // A missing or unreadable file simply has no value to give.
    return undefined;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = LINE.exec(line);
    if (match?.[1] !== name) continue;
    const raw = match[2] ?? '';
    const quoted = /^(["'])(.*)\1$/.exec(raw);
    return quoted ? (quoted[2] ?? '') : raw.replace(/\s+#.*$/, '');
  }
  return undefined;
}
