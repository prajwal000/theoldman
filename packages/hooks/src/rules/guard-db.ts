// OLDMAN-G04: commands that destroy database data (`prisma migrate reset`, `prisma db push
// --force-reset`, DROP DATABASE/TABLE/SCHEMA or TRUNCATE sent to psql or mysql) unless they
// target a local database. The URL is looked up in this order: a host or URL given to the SQL
// client, `DATABASE_URL` set in the command line, the environment, then the project's `.env`.
// No URL at all counts as not local. The URL is never printed: it can hold a password.

import { programName, type SimpleCommand } from '../lib/shell.js';
import type { GuardContext, Violation } from './guard-context.js';

const PACKAGE_RUNNERS = new Set(['npx', 'pnpx', 'bunx', 'yarn', 'pnpm', 'bun', 'npm']);
const SQL_CLIENTS = new Set(['psql', 'mysql', 'mariadb']);
const DESTRUCTIVE_SQL = /\b(?:drop\s+(?:database|table|schema)|truncate)\b/i;
const LOCAL_HOSTS = new Set(['', 'localhost', '127.0.0.1', '::1', '0.0.0.0']);

/** The destructive Prisma command this runs, if any (`npx prisma migrate reset`, ...). */
function prismaOperation(words: readonly string[]): string | undefined {
  const at = words.findIndex((word) => programName(word) === 'prisma');
  if (at === -1 || (at > 0 && !PACKAGE_RUNNERS.has(programName(words[0] ?? '')))) return undefined;
  const args = words.slice(at + 1);
  const [first, second] = args.filter((arg) => !arg.startsWith('-'));
  if (first === 'migrate' && second === 'reset') return 'prisma migrate reset';
  if (first === 'db' && second === 'push' && args.includes('--force-reset')) {
    return 'prisma db push --force-reset';
  }
  return undefined;
}

/** A URL or host given to the SQL client itself (`psql postgres://...`, `-h host`). */
function clientUrl(words: readonly string[]): string | undefined {
  for (let i = 1; i < words.length; i++) {
    const word = words[i] ?? '';
    if (word.includes('://')) return word.replace(/^--dbname=/, '');
    const host =
      word === '-h' || word === '--host' ? words[i + 1] : /^--host=(.*)$/.exec(word)?.[1];
    if (host !== undefined) return `db://${host.startsWith('/') ? '' : host}`;
  }
  return undefined;
}

/** `NAME=value` set anywhere in the command line: prefixes, `export`, PowerShell `$env:`. */
function lineVariable(commands: readonly SimpleCommand[], name: string): string | undefined {
  let value: string | undefined;
  const take = (piece: string): void => {
    const equals = piece.indexOf('=');
    const key = piece.slice(0, equals).replace(/^\$env:/i, '');
    if (equals > 0 && key.toLowerCase() === name.toLowerCase()) value = piece.slice(equals + 1);
  };
  for (const { assignments, words } of commands) {
    assignments.forEach(take);
    if (words[0] === 'export') words.slice(1).forEach(take);
    // PowerShell splits `$env:NAME = "value"` into words; joining them gives `$env:NAME=value`.
    if (/^\$env:/i.test(words[0] ?? '')) take(words.join(''));
  }
  return value;
}

function isLocal(url: string | undefined): boolean {
  if (url === undefined) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return parsed.protocol === 'file:' || LOCAL_HOSTS.has(host) || host.endsWith('.localhost');
  } catch {
    // Not a URL we can read, so it cannot be shown to be local.
    return false;
  }
}

export function databaseViolation(
  text: string,
  commands: readonly SimpleCommand[],
  context: GuardContext,
): Violation | undefined {
  const sqlClient = commands.find((c) => SQL_CLIENTS.has(programName(c.words[0] ?? '')));
  const prisma = commands.map((c) => prismaOperation(c.words)).find((op) => op !== undefined);
  const sql =
    sqlClient !== undefined && DESTRUCTIVE_SQL.test(text) ? 'DROP or TRUNCATE' : undefined;
  const operation = prisma ?? sql;
  if (operation === undefined) return undefined;
  const url =
    (sql !== undefined && sqlClient !== undefined ? clientUrl(sqlClient.words) : undefined) ??
    lineVariable(commands, 'DATABASE_URL') ??
    context.env('DATABASE_URL') ??
    context.dotenv('DATABASE_URL');
  if (isLocal(url)) return undefined;
  const why =
    url === undefined
      ? 'no DATABASE_URL was found, so it may not be local'
      : 'the database is not local';
  return {
    id: 'OLDMAN-G04',
    message: `${operation} destroys data and ${why}. Run it against a local database, or ask the user to run it themselves.`,
  };
}
