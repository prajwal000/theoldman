import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Category, classify, pickLines, type Route, route } from '../src/lib/router.js';
import { readTellSections } from '../src/lib/tell.js';

// Prompts as people type them, each labelled with the rules it needs most. Some are ambiguous
// on purpose, so the score measures the router rather than the samples.
const SAMPLES: readonly (readonly [string, Route])[] = [
  ['Update the README with the new setup steps', 'docs'],
  ['Add a CHANGELOG entry for the 2.0 release', 'docs'],
  ['Document the config options in the docs folder', 'docs'],
  ['Make the submit button bigger on mobile and fix the layout', 'ui'],
  ['Build a modal component for confirming deletes', 'ui'],
  ['Convert these styles to Tailwind classes', 'ui'],
  ['Add a POST endpoint that creates an invoice', 'api'],
  ['The /orders route returns 500 when the body is empty', 'api'],
  ['Add rate limiting middleware to the Express app', 'api'],
  ['Set up a webhook handler for Stripe events', 'api'],
  ['Add a migration that adds an email column to users', 'db'],
  ['This Prisma query is slow, add an index', 'db'],
  ['Fix the N+1 queries on the orders page', 'db'],
  ['Write a SQL script to backfill the new table', 'db'],
  ['Users stay logged in after logout, fix the session expiry', 'auth'],
  ['Hash passwords with argon2 instead of md5', 'auth'],
  ['Add Google OAuth sign in', 'auth'],
  ['Only admins should be able to delete projects, add a role check', 'auth'],
  ['Write a Dockerfile and a compose file for local dev', 'infra'],
  ['Add a GitHub Actions workflow that runs lint on every PR', 'infra'],
  ['Deploy the app to Vercel', 'infra'],
  ['Add tests for the date parser', 'tests'],
  ['Coverage dropped below 80%, write more unit tests', 'tests'],
  ['The Playwright e2e suite is flaky on CI', 'tests'],
  ['Squash my last three commits and rebase on main', 'git'],
  ['Resolve the merge conflicts in this branch', 'git'],
  ['Open a pull request for this branch', 'git'],
  ['Thanks, that looks good', 'trivial'],
  ['What does idempotent mean?', 'trivial'],
  ['ok continue', 'trivial'],
];

describe('route', () => {
  it('has 30 labelled samples covering every category', () => {
    expect(SAMPLES).toHaveLength(30);
    expect(new Set(SAMPLES.map(([, label]) => label)).size).toBe(9);
  });

  it('classifies at least 26 of the 30 samples correctly', () => {
    const wrong = SAMPLES.filter(([prompt, label]) => route(prompt) !== label).map(
      ([prompt, label]) => `${label} <- ${route(prompt)}: ${prompt}`,
    );
    expect(wrong.length, wrong.join('\n')).toBeLessThanOrEqual(4);
  });
});

describe('classify', () => {
  it('orders categories by matches, breaking ties with the riskier one first', () => {
    expect(classify('Write a Dockerfile for the API')).toEqual(['api', 'infra']);
    expect(classify('fix the login form, the form button is misaligned')).toEqual(['ui', 'auth']);
    expect(classify('fix the login form, the form loses the password')).toEqual(['auth', 'ui']);
  });

  it('matches whole words only', () => {
    expect(classify('decide how to print the reports')).toEqual([]);
    expect(classify('Retest it')).toEqual([]);
  });

  it('reads only the start of a very long prompt', () => {
    expect(classify(`${'x '.repeat(5000)} run the tests`)).toEqual([]);
    expect(classify(`run the tests ${'x '.repeat(5000)}`)).toEqual(['tests']);
  });
});

describe('pickLines', () => {
  it('takes lines from each section in turn, up to the limit', () => {
    expect(pickLines([['a1', 'a2', 'a3'], ['b1']], 4)).toEqual(['a1', 'b1', 'a2', 'a3']);
    expect(pickLines([['a1', 'a2', 'a3', 'a4', 'a5']], 4)).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(pickLines([], 4)).toEqual([]);
  });
});

describe('rule lines in the oldman-rules skill', () => {
  const sections = readTellSections(fileURLToPath(new URL('../../../plugin/', import.meta.url)));
  const categories: readonly Category[] = [
    'auth',
    'db',
    'api',
    'infra',
    'tests',
    'git',
    'docs',
    'ui',
  ];

  it.each(categories)('%s has 2 to 4 short lines', (category) => {
    const lines = sections.get(category) ?? [];
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThanOrEqual(4);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(160);
  });

  it('has no section the router does not use', () => {
    expect([...sections.keys()].sort()).toEqual(['core', ...categories].sort());
  });
});
