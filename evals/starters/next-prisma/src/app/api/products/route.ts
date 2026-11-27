import { getCurrentUser } from '../../../lib/auth';
import { db } from '../../../lib/db';
import { isRecord, jsonError, readJson } from '../../../lib/http';

export async function GET(): Promise<Response> {
  const products = await db.product.findMany({ orderBy: { createdAt: 'desc' } });
  return Response.json(products);
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser(request);
  if (user === null) return jsonError(401, 'sign in first');
  if (user.role !== 'ADMIN') return jsonError(403, 'only admins can add products');

  const body = await readJson(request);
  if (
    !isRecord(body) ||
    typeof body.name !== 'string' ||
    body.name.trim() === '' ||
    typeof body.priceCents !== 'number' ||
    !Number.isInteger(body.priceCents) ||
    body.priceCents < 0
  ) {
    return jsonError(400, 'name and a whole, non-negative priceCents are required');
  }
  const product = await db.product.create({
    data: { name: body.name.trim(), priceCents: body.priceCents },
  });
  return Response.json(product, { status: 201 });
}
