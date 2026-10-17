import { engine } from '@/lib/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const e = engine();
  if (!e.updatedAt) await e.poll();
  return Response.json(e.state(), { headers: { 'Cache-Control': 'no-store' } });
}
