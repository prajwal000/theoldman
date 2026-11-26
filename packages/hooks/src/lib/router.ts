export type Category = 'auth' | 'db' | 'api' | 'infra' | 'tests' | 'git' | 'docs' | 'ui';
export type Route = Category | 'trivial';

// Whole words only, so `ci` is not found in `decide` and `pr` not in `print`. The order breaks ties
// between categories with the same number of matches: the riskier rules come first.
const KEYWORDS: readonly (readonly [Category, RegExp])[] = [
  [
    'auth',
    /\b(auth\w*|log ?ins?|log ?outs?|logged (in|out)|sign ?(ins?|ups?|outs?)|passwords?|sessions?|jwts?|oauth|sso|tokens?|permissions?|roles?|rbac|admins?|cookies?|csrf|2fa|mfa)\b/g,
  ],
  [
    'db',
    /\b(databases?|db|sql|postgres\w*|mysql|sqlite|mongo\w*|prisma|drizzle|orm|migrations?|migrate|schemas?|tables?|columns?|index(es)?|indices|quer(y|ies)|seeds?|transactions?|n\+1|backfill)\b/g,
  ],
  [
    'api',
    /\b(apis?|endpoints?|routes?|rest|graphql|grpc|controllers?|handlers?|webhooks?|express|fastify|middleware|requests?|responses?|post|get|put|patch|status codes?|rate limit\w*)\b/g,
  ],
  [
    'infra',
    /\b(docker\w*|compose|containers?|deploy\w*|ci|pipelines?|kubernetes|k8s|helm|terraform|nginx|aws|s3|gcp|azure|vercel|github actions|workflows?|env vars?|environment variables?|servers?|dns|cdn|monitoring)\b/g,
  ],
  [
    'tests',
    /\b(tests?|testing|tested|specs?|vitest|jest|mocha|playwright|cypress|coverage|mocks?|mocking|stubs?|fixtures?|e2e|tdd|assertions?|flaky)\b/g,
  ],
  [
    'git',
    /\b(git|commits?|branch(es)?|merge[sd]?|rebase[sd]?|prs?|pull requests?|push|cherry-pick|stash|squash|conflicts?)\b/g,
  ],
  [
    'docs',
    /\b(readme|docs?|documentation|document|changelog|adrs?|jsdoc|tsdoc|comments?|env\.example)\b/g,
  ],
  [
    'ui',
    /\b(ui|ux|components?|buttons?|pages?|css|styles?|styling|tailwind|layouts?|react|jsx|tsx|modals?|forms?|frontend|a11y|accessibility|responsive|mobile|dark mode|navbar|sidebar|animations?)\b/g,
  ],
];

// A pasted log or file can make a prompt very long; the request itself is near the start.
const MAX_PROMPT_CHARS = 10_000;

/** Categories the prompt mentions, most matches first; empty when it mentions none. */
export function classify(prompt: string): Category[] {
  const text = prompt.slice(0, MAX_PROMPT_CHARS).toLowerCase();
  return KEYWORDS.map(([category, pattern]) => ({
    category,
    count: text.match(pattern)?.length ?? 0,
  }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count)
    .map(({ category }) => category);
}

export function route(prompt: string): Route {
  return classify(prompt)[0] ?? 'trivial';
}

/** Takes lines from each section in turn, so two categories share the space, up to `max`. */
export function pickLines(sections: readonly (readonly string[])[], max: number): string[] {
  const picked: string[] = [];
  const longest = Math.max(0, ...sections.map((lines) => lines.length));
  for (let i = 0; i < longest; i += 1) {
    for (const lines of sections) {
      const line = lines[i];
      if (line !== undefined && picked.length < max) picked.push(line);
    }
  }
  return picked;
}
