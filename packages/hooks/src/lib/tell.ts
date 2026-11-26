import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Rule lines for the Tell hooks, kept in the oldman-rules skill so skills stay the only rule source. */
export const TELL_FILE = join('skills', 'oldman-rules', 'tell.md');

/**
 * The `- ` bullet lines under each `## <name>` heading of the Tell file in `pluginRoot`. Other
 * text in the file is for maintainers and is not returned.
 */
export function readTellSections(pluginRoot: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of readFileSync(join(pluginRoot, TELL_FILE), 'utf8').split(/\r?\n/)) {
    const name = /^## (\S.*)$/.exec(line)?.[1];
    if (name !== undefined) {
      current = [];
      sections.set(name.trim(), current);
    } else if (line.startsWith('- ')) {
      current?.push(line);
    }
  }
  return sections;
}
