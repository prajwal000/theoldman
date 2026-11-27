import { createSession, hashPassword, MIN_PASSWORD_LENGTH, publicUser } from '../../../../lib/auth';
import { db } from '../../../../lib/db';
import { isRecord, jsonError, readJson } from '../../../../lib/http';

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (
    !isRecord(body) ||
    typeof body.email !== 'string' ||
    typeof body.name !== 'string' ||
    typeof body.password !== 'string'
  ) {
    return jsonError(400, 'email, name and password are required');
  }
  const email = body.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return jsonError(400, 'email is not valid');
  if (body.password.length < MIN_PASSWORD_LENGTH) {
    return jsonError(400, `password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  if ((await db.user.findUnique({ where: { email } })) !== null) {
    return jsonError(409, 'an account with this email already exists');
  }
  const user = await db.user.create({
    data: { email, name: body.name.trim(), passwordHash: await hashPassword(body.password) },
  });
  const token = await createSession(user.id);
  return Response.json({ token, user: publicUser(user) }, { status: 201 });
}
