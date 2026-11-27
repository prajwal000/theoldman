import { getCurrentUser } from '../../../../lib/auth';
import { db } from '../../../../lib/db';
import { jsonError } from '../../../../lib/http';

interface Context {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Context): Promise<Response> {
  const { id } = await params;
  const product = await db.product.findUnique({ where: { id } });
  if (product === null) return jsonError(404, 'product not found');
  return Response.json(product);
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const user = await getCurrentUser(request);
  if (user === null) return jsonError(401, 'sign in first');
  if (user.role !== 'ADMIN') return jsonError(403, 'only admins can delete products');

  const { id } = await params;
  const { count } = await db.product.deleteMany({ where: { id } });
  if (count === 0) return jsonError(404, 'product not found');
  return new Response(null, { status: 204 });
}
