import { engine } from '@/lib/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const e = engine();
  if (!e.updatedAt) await e.poll();
  return Response.json(e.settings(), { headers: { 'Cache-Control': 'no-store' } });
}

// Link a team member to a Jibble person or ClickUp member. value null = back to automatic matching.
export async function POST(req: Request) {
  const e = engine();
  const body = await req.json().catch(() => ({}));
  if (!['jibble', 'clickup'].includes(body.system)) return Response.json({ error: 'Bad request' }, { status: 400 });
  const value = body.value === null || body.value === undefined || body.value === '' ? null : body.value;
  const error = e.setLink(String(body.name), body.system, value);
  if (error) return Response.json({ error }, { status: 400 });
  await e.pollFresh();
  return Response.json(e.settings());
}
