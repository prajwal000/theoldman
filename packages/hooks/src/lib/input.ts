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

interface CommonInput {
  readonly session_id: string;
  readonly cwd: string;
  readonly hook_event_name: string;
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

export function isToolHookInput(value: unknown): value is ToolHookInput {
  if (
    !isRecord(value) ||
    typeof value.session_id !== 'string' ||
    typeof value.cwd !== 'string' ||
    typeof value.hook_event_name !== 'string'
  ) {
    return false;
  }
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
    return JSON.parse(raw) as unknown;
  } catch {
    // Malformed JSON is just another invalid input; the type guards reject undefined.
    return undefined;
  }
}

/** Reads all of stdin (fd 0 by default) and returns it only if it is valid tool hook input. */
export function readToolHookInput(fd = 0): ToolHookInput | undefined {
  const value = parseJson(readFileSync(fd, 'utf8'));
  return isToolHookInput(value) ? value : undefined;
}
