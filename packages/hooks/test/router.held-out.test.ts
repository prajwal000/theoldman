import { describe, expect, it } from 'vitest';
import { type Route, route } from '../src/lib/router.js';

// Written in a separate context that saw only the category names and their meaning, not the
// router's keywords or the samples in router.test.ts. Do not tune the router against these: the
// point is to estimate how it does on prompts nobody fitted it to. Labels with a reason are ones
// where two categories are plausible; the label is the one whose rules matter more.
const HELD_OUT: readonly (readonly [string, Route])[] = [
  ['add a forgot password flow, should email a reset link that expires after 1 hour', 'auth'],
  ['users with role viewer can still hit DELETE /projects/:id, fix that', 'auth'],
  ['build the login page, email + password fields, show an error if creds are wrong', 'auth'],
  ['add a migration that adds a nullable archived_at column to orders', 'db'],
  ['the dashboard query is super slow, takes 4s on prod. orders table has like 2M rows', 'db'],
  [
    'POST /api/invoices should create the invoice and its line items, if one fails nothing should be saved',
    'db',
  ],
  ['add zod validation to the body of PATCH /users/:id and return 422 with field errors', 'api'],
  [
    "stripe webhook handler keeps returning 500, logs say 'No signatures found matching the expected signature for payload'",
    'api',
  ],
  ['dockerfile builds take forever, can u make it multistage and cache the pnpm install', 'infra'],
  ['set up github actions to run lint and tests on every PR', 'infra'],
  [
    'userService.test.ts fails randomly in CI but passes locally, something to do with dates i think',
    'tests',
  ],
  ['write tests for the cart reducer, cover empty cart and quantity 0', 'tests'],
  ['squash my last 4 commits into one and force push', 'git'],
  ['resolve the merge conflicts in package.json and src/lib/db.ts after rebasing on main', 'git'],
  ['update the readme with how to run the app locally, we switched from npm to pnpm', 'docs'],
  ['write a changelog entry for the new export to csv feature', 'docs'],
  ['make the pricing page cards stack on mobile, theyre overflowing below 400px', 'ui'],
  ['the settings modal isnt keyboard accesible, focus doesnt trap and esc doesnt close it', 'ui'],
  ['thanks, that fixed it', 'trivial'],
  ['whats the difference between useMemo and useCallback anyway', 'trivial'],
];

const MIN_SCORE = 0.7;
const misses = HELD_OUT.filter(([prompt, label]) => route(prompt) !== label).map(
  ([prompt, label]) => `expected ${label}, got ${route(prompt)}: ${prompt}`,
);
const right = HELD_OUT.length - misses.length;

describe('router on held-out prompts', () => {
  it(`classifies ${String(right)} of ${String(HELD_OUT.length)} correctly (fails below 70%)`, () => {
    process.stdout.write(
      `router held-out score: ${String(right)}/${String(HELD_OUT.length)}\n${misses.join('\n')}\n`,
    );
    expect(right / HELD_OUT.length, misses.join('\n')).toBeGreaterThanOrEqual(MIN_SCORE);
  });
});
