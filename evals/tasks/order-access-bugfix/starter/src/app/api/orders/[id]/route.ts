import { getCurrentUser } from '../../../../lib/auth';
import { db } from '../../../../lib/db';
import { jsonError } from '../../../../lib/http';

interface Context {
  readonly params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const user = await getCurrentUser(request);
  if (user === null) return jsonError(401, 'sign in first');

  const { id } = await params;
  const order = await db.order.findUnique({
    where: { id },
    include: { product: { select: { id: true, name: true } } },
  });
  if (order === null) return jsonError(404, 'order not found');
  return Response.json(order);
}
