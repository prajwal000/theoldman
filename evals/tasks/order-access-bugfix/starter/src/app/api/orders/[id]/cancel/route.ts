import { getCurrentUser } from '../../../../../lib/auth';
import { db } from '../../../../../lib/db';
import { jsonError } from '../../../../../lib/http';

interface Context {
  readonly params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const user = await getCurrentUser(request);
  if (user === null) return jsonError(401, 'sign in first');

  const { id } = await params;
  const order = await db.order.findUnique({ where: { id } });
  if (order === null) return jsonError(404, 'order not found');
  if (order.status !== 'PENDING') return jsonError(409, 'only pending orders can be cancelled');

  const cancelled = await db.order.update({ where: { id }, data: { status: 'CANCELLED' } });
  return Response.json(cancelled);
}
