import { describe, expect, it } from 'vitest';
import { claudeArgs, parseResult, PLUGIN_DIR_IN_CONTAINER } from '../src/claude.ts';
import { RESULT_EVENT, transcript } from './result-event.ts';

describe('claudeArgs', () => {
  it('uses identical flags for both arms, plus the plugin for "with"', () => {
    const without = claudeArgs('without');
    expect(without).toEqual([
      'claude',
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'bypassPermissions',
    ]);
    expect(claudeArgs('with')).toEqual([...without, '--plugin-dir', PLUGIN_DIR_IN_CONTAINER]);
  });

  it('never uses --bare, which skips plugin hooks', () => {
    for (const condition of ['with', 'without'] as const) {
      expect(claudeArgs(condition)).not.toContain('--bare');
    }
  });
});

describe('parseResult', () => {
  it('reads tokens, cost and the exact model IDs from the result event', () => {
    expect(parseResult(transcript())).toEqual({
      isError: false,
      resultEvents: 1,
      durationMs: 65_405,
      numTurns: 11,
      totalCostUsd: 0.226,
      models: ['claude-sonnet-5-5'],
      modelUsage: {
        'claude-sonnet-5-5': {
          inputTokens: 20,
          outputTokens: 9018,
          cacheReadInputTokens: 111_463,
          cacheCreationInputTokens: 39_708,
          costUSD: 0.226,
        },
      },
      subagents: {
        spawned: 2,
        byType: { 'theoldman:oldman-reviewer': 1, 'theoldman:oldman-verifier': 1 },
      },
      fields: {
        result: Object.keys(RESULT_EVENT).sort(),
        modelUsage: Object.keys(RESULT_EVENT.modelUsage['claude-sonnet-5-5']).sort(),
      },
    });
  });

  it('lists every model, main agent and subagents', () => {
    const usage = RESULT_EVENT.modelUsage['claude-sonnet-5-5'];
    const event = {
      ...RESULT_EVENT,
      modelUsage: { 'claude-sonnet-5-5': usage, 'claude-haiku-5-5': usage },
    };
    const parsed = parseResult(transcript(event));
    expect('models' in parsed && parsed.models).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
  });

  // Shaped like a real "with" run on 2.1.332: the Stop review's background subagents report back
  // after the main turn, and each report ends in its own result event with the same totals.
  it('sums time and turns over every result event and takes the totals from the last', () => {
    const totals = { total_cost_usd: 0.187736, duration_api_ms: 44_106 };
    const events = [
      { ...RESULT_EVENT, ...totals, result_index: 0, duration_ms: 41_759, num_turns: 5 },
      { ...RESULT_EVENT, ...totals, result_index: 1, duration_ms: 5902, num_turns: 2 },
      { ...RESULT_EVENT, ...totals, result_index: 2, duration_ms: 13_507, num_turns: 6 },
    ];
    const text = `${events.map((event) => JSON.stringify(event)).join('\nnot json\n')}\n`;
    expect(parseResult(text)).toMatchObject({
      resultEvents: 3,
      durationMs: 61_168,
      numTurns: 13,
      totalCostUsd: 0.187736,
      models: ['claude-sonnet-5-5'],
    });
  });

  it('reports an error if any result event does', () => {
    const text = transcript({ ...RESULT_EVENT, is_error: false }, [
      JSON.stringify({ ...RESULT_EVENT, is_error: true }),
    ]);
    expect(parseResult(text)).toMatchObject({ isError: true, resultEvents: 2 });
  });

  it('refuses totals that go down, which would mean they are not cumulative', () => {
    const text = transcript({ ...RESULT_EVENT, total_cost_usd: 0.1 }, [
      JSON.stringify({ ...RESULT_EVENT, total_cost_usd: 0.2 }),
    ]);
    expect(parseResult(text)).toEqual({ error: 'result events: total_cost_usd went down' });
  });

  it('records a run without subagent stats', () => {
    const parsed = parseResult(transcript({ ...RESULT_EVENT, subagent_stats: undefined }));
    expect('subagents' in parsed && parsed.subagents).toBeNull();
  });

  it.each([
    ['', 'the transcript has no result event'],
    ['{"type":"assistant"}\n', 'the transcript has no result event'],
    [transcript({ ...RESULT_EVENT, is_error: 'no' }), 'result event: is_error is not a boolean'],
    [
      transcript({ ...RESULT_EVENT, duration_ms: undefined }),
      'result event: duration_ms is not a number',
    ],
    [
      transcript({ ...RESULT_EVENT, total_cost_usd: -1 }),
      'result event: total_cost_usd is not a number',
    ],
    [transcript({ ...RESULT_EVENT, modelUsage: [] }), 'result event: modelUsage is not an object'],
    [
      transcript({ ...RESULT_EVENT, modelUsage: { m: { inputTokens: 1 } } }),
      'result event: modelUsage.m.outputTokens is not a number',
    ],
  ])('explains a result it cannot read (%#)', (text, error) => {
    expect(parseResult(text)).toEqual({ error });
  });
});
