import { getCurrentUser } from '../../../lib/auth';
import { db } from '../../../lib/db';
import { isRecord, jsonError, readJson } from '../../../lib/http';

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser(request);
  if (user === null) return jsonError(401, 'sign in first');
  const orders = await db.order.findMany({
    where: { userId: user.id },
    include: { product: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return Response.json(orders);
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser(request);
  if (user === null) return jsonError(401, 'sign in first');

  const body = await readJson(request);
  if (
    !isRecord(body) ||
    typeof body.productId !== 'string' ||
    typeof body.quantity !== 'number' ||
    !Number.isInteger(body.quantity) ||
    body.quantity < 1
  ) {
    return jsonError(400, 'productId and a whole, positive quantity are required');
  }
  const product = await db.product.findUnique({ where: { id: body.productId } });
  if (product === null) return jsonError(404, 'product not found');

  const order = await db.order.create({
    data: {
      userId: user.id,
      productId: product.id,
      quantity: body.quantity,
      totalCents: product.priceCents * body.quantity,
    },
  });
  return Response.json(order, { status: 201 });
}
