import { describe, expect, it } from 'vitest';
import type { Finding } from '../../src/lib/rules.js';
import { blockReason, userNotice } from '../../src/lib/stop-report.js';

const finding = (id: Finding['id'], action: Finding['action'], line = 1): Finding => ({
  id,
  action,
  file: 'src/a.ts',
  line,
  message: `${id} message.`,
});

describe('blockReason', () => {
  it('asks for a full review with the diff and rules paths, then lists fixes, leftovers and notes', () => {
    const reason = blockReason({
      kind: 'full',
      diffPath: '/p/.theoldman/state/s1/diff.patch',
      rulesPath: '/p/.theoldman/state/s1/review-rules.md',
      fixes: [finding('OLDMAN-D01', 'fix', 3)],
      capped: ['OLDMAN-C01 src/b.ts:2 Move change notes.'],
      notes: [finding('OLDMAN-D04', 'warn')],
    });
    expect(reason.split('\n')).toEqual([
      'theoldman: code changed in this session. Before you finish:',
      '1. Run the theoldman:oldman-reviewer subagent with the prompt: Review the diff at /p/.theoldman/state/s1/diff.patch. Read the topic rules in /p/.theoldman/state/s1/review-rules.md first.',
      '2. If the reviewer\'s reply is exactly "No issues found.", skip this step. Otherwise run the theoldman:oldman-verifier subagent with the same diff and rules paths and the reviewer\'s full reply.',
      '3. Fix every confirmed Critical and Important finding, then run the tests again. Mention confirmed Nits in your summary.',
      '4. Fix these docs findings:',
      'OLDMAN-D01 src/a.ts:3 OLDMAN-D01 message.',
      'Then reply in one or two lines with what this step found or changed. Do not repeat your earlier summary.',
      '',
      'Left after the feedback limit; mention them in your summary:',
      'OLDMAN-C01 src/b.ts:2 Move change notes.',
      '',
      'Notes, no fix required:',
      'OLDMAN-D04 src/a.ts:1 OLDMAN-D04 message.',
    ]);
  });

  it('asks for a full review without a rules file when no topic fits', () => {
    const reason = blockReason({ diffPath: 'd.patch', fixes: [], capped: [], notes: [] });
    expect(reason).toContain(
      '1. Run the theoldman:oldman-reviewer subagent with the prompt: Review the diff at d.patch.\n',
    );
    expect(reason).toContain('verifier subagent with the same diff path and');
  });

  it('asks for a light self-review of a small change, without subagents', () => {
    const notes = [finding('OLDMAN-D02', 'warn')];
    const reason = blockReason({
      kind: 'light',
      diffPath: 'd.patch',
      fixes: [],
      capped: [],
      notes,
    });
    expect(reason.split('\n')[1]).toBe(
      '1. This change is small, so check it yourself, without subagents: go over the lines you changed for wrong conditions and off-by-one errors, unhandled null or errors, missing await, missing authentication or ownership checks, unvalidated input, queries without a limit, and new behaviour without a test. The diff is at d.patch if you need it. Fix what you find, then run the tests again. Also check whether the API docs need an update for the changed routes.',
    );
    expect(reason).not.toContain('oldman-reviewer');
  });

  it('asks the reviewer about API docs when D02 fired, and works without a review', () => {
    const notes = [finding('OLDMAN-D02', 'warn')];
    expect(blockReason({ diffPath: 'd.patch', fixes: [], capped: [], notes })).toContain(
      'Review the diff at d.patch. Also check whether the API docs need an update for the changed routes.',
    );
    const docsOnly = blockReason({ fixes: [finding('OLDMAN-D01', 'fix')], capped: [], notes: [] });
    expect(docsOnly.split('\n').slice(0, 2)).toEqual([
      'theoldman: code changed in this session. Before you finish:',
      '1. Fix these docs findings:',
    ]);
  });

  it('lists at most 20 lines per section and counts the rest', () => {
    const capped = Array.from({ length: 25 }, (_, i) => `line ${String(i)}`);
    const lines = blockReason({ fixes: [], capped, notes: [] }).split('\n');
    expect(lines.at(-1)).toBe('...and 5 more.');
    expect(lines.filter((line) => line.startsWith('line '))).toHaveLength(20);
  });
});

describe('userNotice', () => {
  it('tells the user why the review was skipped and what is left', () => {
    const notice = userNotice(
      {
        fixes: [finding('OLDMAN-D01', 'fix')],
        capped: ['OLDMAN-Q01 x'],
        notes: [finding('OLDMAN-D03', 'warn')],
      },
      'this session already had 2 reviews (maxFeedbackRounds)',
    );
    expect(notice?.split('\n')).toEqual([
      'theoldman:',
      'Review skipped: this session already had 2 reviews (maxFeedbackRounds).',
      '',
      'Not fixed after the feedback limit:',
      'OLDMAN-Q01 x',
      'OLDMAN-D01 src/a.ts:1 OLDMAN-D01 message.',
      '',
      'Notes:',
      'OLDMAN-D03 src/a.ts:1 OLDMAN-D03 message.',
    ]);
  });

  it('is undefined when there is nothing to say', () => {
    expect(userNotice({ fixes: [], capped: [], notes: [] })).toBeUndefined();
  });
});
