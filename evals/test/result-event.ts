// A stream-json transcript shaped like Claude Code 2.1.332's output: field names as seen in the
// plugin eval spike, values made up.

export const RESULT_EVENT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 65_405,
  duration_api_ms: 60_000,
  num_turns: 11,
  result: 'Done.',
  session_id: 'session-1',
  total_cost_usd: 0.226,
  usage: { input_tokens: 12, output_tokens: 7032 },
  modelUsage: {
    'claude-sonnet-5-5': {
      inputTokens: 20,
      outputTokens: 9018,
      cacheReadInputTokens: 111_463,
      cacheCreationInputTokens: 39_708,
      webSearchRequests: 0,
      costUSD: 0.226,
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      thinkingTokens: 1326,
    },
  },
  subagent_stats: {
    spawned: 2,
    completed: 2,
    by_type: { 'theoldman:oldman-reviewer': 1, 'theoldman:oldman-verifier': 1 },
  },
  permission_denials: [],
};

export function transcript(result: unknown = RESULT_EVENT, before: string[] = []): string {
  const init = { type: 'system', subtype: 'init', model: 'claude-sonnet-5-5' };
  const assistant = {
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'Working' }] },
  };
  return [
    ...before,
    JSON.stringify(init),
    JSON.stringify(assistant),
    JSON.stringify(result),
    '',
  ].join('\n');
}
