import { getMonth, monthCsv } from '@/lib/month';
import { todayStr } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/month?month=YYYY-MM (defaults to this month) &format=csv &fresh=1
export async function GET(req: Request) {
  const url = new URL(req.url);
  const thisMonth = todayStr().slice(0, 7);
  const month = url.searchParams.get('month') || thisMonth;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return Response.json({ error: 'month must be YYYY-MM' }, { status: 400 });
  if (month > thisMonth) return Response.json({ error: 'That month hasn’t started yet' }, { status: 400 });
  try {
    const data = await getMonth(month, url.searchParams.get('fresh') === '1');
    if (url.searchParams.get('format') === 'csv') {
      return new Response(monthCsv(data), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="team-month-${month}.csv"`, 'Cache-Control': 'no-store' },
      });
    }
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
