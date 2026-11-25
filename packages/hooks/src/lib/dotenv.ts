import { readFileSync } from 'node:fs';

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

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
