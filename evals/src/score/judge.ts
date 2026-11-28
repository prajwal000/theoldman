// The LLM judge that matches a review's findings to a golden PR's comments. It is Claude Code in
// a fresh agent container with every tool turned off, on the runs' provider and their exact
// main model, so it works on the Anthropic API and Bedrock alike and never on an alias. Its prompt
// is evals/judge/review-judge.md. Its reply is checked against the golden IDs before it counts.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseResult } from '../claude.ts';
import { type DockerExec, InterruptedError } from '../docker.ts';
import type { GoldenComment } from '../golden-pr.ts';
import { AGENT_IMAGE } from '../images.ts';
import { OWNER_LABEL } from '../orphans.ts';
import { scrub } from '../secrets.ts';

export const JUDGE_PROMPT_FILE = fileURLToPath(
  new URL('../../judge/review-judge.md', import.meta.url),
);

export interface JudgeFinding {
  readonly file: string | null;
  readonly line: number | null;
  readonly summary: string;
  /** ID of the golden comment the finding matches, or null. */
  readonly match: string | null;
}

export interface Verdict {
  readonly findings: readonly JudgeFinding[];
}

const GOLDEN = '{{GOLDEN_COMMENTS}}';
const REVIEW = '{{REVIEW}}';

export function readJudgePrompt(file = JUDGE_PROMPT_FILE): { text: string; hash: string } {
  const text = readFileSync(file, 'utf8');
  for (const marker of [GOLDEN, REVIEW]) {
    if (text.split(marker).length !== 2) throw new Error(`${file} must hold ${marker} once`);
  }
  return { text, hash: `sha256:${createHash('sha256').update(text).digest('hex')}` };
}

/**
 * The judge's prompt for one review. A review that writes its own closing tag cannot end the
 * review block early, and nothing in it is read as a placeholder.
 */
export function judgePrompt(
  template: string,
  comments: readonly GoldenComment[],
  parts: readonly string[],
): string {
  const golden = JSON.stringify(
    comments.map((comment) =>
      'in' in comment
        ? { id: comment.id, in: comment.in, issue: comment.issue }
        : { id: comment.id, file: comment.file, line: comment.line, issue: comment.issue },
    ),
    null,
    2,
  );
  const review =
    parts.length === 0
      ? '(The review is empty.)'
      : parts.length === 1
        ? (parts[0] ?? '')
        : parts
            .map((part, i) => `Part ${String(i + 1)} of ${String(parts.length)}:\n${part}`)
            .join('\n\n');
  const safe = review.replace(/<(\/?)review>/gi, '<$1review​>');
  const [before = '', after = ''] = template.split(REVIEW);
  return before.replace(GOLDEN, () => golden) + safe + after.replace(GOLDEN, () => golden);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The judge's reply as a verdict, or why it is not one. */
export function parseVerdict(
  text: string,
  goldenIds: readonly string[],
): Verdict | { readonly error: string } {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end < start) return { error: 'the judge replied with no JSON object' };
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { error: 'the judge replied with invalid JSON' };
  }
  if (!isRecord(value) || !Array.isArray(value.findings)) {
    return { error: 'the judge reply has no "findings" list' };
  }
  const findings: JudgeFinding[] = [];
  for (const entry of value.findings) {
    if (!isRecord(entry)) return { error: 'a judge finding is not an object' };
    const { file, line, summary, match } = entry;
    if (!(file === null || typeof file === 'string')) return { error: 'a finding has a bad file' };
    if (!(line === null || (typeof line === 'number' && Number.isInteger(line) && line >= 0))) {
      return { error: 'a finding has a bad line' };
    }
    if (typeof summary !== 'string') return { error: 'a finding has no summary' };
    if (!(match === null || (typeof match === 'string' && goldenIds.includes(match)))) {
      return { error: `a finding matches an unknown golden comment: ${JSON.stringify(match)}` };
    }
    findings.push({ file, line, summary, match });
  }
  return { findings };
}

/** `docker run` arguments for the judge: no tools, no saved session, the exact model. */
export function judgeArgs(name: string, model: string, envNames: readonly string[]): string[] {
  return [
    'run',
    '--rm',
    '-i',
    '--name',
    name,
    '--label',
    `${OWNER_LABEL}=${String(process.pid)}`,
    '-e',
    'DISABLE_AUTOUPDATER=1',
    // Names only: docker takes each value from its own environment.
    ...envNames.flatMap((env) => ['-e', env]),
    AGENT_IMAGE,
    'claude',
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--tools',
    '',
    '--model',
    model,
    '--no-session-persistence',
  ];
}

export interface JudgeContext {
  readonly docker: DockerExec;
  /** The environment for `docker`, holding only the judge's provider variables. */
  readonly env: NodeJS.ProcessEnv;
  readonly envNames: readonly string[];
  readonly secrets: readonly string[];
  readonly model: string;
  readonly signal?: AbortSignal;
}

export interface JudgeResult {
  readonly verdict: Verdict | null;
  readonly error: string | null;
  /** The judge's stream-json output, scrubbed of credentials, one attempt after another. */
  readonly transcript: string;
  readonly costUsd: number;
  readonly models: readonly string[];
}

const ATTEMPTS = 2;
const TIMEOUT_MS = 5 * 60_000;

/** Asks the judge, once more if its first reply is not a valid verdict. */
export async function runJudge(
  ctx: JudgeContext,
  name: string,
  prompt: string,
  goldenIds: readonly string[],
): Promise<JudgeResult> {
  const transcripts: string[] = [];
  const models = new Set<string>();
  let costUsd = 0;
  let error = 'the judge did not run';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const options = { env: ctx.env, input: prompt, timeoutMs: TIMEOUT_MS };
    const result = await ctx.docker(
      judgeArgs(`${name}-${String(attempt)}`, ctx.model, ctx.envNames),
      ctx.signal === undefined ? options : { ...options, signal: ctx.signal },
    );
    if (ctx.signal?.aborted === true || result.timedOut) {
      // A killed `docker run` client leaves its container running.
      await ctx.docker(['rm', '-f', `${name}-${String(attempt)}`], {
        env: ctx.env,
        timeoutMs: 60_000,
      });
      if (ctx.signal?.aborted === true) throw new InterruptedError();
    }
    transcripts.push(scrub(result.stdout, ctx.secrets));
    const parsed = parseResult(result.stdout);
    if ('error' in parsed) {
      const tail = scrub(result.stderr.trim(), ctx.secrets).split('\n').at(-1) ?? '';
      error = result.timedOut
        ? 'the judge timed out'
        : `the judge failed: ${parsed.error} ${tail}`.trim();
      continue;
    }
    costUsd += parsed.totalCostUsd;
    for (const model of parsed.models) models.add(model);
    if (parsed.isError) {
      error = 'the judge ended in an error';
      continue;
    }
    const verdict = parseVerdict(lastResultText(result.stdout), goldenIds);
    if ('error' in verdict) {
      error = verdict.error;
      continue;
    }
    return { verdict, error: null, transcript: transcripts.join(''), costUsd, models: [...models] };
  }
  return { verdict: null, error, transcript: transcripts.join(''), costUsd, models: [...models] };
}

function lastResultText(stdout: string): string {
  let text = '';
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const event: unknown = JSON.parse(line);
      if (isRecord(event) && event.type === 'result' && typeof event.result === 'string') {
        text = event.result;
      }
    } catch {
      // Not a JSON event; the judge's reply is only ever in a result event.
    }
  }
  return text;
}
