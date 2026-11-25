// OLDMAN-G04: commands that destroy database data (`prisma migrate reset`, `prisma db push
// --force-reset`, DROP DATABASE/TABLE/SCHEMA or TRUNCATE sent to psql or mysql) unless they
// target a local database. The URL is looked up in this order: a host or URL given to the SQL
// client, `DATABASE_URL` set on the line (or on the line that started this script or nested
// command), the environment, then the project's `.env`.
// No URL at all counts as not local. The URL is never printed: it can hold a password.

import { programName } from '../lib/shell.js';
import type { CommandUnit } from './command-expand.js';
import type { GuardContext, Violation } from './guard-context.js';

const SQL_CLIENTS = new Set(['psql', 'mysql', 'mariadb']);
const DESTRUCTIVE_SQL = /\b(?:drop\s+(?:database|table|schema)|truncate)\b/i;
const LOCAL_HOSTS = new Set(['', 'localhost', '127.0.0.1', '::1', '0.0.0.0']);

/** The destructive Prisma command this runs, if any. Runner prefixes (`npx`) are already gone. */
function prismaOperation(words: readonly string[]): string | undefined {
  if (programName(words[0] ?? '') !== 'prisma') return undefined;
  const args = words.slice(1);
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

export function databaseViolation(unit: CommandUnit, context: GuardContext): Violation | undefined {
  const { text, commands, variables } = unit;
  const sqlClient = commands.find((c) => SQL_CLIENTS.has(programName(c.words[0] ?? '')));
  const prisma = commands.map((c) => prismaOperation(c.words)).find((op) => op !== undefined);
  const sql =
    sqlClient !== undefined && DESTRUCTIVE_SQL.test(text) ? 'DROP or TRUNCATE' : undefined;
  const operation = prisma ?? sql;
  if (operation === undefined) return undefined;
  const url =
    (sql !== undefined && sqlClient !== undefined ? clientUrl(sqlClient.words) : undefined) ??
    variables.get('DATABASE_URL') ??
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
