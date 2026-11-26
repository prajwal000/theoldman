import { readFileSync } from 'node:fs';

export interface ShellToolInput {
  readonly command: string;
}

export interface WriteToolInput {
  readonly file_path: string;
  readonly content: string;
}

export interface EditToolInput {
  readonly file_path: string;
  readonly old_string: string;
  readonly new_string: string;
  readonly replace_all?: boolean;
}

/** The fields every hook event sends. */
export interface CommonInput {
  readonly session_id: string;
  readonly cwd: string;
  readonly hook_event_name: string;
  /** Set by Claude Code when a subagent makes the call, e.g. `theoldman:oldman-docs-writer`. */
  readonly agent_type?: string;
}

export interface PromptHookInput extends CommonInput {
  readonly prompt: string;
}

export type ToolHookInput = CommonInput &
  (
    | { readonly tool_name: 'Bash' | 'PowerShell'; readonly tool_input: ShellToolInput }
    | { readonly tool_name: 'Write'; readonly tool_input: WriteToolInput }
    | { readonly tool_name: 'Edit'; readonly tool_input: EditToolInput }
  );

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isShellToolInput(value: unknown): value is ShellToolInput {
  return isRecord(value) && typeof value.command === 'string';
}

export function isWriteToolInput(value: unknown): value is WriteToolInput {
  return (
    isRecord(value) && typeof value.file_path === 'string' && typeof value.content === 'string'
  );
}

export function isEditToolInput(value: unknown): value is EditToolInput {
  return (
    isRecord(value) &&
    typeof value.file_path === 'string' &&
    typeof value.old_string === 'string' &&
    typeof value.new_string === 'string' &&
    (value.replace_all === undefined || typeof value.replace_all === 'boolean')
  );
}

export function isCommonInput(value: unknown): value is CommonInput & Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.session_id === 'string' &&
    typeof value.cwd === 'string' &&
    typeof value.hook_event_name === 'string' &&
    (value.agent_type === undefined || typeof value.agent_type === 'string')
  );
}

export function isPromptHookInput(value: unknown): value is PromptHookInput {
  return isCommonInput(value) && typeof value.prompt === 'string';
}

export function isToolHookInput(value: unknown): value is ToolHookInput {
  if (!isCommonInput(value)) return false;
  switch (value.tool_name) {
    case 'Bash':
    case 'PowerShell':
      return isShellToolInput(value.tool_input);
    case 'Write':
      return isWriteToolInput(value.tool_input);
    case 'Edit':
      return isEditToolInput(value.tool_input);
    default:
      return false;
  }
}

export function parseJson(raw: string): unknown {
  try {
    // Windows PowerShell 5.1 prefixes piped text with a UTF-8 byte-order mark, which JSON.parse
    // rejects; a guard must not fail open because of how its input was encoded.
    return JSON.parse(raw.replace(/^\uFEFF/, '')) as unknown;
  } catch {
    // Malformed JSON is just another invalid input; the type guards reject undefined.
    return undefined;
  }
}

/** Reads all of stdin (fd 0 by default) and returns it only if `isValid` accepts it. */
export function readHookInput<T>(isValid: (value: unknown) => value is T, fd = 0): T | undefined {
  const value = parseJson(readFileSync(fd, 'utf8'));
  return isValid(value) ? value : undefined;
}

export function readToolHookInput(fd = 0): ToolHookInput | undefined {
  return readHookInput(isToolHookInput, fd);
}
