import { engine } from '@/lib/engine';
import { edit, notify, summary } from '@/lib/points';
import { todayStr } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/points?month=YYYY-MM (defaults to this month)
export async function GET(req: Request) {
  const month = new URL(req.url).searchParams.get('month') || todayStr().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return Response.json({ error: 'month must be YYYY-MM' }, { status: 400 });
  const e = engine();
  if (!e.updatedAt) await e.poll();
  return Response.json(summary(month), { headers: { 'Cache-Control': 'no-store' } });
}

// POST { action: 'restore' | 'unrestore' | 'note' | 'take' | 'delete', id?, name?, note?, by?, date? }
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const error = edit(b);
  if (error) return Response.json({ error }, { status: 400 });
  await notify().catch(() => {}); // a point taken by hand is sent on Slack straight away
  return Response.json({ ok: true });
}
