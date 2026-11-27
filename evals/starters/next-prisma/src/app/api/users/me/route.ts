import { getCurrentUser, publicUser } from '../../../../lib/auth';
import { jsonError } from '../../../../lib/http';

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser(request);
  if (user === null) return jsonError(401, 'sign in first');
  return Response.json({ user: publicUser(user) });
}
