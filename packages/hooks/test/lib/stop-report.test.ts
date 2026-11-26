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
  it('asks for the review with the diff path, then lists fixes, leftovers and notes', () => {
    const reason = blockReason({
      diffPath: '/p/.theoldman/state/s1/diff.patch',
      fixes: [finding('OLDMAN-D01', 'fix', 3)],
      capped: ['OLDMAN-C01 src/b.ts:2 Move change notes.'],
      notes: [finding('OLDMAN-D04', 'warn')],
    });
    expect(reason.split('\n')).toEqual([
      'theoldman: code changed in this session. Before you finish:',
      '1. Run the theoldman:oldman-reviewer subagent with the prompt: Review the diff at /p/.theoldman/state/s1/diff.patch.',
      "2. Run the theoldman:oldman-verifier subagent with the same diff path and the reviewer's full reply.",
      '3. Fix every confirmed Critical and Important finding, then run the tests again. Mention confirmed Nits in your summary.',
      '4. Fix these docs findings:',
      'OLDMAN-D01 src/a.ts:3 OLDMAN-D01 message.',
      '',
      'Left after the feedback limit; mention them in your summary:',
      'OLDMAN-C01 src/b.ts:2 Move change notes.',
      '',
      'Notes, no fix required:',
      'OLDMAN-D04 src/a.ts:1 OLDMAN-D04 message.',
    ]);
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
