import type { Finding } from './rules.js';

export type HookEvent = 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'Stop';

/** What a hook script prints and how it exits. Exit 1 is a non-blocking error: the hook fails open. */
export interface HookOutput {
  readonly exitCode: 0 | 1;
  readonly stdout: string;
  readonly stderr: string;
}

interface Writable {
  write(chunk: string): boolean;
}

export interface HookIo {
  readonly stdout: Writable;
  readonly stderr: Writable;
  exitCode?: number | string | null | undefined;
}

function json(body: object): HookOutput {
  return { exitCode: 0, stdout: JSON.stringify(body), stderr: '' };
}

/** Nothing to say: exit 0 with no output, so Claude Code carries on as normal. */
export function pass(): HookOutput {
  return { exitCode: 0, stdout: '', stderr: '' };
}

/** Denies a PreToolUse tool call. The reason is shown to Claude. */
export function block(reason: string): HookOutput {
  return json({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

/**
 * Asks Claude to fix something after an edit (PostToolUse) or before it stops (Stop). Only
 * PostToolUse takes warnings as context: on Stop, additionalContext forces another turn.
 */
export function fix(event: 'PostToolUse' | 'Stop', reason: string): HookOutput;
export function fix(event: 'PostToolUse', reason: string, context?: string): HookOutput;
export function fix(event: 'PostToolUse' | 'Stop', reason: string, context?: string): HookOutput {
  return json({
    decision: 'block',
    reason,
    ...(context === undefined
      ? {}
      : { hookSpecificOutput: { hookEventName: event, additionalContext: context } }),
  });
}

/**
 * Adds context for Claude without requiring anything. Not offered for Stop: on Stop,
 * additionalContext makes Claude take another turn every time, so it is not a passive warning.
 */
export function warn(event: Exclude<HookEvent, 'Stop'>, context: string): HookOutput {
  return json({ hookSpecificOutput: { hookEventName: event, additionalContext: context } });
}

/** Shows a message to the user only. On Stop it does not make Claude take another turn. */
export function notify(message: string): HookOutput {
  return json({ systemMessage: message });
}

/** Plain text for the person or skill that ran a command script (not a hook). */
export function say(text: string): HookOutput {
  return { exitCode: 0, stdout: `${text}\n`, stderr: '' };
}

export function failOpen(message: string): HookOutput {
  return { exitCode: 1, stdout: '', stderr: `theoldman: ${message}\n` };
}

/** One line per finding: rule ID, file and line, message. Never the matched text itself. */
export function formatFindings(findings: readonly Finding[]): string {
  return findings.map((f) => `${f.id} ${f.file}:${String(f.line)} ${f.message}`).join('\n');
}

export function writeOutput(output: HookOutput, io: HookIo): void {
  if (output.stdout !== '') io.stdout.write(output.stdout);
  if (output.stderr !== '') io.stderr.write(output.stderr);
  // Setting exitCode instead of calling process.exit() lets stdout drain before Node exits.
  io.exitCode = output.exitCode;
}

/** Runs a hook handler and fails open if it throws. */
export function runHook(handler: () => HookOutput, io: HookIo = process): void {
  let output: HookOutput;
  try {
    output = handler();
  } catch (error) {
    output = failOpen(`internal error: ${error instanceof Error ? error.message : String(error)}`);
  }
  writeOutput(output, io);
}
