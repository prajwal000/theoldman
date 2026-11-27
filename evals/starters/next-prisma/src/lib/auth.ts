import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { User } from '../generated/prisma/client';
import { db } from './db';

const SESSION_DAYS = 30;
export const MIN_PASSWORD_LENGTH = 8;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Session tokens are stored as SHA-256 hashes, so a database leak does not leak sessions. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

function sessionToken(request: Request): string | undefined {
  const header = request.headers.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);
  const cookies = request.headers.get('cookie') ?? '';
  return /(?:^|;\s*)session=([^;]+)/.exec(cookies)?.[1];
}

/** The signed-in user, from a `Bearer` token or a `session` cookie, or null. */
export async function getCurrentUser(request: Request): Promise<User | null> {
  const token = sessionToken(request);
  if (token === undefined) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (session === null || session.expiresAt <= new Date()) return null;
  return session.user;
}

export function publicUser(user: User) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
