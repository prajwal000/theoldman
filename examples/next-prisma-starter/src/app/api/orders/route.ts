import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

const PAGE_SIZE = 20;

const Query = z.object({ page: z.coerce.number().int().min(1).default(1) });

/** The signed-in user's orders, newest first, one page at a time. */
export async function GET(request: Request): Promise<NextResponse> {
  const user = await getSessionUser(request);
  if (user === null) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const parsed = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid page.' }, { status: 400 });
  const { page } = parsed.data;

  const orders = await prisma.order.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    skip: page * PAGE_SIZE,
    take: PAGE_SIZE,
    select: { id: true, totalCents: true, createdAt: true },
  });
  return NextResponse.json({ page, orders });
}
