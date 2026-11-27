import { createSession, publicUser, verifyPassword } from '../../../../lib/auth';
import { db } from '../../../../lib/db';
import { isRecord, jsonError, readJson } from '../../../../lib/http';

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!isRecord(body) || typeof body.email !== 'string' || typeof body.password !== 'string') {
    return jsonError(400, 'email and password are required');
  }
  const user = await db.user.findUnique({ where: { email: body.email.trim().toLowerCase() } });
  if (user === null || !(await verifyPassword(body.password, user.passwordHash))) {
    return jsonError(401, 'wrong email or password');
  }
  const token = await createSession(user.id);
  return Response.json({ token, user: publicUser(user) });
}
