// Docs rules, run on the session diff by the Stop hook. They return findings only; how they
// reach Claude or the user is the Stop hook's job.
//
// OLDMAN-D01 (Fix): code reads `process.env.X` in an added line and no .env.example lists X.
// OLDMAN-D02 (Warn): API route files changed and no OpenAPI or route doc did; the reviewer
// confirms whether the docs need it. A README edit that mentions a Next.js route's URL counts as
// documenting that route.
// OLDMAN-D03 (Warn): a package.json gained a dependency, no ADR changed, and Claude's summary
// does not name the dependency.
// OLDMAN-D04 (Warn): package.json scripts or setup files changed and no README did.

import type { DiffFile } from '../lib/diff.js';
import type { Finding } from '../lib/rules.js';
import type { DocsContext } from './docs-context.js';

export type DocsRule = (context: DocsContext) => Finding[];

const CODE_FILE = /\.[cm]?[jt]sx?$/;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;
// `\b` after the name stops backtracking to a shorter name that would dodge the `=` check.
const ENV_READ =
  /\bprocess\.env(?:\.([A-Za-z_]\w*)\b|\[\s*(['"`])([A-Za-z_]\w*)\2\s*\])(?!\s*=(?!=))/g;
// Set by the runtime or CI, not by the project's own env file.
const RUNTIME_VARS: ReadonlySet<string> = new Set(['NODE_ENV', 'CI']);

const TEST_FILE = /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const ROUTE_FILE = [
  /(^|\/)app\/(.+\/)?route\.[cm]?[jt]s$/,
  /(^|\/)pages\/api\//,
  /(^|\/)(routes|controllers|api)\//,
  /\.(controller|routes?|router)\.[cm]?[jt]s$/,
];
const API_DOC =
  /(^|\/)(openapi|swagger)[^/]*\.(json|ya?ml)$|(^|\/)docs\/(.+\/)?(api|routes?)([^/]*\.md$|\/)|(^|\/)(api|routes)\.md$/;
const ADR = /(^|\/)(adr|decisions)\/[^/]+\.md$/;
const SETUP_FILE =
  /(^|\/)(dockerfile|docker-compose[^/]*\.ya?ml|compose[^/]*\.ya?ml|\.nvmrc|\.node-version|\.tool-versions|makefile|pnpm-workspace\.yaml)$/;
const README = /(^|\/)readme[^/]*$/;

const lower = (file: DiffFile): string => file.path.toLowerCase();
const firstLine = (file: DiffFile): number => file.addedLines[0]?.line ?? 1;

function listed(paths: readonly string[]): string {
  const more = paths.length - 3;
  return paths.slice(0, 3).join(', ') + (more > 0 ? ` and ${String(more)} more` : '');
}

export const d01: DocsRule = ({ files, exampleVars }) => {
  const seen = new Set<string>();
  return files
    .filter((file) => file.status !== 'deleted' && CODE_FILE.test(lower(file)))
    .flatMap((file) =>
      file.addedLines
        .filter(({ text }) => !COMMENT_LINE.test(text))
        .flatMap(({ line, text }) =>
          [...text.matchAll(ENV_READ)].flatMap((match) => {
            const name = match[1] ?? match[3] ?? '';
            if (exampleVars.has(name) || RUNTIME_VARS.has(name) || seen.has(name)) return [];
            seen.add(name);
            return [
              {
                id: 'OLDMAN-D01',
                action: 'fix',
                file: file.path,
                line,
                message: `process.env.${name} is read here but no .env.example lists ${name}. Add ${name}= with a placeholder value and a short comment.`,
              } satisfies Finding,
            ];
          }),
        ),
    );
};

/** The URL of a Next.js route file, such as `/api/orders/[id]`; undefined for other routes. */
function routeUrl(path: string): string | undefined {
  const app = /(?:^|\/)app\/(.*?)\/?route\.[cm]?[jt]s$/.exec(path)?.[1];
  // Route groups such as `(shop)` are folders only, not part of the URL.
  if (app !== undefined)
    return `/${app
      .split('/')
      .filter((s) => !/^\(.*\)$/.test(s))
      .join('/')}`;
  const pages = /(?:^|\/)pages\/(api\/.*?)(?:\/index)?\.[cm]?[jt]s$/.exec(path)?.[1];
  return pages === undefined ? undefined : `/${pages}`;
}

/** Matches `url` in text, with dynamic segments written as `[id]`, `:id`, `{id}` or `<id>`. */
function urlPattern(url: string): RegExp {
  const segments = url
    .split('/')
    .map((segment) =>
      /^\[.+\]$/.test(segment)
        ? String.raw`(?:\[[^\]/]+\]|:\w+|\{\w+\}|<\w+>)`
        : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    );
  return new RegExp(`${segments.join('/')}(?![\\w/[{:<-])`, 'i');
}

export const d02: DocsRule = ({ files }) => {
  const readmeLines = files
    .filter((file) => README.test(lower(file)))
    .flatMap((file) => file.addedLines.map(({ text }) => text));
  // A route the README now mentions by URL counts as documented.
  const documented = (file: DiffFile): boolean => {
    const url = routeUrl(file.path);
    return url !== undefined && readmeLines.some((text) => urlPattern(url).test(text));
  };
  const routes = files.filter((file) => {
    const path = lower(file);
    return CODE_FILE.test(path) && !TEST_FILE.test(path) && ROUTE_FILE.some((re) => re.test(path));
  });
  const undocumented = routes.filter((file) => !documented(file));
  const [first] = undocumented;
  if (first === undefined || files.some((file) => API_DOC.test(lower(file)))) return [];
  return [
    {
      id: 'OLDMAN-D02',
      action: 'warn',
      file: first.path,
      line: firstLine(first),
      message: `API route files changed (${listed(undocumented.map((file) => file.path))}) but no OpenAPI or route docs did, and the README does not mention them. Check whether the API docs need an update.`,
    },
  ];
};

export const d03: DocsRule = ({ files, newDependencies, summary }) => {
  if (files.some((file) => file.status !== 'deleted' && ADR.test(lower(file)))) return [];
  const said = summary.toLowerCase();
  return newDependencies
    .filter(({ name }) => !said.includes(name.toLowerCase()))
    .map(({ file, line, name }) => ({
      id: 'OLDMAN-D03',
      action: 'warn',
      file,
      line,
      message: `New dependency ${name} has no ADR and no reason in your summary. Say in one line why it is needed, or add an ADR.`,
    }));
};

export const d04: DocsRule = ({ files, scriptChanges }) => {
  if (files.some((file) => README.test(lower(file)))) return [];
  const setup = files.filter((file) => SETUP_FILE.test(lower(file)));
  const changed = [
    ...scriptChanges.map(({ file, line }) => ({ file, line, what: `${file} scripts` })),
    ...setup.map((file) => ({ file: file.path, line: firstLine(file), what: file.path })),
  ];
  const [first] = changed;
  if (first === undefined) return [];
  return [
    {
      id: 'OLDMAN-D04',
      action: 'warn',
      file: first.file,
      line: first.line,
      message: `${listed(changed.map(({ what }) => what))} changed but no README did. Check that the setup steps and commands in the README are still right.`,
    },
  ];
};

/** Every docs finding for the context, ordered by rule. */
export function checkDocs(context: DocsContext): Finding[] {
  return [d01, d02, d03, d04].flatMap((rule) => rule(context));
}
