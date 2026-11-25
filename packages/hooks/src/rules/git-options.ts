// Long options of `git push` and `git commit`, and git's rule for shortening them: a prefix that
// matches exactly one option, or its `--no-` form, stands for that option (`--no-verif`,
// `--force-w`). A prefix that matches several is an error in git, so it cannot do harm.

const options = (names: string): readonly string[] => {
  const list = names.split(' ');
  const negated = list.map((name) => (name.startsWith('no-') ? name.slice(3) : `no-${name}`));
  return [...new Set([...list, ...negated])];
};

export const PUSH_OPTIONS = options(
  'all branches prune mirror dry-run porcelain delete tags follow-tags signed atomic push-option ' +
    'receive-pack exec force-with-lease force force-if-includes repo set-upstream thin quiet ' +
    'verbose progress recurse-submodules verify ipv4 ipv6',
);

export const COMMIT_OPTIONS = options(
  'all patch reuse-message reedit-message fixup squash reset-author short branch porcelain long ' +
    'null file author date message template signoff trailer verify allow-empty ' +
    'allow-empty-message cleanup edit amend post-rewrite include only pathspec-from-file ' +
    'pathspec-file-nul untracked-files verbose quiet dry-run status gpg-sign',
);

/**
 * The full name of a `--long` option as git reads it, or undefined if it matches no option or
 * more than one. `--force-w=x` gives `force-with-lease`.
 */
export function longOption(arg: string, known: readonly string[]): string | undefined {
  const name = arg.slice(2).split('=')[0] ?? '';
  if (name === '') return undefined;
  if (known.includes(name)) return name;
  const matches = known.filter((option) => option.startsWith(name));
  return matches.length === 1 ? matches[0] : undefined;
}
