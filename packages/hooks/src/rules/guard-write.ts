// Guard rules for the Write and Edit tools, decided by the file path alone.
//
// OLDMAN-G05 blocks writing an env file: `.env` or `.env.<anything>`, except `.env.example`.
// OLDMAN-G06 blocks writing a private key file: `*.pem`, `*.key`, and SSH keys named
// `id_rsa*`, `id_dsa*`, `id_ecdsa*` or `id_ed25519*`. Names compare case-insensitively, since
// Windows and macOS file systems usually do, and paths can come in any of the forms
// lib/paths.ts normalizes.

import { normalizePath } from '../lib/paths.js';
import type { Finding, Rule } from '../lib/rules.js';
import type { Violation } from './guard-context.js';

const SSH_KEY = /^id_(?:rsa|dsa|ecdsa|ed25519)/;
const KEY_EXTENSION = /\.(?:pem|key)$/;

function fileName(path: string): string {
  return (normalizePath(path).split('/').pop() ?? '').toLowerCase();
}

/** The G05 or G06 violation for writing `path`, if it is an env or private key file. */
export function checkPath(path: string): Violation | undefined {
  const name = fileName(path);
  if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) {
    return {
      id: 'OLDMAN-G05',
      message: `${path} is an env file and can hold real secrets. Add the variable name to .env.example instead, and ask the user to put the value in their own env file.`,
    };
  }
  if (SSH_KEY.test(name) || KEY_EXTENSION.test(name)) {
    return {
      id: 'OLDMAN-G06',
      message: `${path} looks like a private key or certificate file. Do not create or change key files; ask the user to manage them.`,
    };
  }
  return undefined;
}

/** The guard as a Rule for fixtures: each added line is a path that would be written. */
export function guardWriteRule(): Rule {
  return ({ file, addedLines }) =>
    addedLines.flatMap(({ line, text }) => {
      const violation = text.trim() === '' ? undefined : checkPath(text.trim());
      return violation === undefined
        ? []
        : [{ ...violation, action: 'block', file, line } satisfies Finding];
    });
}
