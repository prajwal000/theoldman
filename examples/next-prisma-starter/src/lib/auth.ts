import { prisma } from './db';

export interface SessionUser {
  id: string;
  email: string;
}

/**
 * The signed-in user for a request, or null. Sessions are kept in the `session` cookie, which
 * holds the user ID signed by the auth provider; verifying the signature is left to the provider
 * middleware, which rejects requests with a bad cookie before they reach a route.
 */
export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const cookie = request.headers.get('cookie') ?? '';
  const userId = /(?:^|;\s*)session=([^;]+)/.exec(cookie)?.[1];
  if (userId === undefined) return null;
  return prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
}
